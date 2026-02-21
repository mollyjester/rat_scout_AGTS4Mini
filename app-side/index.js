/**
 * Rat Scout — App-side companion service for Zepp OS
 *
 * Runs on the phone (inside the Zepp app). Responsible for:
 *   1. Fetching Dexcom CGM glucose data from the Dexcom Share API
 *   2. Fetching weather from OpenWeatherMap API
 *   3. Fetching astronomy data from ipgeolocation.io
 *   4. Sending data to the watch via messageBuilder
 *
 * Configuration is read from the settings object stored in app settings.
 * Users must configure their API credentials in the Zepp app settings.
 */

import { messageBuilder } from '@zos/utils'
import { fetch } from '@zos/app-side/network'
import { settingsStorage } from '@zos/app-side/settings'

// ─── Dexcom Share API endpoints ───────────────────────────────────────────────
const DEXCOM_US_BASE     = 'https://share2.dexcom.com/ShareWebServices/Services'
const DEXCOM_OUS_BASE    = 'https://shareous1.dexcom.com/ShareWebServices/Services'
const DEXCOM_JP_BASE     = 'https://shareous1.dexcom.com/ShareWebServices/Services'

const DEXCOM_APPLICATION_ID = 'd89443d2-327c-4a6f-89e5-496bbb0317db'

// ─── Cache ────────────────────────────────────────────────────────────────────
let sessionId = null
let lastGlucoseFetch = 0
let lastWeatherFetch = 0
let lastAstroFetch   = 0
let cachedGlucose    = null
let cachedWeather    = null
let cachedAstro      = null

// Cache durations in ms
const GLUCOSE_CACHE_MS = 5 * 60 * 1000      // 5 minutes
const WEATHER_CACHE_MS = 30 * 60 * 1000     // 30 minutes
const ASTRO_CACHE_MS   = 24 * 60 * 60 * 1000 // 24 hours

// ─── Settings helpers ─────────────────────────────────────────────────────────

function getSetting(key, fallback) {
  try {
    const val = settingsStorage.getItem(key)
    return val !== null && val !== undefined ? val : fallback
  } catch (e) {
    return fallback
  }
}

// ─── Dexcom Share API ─────────────────────────────────────────────────────────

/**
 * Get the Dexcom base URL based on the configured region.
 * region: 'us' | 'ous' | 'jp'
 */
function dexcomBase(region) {
  switch (region) {
    case 'ous': return DEXCOM_OUS_BASE
    case 'jp':  return DEXCOM_JP_BASE
    default:    return DEXCOM_US_BASE
  }
}

/**
 * Authenticate with Dexcom Share and obtain a session ID.
 */
async function dexcomLogin(username, password, region) {
  const base = dexcomBase(region)
  const url  = base + '/General/LoginPublisherAccountById'

  const body = JSON.stringify({
    accountName:   username,
    password:      password,
    applicationId: DEXCOM_APPLICATION_ID,
  })

  const resp = await fetch({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  if (resp.status !== 200) throw new Error('Dexcom login failed: ' + resp.status)

  // Response body is a quoted UUID string, e.g. "\"abc-123\""
  const text = await resp.text()
  // Strip surrounding quotes if present
  return text.replace(/^"|"$/g, '')
}

/**
 * Fetch the latest glucose reading from Dexcom Share.
 * Returns { value, trend, trendArrow, timestamp } or null.
 */
async function fetchGlucose() {
  const now = Date.now()
  if (cachedGlucose && (now - lastGlucoseFetch) < GLUCOSE_CACHE_MS) {
    return cachedGlucose
  }

  const username = getSetting('dexcom_username', '')
  const password = getSetting('dexcom_password', '')
  const region   = getSetting('dexcom_region', 'us')
  const units    = getSetting('bg_units', 'mgdl')  // 'mgdl' | 'mmol'

  if (!username || !password) return null

  try {
    // Re-authenticate if we don't have a session
    if (!sessionId) {
      sessionId = await dexcomLogin(username, password, region)
    }

    const base  = dexcomBase(region)
    const url   = base + '/Publisher/ReadPublisherLatestGlucoseValues'
                + '?sessionId=' + encodeURIComponent(sessionId)
                + '&minutes=1440&maxCount=2'

    const resp  = await fetch({ url, method: 'GET' })

    if (resp.status === 500) {
      // Session expired — re-authenticate once
      sessionId = await dexcomLogin(username, password, region)
      return fetchGlucose()
    }

    if (resp.status !== 200) return null

    const readings = JSON.parse(await resp.text())
    if (!readings || !readings.length) return null

    const latest = readings[0]
    const prev   = readings[1]

    // Extract numeric value (in mg/dL)
    const rawValue = latest.Value

    // Convert if needed
    let displayValue, deltaStr
    if (units === 'mmol') {
      const mmol     = (rawValue / 18.0).toFixed(1)
      const prevMmol = prev ? (prev.Value / 18.0).toFixed(1) : null
      displayValue   = mmol
      deltaStr       = prevMmol ? formatDelta((parseFloat(mmol) - parseFloat(prevMmol)).toFixed(1), units) : ''
    } else {
      const delta = prev ? rawValue - prev.Value : null
      displayValue = '' + rawValue
      deltaStr     = delta !== null ? formatDelta(delta, units) : ''
    }

    // Parse Dexcom WCF timestamp \/Date(1234567890000+0000)\/
    let timestamp = Date.now()
    try {
      const ms = parseInt(latest.WT.replace(/\/Date\((\d+)[^)]*\)\//, '$1'), 10)
      if (!isNaN(ms)) timestamp = ms
    } catch (e) {}

    const result = {
      value:     displayValue,
      delta:     deltaStr,
      trend:     latest.Trend,
      timestamp: timestamp,
    }

    cachedGlucose = result
    lastGlucoseFetch = now
    return result
  } catch (e) {
    sessionId = null  // force re-auth on next attempt
    return null
  }
}

/**
 * Format a glucose delta value with sign arrow.
 */
function formatDelta(delta, units) {
  const n = parseFloat(delta)
  if (isNaN(n)) return ''
  const sign = n > 0 ? '+' : ''
  if (units === 'mmol') return sign + n.toFixed(1)
  return sign + Math.round(n)
}

// ─── OpenWeatherMap API ───────────────────────────────────────────────────────

/**
 * Fetch current weather from OpenWeatherMap.
 * Returns { temp, windSpeed, windUnit, description } or null.
 */
async function fetchWeather(lat, lon) {
  const now = Date.now()
  if (cachedWeather && (now - lastWeatherFetch) < WEATHER_CACHE_MS) {
    return cachedWeather
  }

  const apiKey = getSetting('owm_api_key', '')
  const metric = getSetting('weather_units', 'metric') === 'metric'

  if (!apiKey) return null

  try {
    const units = metric ? 'metric' : 'imperial'
    let url = 'https://api.openweathermap.org/data/2.5/weather'
            + '?appid=' + encodeURIComponent(apiKey)
            + '&units=' + units

    if (lat && lon) {
      url += '&lat=' + lat + '&lon=' + lon
    } else {
      // Fall back to a default location if none provided
      return null
    }

    const resp = await fetch({ url, method: 'GET' })
    if (resp.status !== 200) return null

    const data = JSON.parse(await resp.text())

    const result = {
      temp:     Math.round(data.main.temp),
      windSpeed: Math.round(data.wind.speed),
      windUnit: metric ? 'm/s' : 'mph',
      description: data.weather[0] ? data.weather[0].main : '',
      // Check if precipitation expected (for umbrella indicator)
      hasRain: data.weather[0] && (
        data.weather[0].id >= 200 && data.weather[0].id < 700
      ),
    }

    cachedWeather = result
    lastWeatherFetch = now
    return result
  } catch (e) {
    return null
  }
}

// ─── ipgeolocation.io Astronomy API ──────────────────────────────────────────

/**
 * Fetch astronomy data (sunrise, sunset, moonrise, moonset, moon phase)
 * from ipgeolocation.io.
 * Returns { sunTime, sunIsRising, moonTime, moonIsRising, moonPhase } or null.
 */
async function fetchAstronomy(lat, lon) {
  const now = Date.now()
  if (cachedAstro && (now - lastAstroFetch) < ASTRO_CACHE_MS) {
    return cachedAstro
  }

  const apiKey = getSetting('ipgeo_api_key', '')
  if (!apiKey || !lat || !lon) return null

  try {
    const url = 'https://api.ipgeolocation.io/astronomy'
              + '?apiKey=' + encodeURIComponent(apiKey)
              + '&lat=' + lat + '&long=' + lon

    const resp = await fetch({ url, method: 'GET' })
    if (resp.status !== 200) return null

    const data = JSON.parse(await resp.text())

    // Determine next sun event
    const nowStr   = new Date().toTimeString().slice(0, 5)  // "HH:MM"
    const sunrise  = data.sunrise  // "HH:MM"
    const sunset   = data.sunset   // "HH:MM"
    const moonrise = data.moonrise // "HH:MM"
    const moonset  = data.moonset  // "HH:MM"

    const sunIsRising  = nowStr < sunset
    // moonIsRising = true when the moon hasn't risen yet today (show moonrise time)
    //                false when the moon is up or has already set (show moonset time)
    // Normal day (moonrise before moonset): moon is up when nowStr is between the two.
    // Inverted day (moonrise after moonset): moon is up outside the window.
    const moonIsRising = moonrise < moonset
      ? nowStr < moonrise                              // hasn't risen yet
      : nowStr < moonrise && nowStr > moonset          // both set already, next event is moonrise

    const sunTime  = sunIsRising  ? sunrise  : sunset
    const moonTime = moonIsRising ? moonrise : moonset

    // Moon phase: ipgeolocation returns 0-7 (we use the same indexing)
    const moonPhaseStr = (data.moon_phase || '').toLowerCase()
    const moonPhase = parseMoonPhase(moonPhaseStr)

    const result = { sunTime, sunIsRising, moonTime, moonIsRising, moonPhase }
    cachedAstro = result
    lastAstroFetch = now
    return result
  } catch (e) {
    return null
  }
}

/**
 * Map ipgeolocation moon phase string → 0–7 index
 */
function parseMoonPhase(str) {
  if (str.includes('new'))                return 0
  if (str.includes('waxing crescent'))    return 1
  if (str.includes('first quarter'))      return 2
  if (str.includes('waxing gibbous'))     return 3
  if (str.includes('full'))               return 4
  if (str.includes('waning gibbous'))     return 5
  if (str.includes('third quarter') || str.includes('last quarter')) return 6
  if (str.includes('waning crescent'))    return 7
  return 0
}

// ─── Geolocation ─────────────────────────────────────────────────────────────

let cachedLat = null
let cachedLon = null

/**
 * Get device location from settings (user-configured) or use a default.
 * For a production app, use the Zepp OS location API.
 */
function getLocation() {
  const lat = parseFloat(getSetting('latitude', ''))
  const lon = parseFloat(getSetting('longitude', ''))
  if (!isNaN(lat) && !isNaN(lon)) {
    cachedLat = lat
    cachedLon = lon
  }
  return { lat: cachedLat, lon: cachedLon }
}

// ─── Main handler: respond to watch requests ──────────────────────────────────

AppSideService({
  onInit() {
    messageBuilder.connect()

    messageBuilder.on('request', async (ctx) => {
      try {
        const payload = messageBuilder.buf2Json(ctx.request.payload)
        const action  = payload && payload.action

        if (action === 'fetchAll' || action === 'fetchGlucose') {
          const loc       = getLocation()
          const glucose   = await fetchGlucose()
          const weather   = await fetchWeather(loc.lat, loc.lon)
          const astronomy = await fetchAstronomy(loc.lat, loc.lon)

          // Calculate minutes since last reading
          let timeDelta = null
          if (glucose && glucose.timestamp) {
            timeDelta = Math.round((Date.now() - glucose.timestamp) / 60000)
          }

          ctx.response({
            data: {
              type: 'all',
              glucose: glucose ? {
                value:     glucose.value,
                delta:     glucose.delta,
                timeDelta: timeDelta,
              } : null,
              weather: weather ? {
                temp:     weather.temp,
                wind:     weather.windSpeed,
                windUnit: weather.windUnit,
                hasRain:  weather.hasRain,
              } : null,
              astronomy: astronomy || null,
            },
          })
        } else {
          ctx.response({ data: { error: 'unknown action' } })
        }
      } catch (e) {
        ctx.response({ data: { error: 'internal error' } })
      }
    })
  },

  onDestroy() {
    try { messageBuilder.disConnect() } catch (e) {}
  },
})
