/**
 * Rat Scout — Companion App Side Service
 *
 * Runs on the phone inside the Zepp App.
 * Handles TWO types of BLE requests:
 *
 *   1. "getSettings" — from companion watch page (appId 1000090): returns all
 *      settings from settingsStorage so the page can write them to hmFS.
 *
 *   2. "fetchAll" — from the watchface (appId 1000089 routes here via
 *      companion appId 1000090): fetches live data from external APIs and
 *      returns it to the watchface for display.
 *      Settings arrive in the BLE request payload (the watchface reads them
 *      from rat_scout_settings.json written by the companion page).
 *
 * Data sources:
 *   - Dexcom Share (CGM glucose readings)
 *   - OpenWeatherMap (temperature, wind)
 *   - ipgeolocation.io (sunrise/sunset, moonrise/moonset, moon phase)
 *   - ip-api.com / ipapi.co (IP-based geolocation fallback)
 *   - Garbage bag schedule (computed from settings)
 *
 * Uses @zeppos/zml BaseSideService for BLE message handling.
 * AppSideService is a GLOBAL function — NOT imported.
 */

import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

// ─────────────────────────────────────────────────────────────────────────────
// Settings — getSettings handler (companion page reads settingsStorage)
// ─────────────────────────────────────────────────────────────────────────────

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

const SELECT_FIELDS = new Set(['dexcom_region', 'bg_units', 'weather_units'])

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
// Settings — fetchAll handler reads directly from settingsLib
// ─────────────────────────────────────────────────────────────────────────────

function getSetting(key, fallback) {
  const all = getAllSettings()
  const val = all[key]
  return (val !== undefined && val !== null && val !== '') ? val : fallback
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

async function dexcomLogin(username, password, region) {
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
    _dexAccountId = null
    throw new Error('Dexcom login failed: ' + (resp && resp.status))
  }
  const text = await resp.text()
  const sid  = text.replace(/^"|"$/g, '')
  if (!sid || sid === '00000000-0000-0000-0000-000000000000') {
    _dexAccountId = null
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
      displayValue = (raw / 18.0182).toFixed(1)
      deltaStr     = prev
        ? formatDelta(((raw - prev.Value) / 18.0182).toFixed(1))
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

    return { value: displayValue, delta: deltaStr, timestamp, raw }
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

function glucoseColor(rawMgdl) {
  if (rawMgdl == null || isNaN(rawMgdl)) return 0x888888
  if (rawMgdl > 180) return 0xFF8C00
  if (rawMgdl < 70)  return 0xFF3030
  return 0x44FF44
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
      moonTime,
      moonPhase: parseMoonPhase((data.moon_phase || '').toLowerCase()),
    }
  } catch (e) {
    return null
  }
}

function parseMoonPhase(str) {
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
// IP-based geolocation
// ─────────────────────────────────────────────────────────────────────────────

let _cachedLocation = null

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
  if (_cachedLocation) return _cachedLocation

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

  // Weekday string computed here so watchface does no calculations
  const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const weekday  = WEEKDAYS[new Date().getDay()] || '---'

  return {
    type: 'all',
    weekday,
    glucose: glucose ? {
      value:     glucose.value,
      delta:     glucose.delta,
      timeDelta: timeDelta !== null ? timeDelta + 'm' : '',
      color:     glucoseColor(glucose.raw),
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
  const net = require('@zos/app-side/network')
  _fetch = net && net.fetch ? net.fetch : null
} catch (_e) {}

// ─────────────────────────────────────────────────────────────────────────────
// AppSideService entry point
// ─────────────────────────────────────────────────────────────────────────────

AppSideService(BaseSideService({
  onInit() {
    if (!_fetch) {
      try {
        if (typeof this.fetch === 'function') _fetch = this.fetch.bind(this)
      } catch (_e) {}
    }
    console.log('[RatScout] Companion Side Service initialized, fetch available: ' + !!_fetch)
  },

  async onRequest(req, res) {
    try {
      const action = req && req.action

      // ── getSettings: return all settings to companion page ──
      if (action === 'getSettings') {
        const settings = getAllSettings()
        // Never send credentials/API keys over BLE — the watch doesn't need them;
        // only the phone-side service uses them for API calls.
        const SENSITIVE = ['dexcom_password', 'owm_api_key', 'ipgeo_api_key']
        for (const k of SENSITIVE) delete settings[k]
        const count = Object.keys(settings).length
        console.log('[RatScout] Sending ' + count + ' settings to watch (sensitive keys filtered)')
        res(null, { settings })
        return
      }

      // ── fetchAll: fetch live data for the watchface ──
      if (action === 'fetchAll') {
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

  onSettingsChange({ key }) {
    console.log('[RatScout] Setting changed: ' + key)
  },

  onRun() {},

  onDestroy() {},
}))
