/**
 * Rat Scout Settings — Companion App Side Service
 *
 * Runs on the phone inside the Zepp App.
 * Serves TWO roles:
 *   1. Settings provider — reads settingsStorage for the companion page
 *   2. Data fetcher — Dexcom CGM, weather, astronomy, garbage for the watchface
 *
 * The watchface sends its BLE shake with appId 1000090 (this app) because
 * the Zepp bridge does not properly install side services for appType "watchface".
 *
 * Uses @zeppos/zml BaseSideService pattern (official Zepp OS sample pattern).
 * AppSideService is a GLOBAL function — NOT imported from @zos/app.
 */

import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

// All setting keys that the watchface needs
const SETTINGS_KEYS = [
  'dexcom_username',
  'dexcom_password',
  'dexcom_region',
  'bg_units',
  'owm_api_key',
  'weather_units',
  'ipgeo_api_key',
  'garbage_organic',
  'garbage_grey',
  'garbage_black',
  'garbage_hour',
]

// Fields stored by Select components (value is a JSON-encoded {name, value} object)
const SELECT_FIELDS = new Set(['dexcom_region', 'bg_units', 'weather_units'])

/**
 * Read all settings from settingsLib, normalising the values:
 * - TextInput stores JSON-quoted strings: "\"hello\"" → "hello"
 * - Select stores JSON objects: "{\"name\":\"US\",\"value\":\"us\"}" → "us"
 * - Garbage day CSVs are plain strings: "0,3" → "0,3"
 */
function getAllSettings() {
  const result = {}
  for (const key of SETTINGS_KEYS) {
    try {
      const raw = settingsLib.getItem(key)
      if (raw === null || raw === undefined || raw === '') continue

      try {
        const parsed = JSON.parse(raw)
        if (SELECT_FIELDS.has(key) && typeof parsed === 'object' && parsed !== null) {
          result[key] = parsed.value !== undefined ? String(parsed.value) : raw
        } else if (typeof parsed === 'string') {
          result[key] = parsed
        } else if (typeof parsed === 'number') {
          result[key] = String(parsed)
        } else {
          result[key] = raw
        }
      } catch (_e) {
        result[key] = raw
      }
    } catch (_e) {}
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Dexcom Share API
// ─────────────────────────────────────────────────────────────────────────────

const DEXCOM_APP_ID  = 'd89443d2-327c-4a6f-89e5-496bbb0317db'
const DEXCOM_US_URL  = 'https://share2.dexcom.com/ShareWebServices/Services'
const DEXCOM_OUS_URL = 'https://shareous1.dexcom.com/ShareWebServices/Services'

let _dexSessionId = null
let _dexAccountId = null

function dexcomBase(region) {
  return region === 'ous' ? DEXCOM_OUS_URL : DEXCOM_US_URL
}

/**
 * Step 1: Authenticate account — returns accountId (GUID)
 * Uses /General/AuthenticatePublisherAccount with accountName.
 */
async function dexcomAuthenticate(username, password, region) {
  const url  = dexcomBase(region) + '/General/AuthenticatePublisherAccount'
  const resp = await _fetch({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountName:   username,
      password:      password,
      applicationId: DEXCOM_APP_ID,
    }),
  })
  if (!resp || resp.status !== 200) throw new Error('Dexcom auth failed: ' + (resp && resp.status))
  const text = await resp.text()
  const aid  = text.replace(/^"|"$/g, '')
  if (!aid || aid === '00000000-0000-0000-0000-000000000000') {
    throw new Error('Dexcom auth returned null account — check credentials')
  }
  return aid
}

/**
 * Step 2: Login with accountId — returns sessionId (GUID)
 * Uses /General/LoginPublisherAccountById with the GUID from step 1.
 */
async function dexcomLogin(username, password, region) {
  // Get accountId first (cached across calls)
  if (!_dexAccountId) {
    _dexAccountId = await dexcomAuthenticate(username, password, region)
  }

  const url  = dexcomBase(region) + '/General/LoginPublisherAccountById'
  const resp = await _fetch({
    url,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountId:     _dexAccountId,
      password:      password,
      applicationId: DEXCOM_APP_ID,
    }),
  })
  if (!resp || resp.status !== 200) {
    _dexAccountId = null  // force re-auth next time
    throw new Error('Dexcom login failed: ' + (resp && resp.status))
  }
  const text = await resp.text()
  const sid  = text.replace(/^"|"$/g, '')
  if (!sid || sid === '00000000-0000-0000-0000-000000000000') {
    _dexAccountId = null  // force re-auth next time
    throw new Error('Dexcom login returned null session — check credentials')
  }
  return sid
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

    let resp = await _fetch({ url, method: 'GET' })

    if (resp && resp.status === 500) {
      _dexSessionId = await dexcomLogin(username, password, region)
      resp = await _fetch({
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
    const raw    = latest.Value

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

    let timestamp = Date.now()
    try {
      const ms = parseInt(latest.WT.replace(/\/Date\((\d+)[^)]*\)\//, '$1'), 10)
      if (!isNaN(ms)) timestamp = ms
    } catch (e) {}

    return { value: displayValue, delta: deltaStr, timestamp }
  } catch (e) {
    _dexSessionId = null
    _dexAccountId = null
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
    const resp = await _fetch({ url, method: 'GET' })
    if (!resp || resp.status !== 200) return null

    const data = JSON.parse(await resp.text())

    // Weather condition codes 200-699 indicate precipitation
    // (2xx=Thunderstorm, 3xx=Drizzle, 5xx=Rain, 6xx=Snow)
    const weatherId = data.weather && data.weather[0] ? data.weather[0].id : 800
    const needsUmbrella = weatherId >= 200 && weatherId < 700

    return {
      temp:     Math.round(data.main.temp),
      tempUnit: metric ? '\u00b0C' : '\u00b0F',
      wind:     Math.round(data.wind.speed),
      windUnit: metric ? 'm/s' : 'mph',
      needsUmbrella,
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
    const resp = await _fetch({ url, method: 'GET' })
    if (!resp || resp.status !== 200) return null

    const data     = JSON.parse(await resp.text())
    const nowStr   = new Date().toTimeString().slice(0, 5)
    const sunrise  = data.sunrise  || 'N/A'
    const sunset   = data.sunset   || 'N/A'
    const moonrise = data.moonrise || 'N/A'
    const moonset  = data.moonset  || 'N/A'

    const sunIsRising  = sunrise !== 'N/A' && sunset !== 'N/A' && nowStr < sunset
    const sunTime      = sunIsRising ? sunrise : sunset

    let moonIsRising = true
    if (moonrise !== 'N/A' && moonset !== 'N/A') {
      if (moonrise < moonset) {
        moonIsRising = nowStr < moonrise
      } else {
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
  // API returns e.g. "LAST_QUARTER" — normalise underscores to spaces
  var s = str.replace(/_/g, ' ')
  if (s.includes('new'))             return 0
  if (s.includes('waxing crescent')) return 1
  if (s.includes('first quarter'))   return 2
  if (s.includes('waxing gibbous'))  return 3
  if (s.includes('full'))            return 4
  if (s.includes('waning gibbous'))  return 5
  if (s.includes('third quarter') || s.includes('last quarter')) return 6
  if (s.includes('waning crescent')) return 7
  return 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Garbage bin schedule
// ─────────────────────────────────────────────────────────────────────────────

function parseDays(csv) {
  if (!csv) return new Set()
  return new Set(csv.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)))
}

function computeGarbageBag() {
  try {
    const now  = new Date()
    let wday   = (now.getDay() + 6) % 7
    const pickupHour = parseInt(getSetting('garbage_hour', '9'), 10) || 9

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
// Settings helper — reads directly from companion settingsStorage
// ─────────────────────────────────────────────────────────────────────────────

function getSetting(key, fallback) {
  try {
    const raw = settingsLib.getItem(key)
    if (raw !== null && raw !== undefined && raw !== '') {
      try {
        const parsed = JSON.parse(raw)
        if (SELECT_FIELDS.has(key) && typeof parsed === 'object' && parsed !== null) {
          return parsed.value !== undefined ? String(parsed.value) : raw
        } else if (typeof parsed === 'string') {
          return parsed
        } else if (typeof parsed === 'number') {
          return String(parsed)
        }
        return raw
      } catch (_e) {
        return raw
      }
    }
  } catch (_e) {}
  return fallback
}

function getLocation() {
  // Check cached location from IP geolocation first
  if (_cachedLocation) return _cachedLocation
  const lat = parseFloat(getSetting('latitude', ''))
  const lon = parseFloat(getSetting('longitude', ''))
  return {
    lat: isNaN(lat) ? null : lat,
    lon: isNaN(lon) ? null : lon,
  }
}

// Cached IP-based location
let _cachedLocation = null

// ─────────────────────────────────────────────────────────────────────────────
// IP-based geolocation fallback
// ─────────────────────────────────────────────────────────────────────────────

async function fetchLocationByIp() {
  try {
    const resp = await _fetch({
      url: 'http://ip-api.com/json/?fields=status,lat,lon',
      method: 'GET',
    })
    if (resp && resp.status === 200) {
      const data = JSON.parse(await resp.text())
      if (data.status === 'success' && data.lat && data.lon) {
        return { lat: data.lat, lon: data.lon }
      }
    }
  } catch (e) {}

  try {
    const resp = await _fetch({
      url: 'https://ipapi.co/json/',
      method: 'GET',
    })
    if (resp && resp.status === 200) {
      const data = JSON.parse(await resp.text())
      if (data.latitude && data.longitude) {
        return { lat: data.latitude, lon: data.longitude }
      }
    }
  } catch (e) {}

  return null
}

async function ensureLocation() {
  let { lat, lon } = getLocation()
  if (lat !== null && lon !== null) return { lat, lon }

  const ipLoc = await fetchLocationByIp()
  if (ipLoc) {
    _cachedLocation = { lat: ipLoc.lat, lon: ipLoc.lon }
    return _cachedLocation
  }

  return { lat: null, lon: null }
}

// ─────────────────────────────────────────────────────────────────────────────
// Master fetch — gather everything in parallel
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAll() {
  const { lat, lon } = await ensureLocation()

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
// Network — resolve fetch at module scope via require
// ─────────────────────────────────────────────────────────────────────────────

let _fetch = null
try {
  // Rollup treats this as external; the runtime resolves it
  const net = require('@zos/app-side/network')
  _fetch = net && net.fetch ? net.fetch : null
} catch (_e) {}

// ─────────────────────────────────────────────────────────────────────────────
// AppSideService entry point
// ─────────────────────────────────────────────────────────────────────────────

AppSideService(BaseSideService({
  onInit() {
    // Try to resolve fetch from this context if module-level failed
    if (!_fetch) {
      try {
        if (typeof this.fetch === 'function') _fetch = this.fetch.bind(this)
      } catch (_e) {}
    }
    console.log('[RatScout] Side Service initialized, fetch available: ' + !!_fetch)
  },

  async onRequest(req, res) {
    try {
      const action = req && req.action

      // ── Settings request from companion page ────────────────────────────
      if (action === 'getSettings') {
        const settings = getAllSettings()
        const count    = Object.keys(settings).length
        console.log('[RatScout] Sending ' + count + ' settings to watch')
        res(null, { settings })
        return
      }

      // ── Data fetch request from watchface ───────────────────────────────
      if (action === 'fetchAll' || action === 'fetchGlucose') {
        if (!_fetch) {
          console.log('[RatScout] ERROR: fetch not available')
          res(null, { type: 'all', error: 'fetch not available' })
          return
        }

        const data = await fetchAll()
        console.log('[RatScout] fetchAll complete, glucose=' + (data.glucose ? data.glucose.value : 'null'))
        res(null, data)
        return
      }

      res(null, { error: 'unknown action: ' + action })
    } catch (e) {
      console.log('[RatScout] onRequest error: ' + e.message)
      try { res(null, { error: 'internal: ' + e.message }) } catch (_e2) {}
    }
  },

  onSettingsChange({ key, newValue, oldValue }) {
    console.log('[RatScout] Setting changed: ' + key)
  },

  onRun() {},

  onDestroy() {},
}))
