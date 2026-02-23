/**
 * Rat Scout — Zepp OS App-side Service
 *
 * Runs on the phone inside the Zepp app. Responsible for:
 *   1. Fetching Dexcom CGM glucose data from the Dexcom Share API
 *   2. Fetching weather from OpenWeatherMap
 *   3. Fetching astronomy data from ipgeolocation.io
 *   4. Computing garbage bin schedule
 *   5. Responding to watch requests and pushing live updates
 *
 * Settings keys (configured via Zepp app settings page):
 *   dexcom_username   — Dexcom Share account username/email
 *   dexcom_password   — Dexcom Share account password
 *   dexcom_region     — 'us' | 'ous' (default 'us')
 *   bg_units          — 'mgdl' | 'mmol' (default 'mgdl')
 *   owm_api_key       — OpenWeatherMap API key
 *   weather_units     — 'metric' | 'imperial' (default 'metric')
 *   ipgeo_api_key     — ipgeolocation.io API key
 *   latitude          — User latitude (decimal, e.g. "51.5074")
 *   longitude         — User longitude (decimal, e.g. "-0.1278")
 *   garbage_organic   — CSV of day numbers (0=Mon … 6=Sun) e.g. "0,3"
 *   garbage_grey      — CSV of day numbers
 *   garbage_black     — CSV of day numbers
 *   garbage_hour      — Hour after which next-day bag shown (default "9")
 */

import { AppSideService } from '@zos/app'
import { messageBuilder } from '@zos/utils'
import { fetch } from '@zos/app-side/network'
import { settingsStorage } from '@zos/app-side/settings'

// ─────────────────────────────────────────────────────────────────────────────
// Dexcom Share API
// ─────────────────────────────────────────────────────────────────────────────

const DEXCOM_APP_ID  = 'd89443d2-327c-4a6f-89e5-496bbb0317db'
const DEXCOM_US_URL  = 'https://share2.dexcom.com/ShareWebServices/Services'
const DEXCOM_OUS_URL = 'https://shareous1.dexcom.com/ShareWebServices/Services'

// Session ID cached across identical invocations (app-side service stays alive)
let _dexSessionId = null

function dexcomBase(region) {
  return region === 'ous' ? DEXCOM_OUS_URL : DEXCOM_US_URL
}

async function dexcomLogin(username, password, region) {
  const url  = dexcomBase(region) + '/General/LoginPublisherAccountById'
  const resp = await fetch({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountName:   username,
      password:      password,
      applicationId: DEXCOM_APP_ID,
    }),
  })
  if (!resp || resp.status !== 200) throw new Error('Dexcom login failed: ' + (resp && resp.status))
  const text = await resp.text()
  return text.replace(/^"|"$/g, '')  // strip surrounding quotes
}

async function fetchGlucose() {
  const username = getSetting('dexcom_username', '')
  const password = getSetting('dexcom_password', '')
  const region   = getSetting('dexcom_region', 'us')
  const units    = getSetting('bg_units', 'mgdl')

  if (!username || !password) return null

  try {
    if (!_dexSessionId) {
      _dexSessionId = await dexcomLogin(username, password, region)
    }

    const url = dexcomBase(region)
              + '/Publisher/ReadPublisherLatestGlucoseValues'
              + '?sessionId=' + encodeURIComponent(_dexSessionId)
              + '&minutes=1440&maxCount=2'

    let resp = await fetch({ url, method: 'GET' })

    // Session expired → re-authenticate once
    if (resp && resp.status === 500) {
      _dexSessionId = await dexcomLogin(username, password, region)
      resp = await fetch({
        url: dexcomBase(region)
           + '/Publisher/ReadPublisherLatestGlucoseValues'
           + '?sessionId=' + encodeURIComponent(_dexSessionId)
           + '&minutes=1440&maxCount=2',
        method: 'GET',
      })
    }

    if (!resp || resp.status !== 200) return null

    const readings = JSON.parse(await resp.text())
    if (!readings || !readings.length) return null

    const latest = readings[0]
    const prev   = readings[1]
    const raw    = latest.Value   // mg/dL integer

    let displayValue, deltaStr
    if (units === 'mmol') {
      const mmol     = (raw / 18.0).toFixed(1)
      const prevMmol = prev ? (prev.Value / 18.0).toFixed(1) : null
      displayValue   = mmol
      deltaStr       = prevMmol !== null
        ? formatDelta((parseFloat(mmol) - parseFloat(prevMmol)).toFixed(1))
        : ''
    } else {
      const d  = prev ? raw - prev.Value : null
      displayValue = '' + raw
      deltaStr     = d !== null ? formatDelta(d) : ''
    }

    // Parse Dexcom WCF timestamp: \/Date(1234567890000+0000)\/
    let timestamp = Date.now()
    try {
      const ms = parseInt(latest.WT.replace(/\/Date\((\d+)[^)]*\)\//, '$1'), 10)
      if (!isNaN(ms)) timestamp = ms
    } catch (e) {}

    return { value: displayValue, delta: deltaStr, timestamp }
  } catch (e) {
    _dexSessionId = null  // force re-auth on next attempt
    return null
  }
}

function formatDelta(d) {
  const n = typeof d === 'string' ? parseFloat(d) : d
  if (isNaN(n)) return ''
  const sign = n > 0 ? '+' : ''
  return sign + (Number.isInteger(n) ? n : n.toFixed(1))
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenWeatherMap
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWeather(lat, lon) {
  const apiKey = getSetting('owm_api_key', '')
  if (!apiKey || lat == null || lon == null) return null

  const metric = getSetting('weather_units', 'metric') !== 'imperial'
  const units  = metric ? 'metric' : 'imperial'
  const url    = 'https://api.openweathermap.org/data/2.5/weather'
               + '?appid=' + encodeURIComponent(apiKey)
               + '&units=' + units
               + '&lat=' + lat + '&lon=' + lon

  try {
    const resp = await fetch({ url, method: 'GET' })
    if (!resp || resp.status !== 200) return null

    const data = JSON.parse(await resp.text())
    return {
      temp:     Math.round(data.main.temp),
      tempUnit: metric ? '\u00b0C' : '\u00b0F',
      wind:     Math.round(data.wind.speed),
      windUnit: metric ? 'm/s' : 'mph',
    }
  } catch (e) {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ipgeolocation.io Astronomy
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAstronomy(lat, lon) {
  const apiKey = getSetting('ipgeo_api_key', '')
  if (!apiKey || lat == null || lon == null) return null

  const url = 'https://api.ipgeolocation.io/astronomy'
            + '?apiKey=' + encodeURIComponent(apiKey)
            + '&lat=' + lat + '&long=' + lon

  try {
    const resp = await fetch({ url, method: 'GET' })
    if (!resp || resp.status !== 200) return null

    const data     = JSON.parse(await resp.text())
    const nowStr   = new Date().toTimeString().slice(0, 5)  // "HH:MM"
    const sunrise  = data.sunrise  || 'N/A'
    const sunset   = data.sunset   || 'N/A'
    const moonrise = data.moonrise || 'N/A'
    const moonset  = data.moonset  || 'N/A'

    const sunIsRising  = sunrise !== 'N/A' && sunset !== 'N/A' && nowStr < sunset
    const sunTime      = sunIsRising ? sunrise : sunset

    // moonIsRising = true when next event is a moonrise (moon hasn't risen yet)
    let moonIsRising = true
    if (moonrise !== 'N/A' && moonset !== 'N/A') {
      if (moonrise < moonset) {
        moonIsRising = nowStr < moonrise
      } else {
        // Inverted: moonset comes before moonrise today
        moonIsRising = nowStr > moonset || nowStr < moonrise
      }
    }
    const moonTime = moonIsRising ? moonrise : moonset

    return {
      sunTime,
      sunIsRising,
      moonTime,
      moonIsRising,
      moonPhase: parseMoonPhase((data.moon_phase || '').toLowerCase()),
    }
  } catch (e) {
    return null
  }
}

function parseMoonPhase(str) {
  if (str.includes('new'))             return 0
  if (str.includes('waxing crescent')) return 1
  if (str.includes('first quarter'))   return 2
  if (str.includes('waxing gibbous'))  return 3
  if (str.includes('full'))            return 4
  if (str.includes('waning gibbous'))  return 5
  if (str.includes('third quarter') || str.includes('last quarter')) return 6
  if (str.includes('waning crescent')) return 7
  return 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Garbage bin schedule
// ─────────────────────────────────────────────────────────────────────────────
// Days stored as comma-separated day numbers: 0=Mon, 1=Tue, … 6=Sun
// (matches Pebble version convention which converts JS's 0=Sun to 0=Mon)

function parseDays(csv) {
  if (!csv) return new Set()
  return new Set(csv.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)))
}

function computeGarbageBag() {
  try {
    const now         = new Date()
    // Convert JS weekday (0=Sun … 6=Sat) to Mon-based (0=Mon … 6=Sun)
    let wday          = (now.getDay() + 6) % 7
    const pickupHour  = parseInt(getSetting('garbage_hour', '9'), 10) || 9

    // After the pickup hour the street's already been cleared — show tomorrow
    if (now.getHours() >= pickupHour) {
      wday = (wday + 1) % 7
    }

    const organic = parseDays(getSetting('garbage_organic', ''))
    const grey    = parseDays(getSetting('garbage_grey', ''))
    const black   = parseDays(getSetting('garbage_black', ''))

    if (organic.has(wday)) return 'O'
    if (grey.has(wday))    return 'G'
    if (black.has(wday))   return 'B'
    return null
  } catch (e) {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings helper
// ─────────────────────────────────────────────────────────────────────────────

function getSetting(key, fallback) {
  try {
    const v = settingsStorage.getItem(key)
    return (v !== null && v !== undefined && v !== '') ? v : fallback
  } catch (e) {
    return fallback
  }
}

function getLocation() {
  const lat = parseFloat(getSetting('latitude', ''))
  const lon = parseFloat(getSetting('longitude', ''))
  return {
    lat: isNaN(lat) ? null : lat,
    lon: isNaN(lon) ? null : lon,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Master fetch — gather everything in parallel
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAll() {
  const { lat, lon } = getLocation()

  const [glucose, weather, astronomy] = await Promise.all([
    fetchGlucose(),
    fetchWeather(lat, lon),
    fetchAstronomy(lat, lon),
  ])

  const timeDelta = (glucose && glucose.timestamp)
    ? Math.round((Date.now() - glucose.timestamp) / 60000)
    : null

  const bag = computeGarbageBag()

  return {
    type: 'all',
    glucose: glucose ? {
      value:     glucose.value,
      delta:     glucose.delta,
      timeDelta: timeDelta,
    } : null,
    weather:   weather || null,
    astronomy: astronomy || null,
    settings:  bag ? { garbageBag: bag } : null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// App-side service entry point
// ─────────────────────────────────────────────────────────────────────────────

AppSideService({
  onInit() {
    try {
      messageBuilder.connect()

      messageBuilder.on('request', async (ctx) => {
        try {
          const payload = messageBuilder.buf2Json(ctx.request.payload)
          const action  = payload && payload.action

          if (action === 'fetchAll' || action === 'fetchGlucose') {
            const data = await fetchAll()
            ctx.response({ data })
          } else {
            ctx.response({ data: { error: 'unknown action: ' + action } })
          }
        } catch (e) {
          try { ctx.response({ data: { error: 'internal error' } }) } catch (e2) {}
        }
      })
    } catch (e) {}
  },

  onRun() {},

  onDestroy() {
    try { messageBuilder.disConnect() } catch (e) {}
  },
})
