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
  'weather_interval',
  'garbage_organic',
  'garbage_grey',
  'garbage_black',
  'garbage_hour',
]

const SELECT_FIELDS = new Set(['dexcom_region', 'bg_units', 'weather_units', 'weather_interval'])

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

const DEXCOM_APP_ID    = 'd89443d2-327c-4a6f-89e5-496bbb0317db'
const DEXCOM_APP_ID_JP = 'd8665ade-9673-4e27-9ff6-92db4ce13d13'
const DEXCOM_US_URL    = 'https://share2.dexcom.com/ShareWebServices/Services'
const DEXCOM_OUS_URL   = 'https://shareous1.dexcom.com/ShareWebServices/Services'
const DEXCOM_JP_URL    = 'https://share.dexcom.jp/ShareWebServices/Services'

const TREND_ARROWS = {
  'None': '\u2192', 'Flat': '\u2192',
  'DoubleUp': '\u2191\u2191', 'SingleUp': '\u2191',
  'FortyFiveUp': '\u2197', 'FortyFiveDown': '\u2198',
  'SingleDown': '\u2193', 'DoubleDown': '\u2193\u2193',
  'NotComputable': '?', 'RateOutOfRange': '\u26A0',
}

let _dexSessionId = null
let _dexAccountId = null

function dexcomBase(region) {
  if (region === 'jp')  return DEXCOM_JP_URL
  if (region === 'ous') return DEXCOM_OUS_URL
  return DEXCOM_US_URL
}

function dexcomAppId(region) {
  return region === 'jp' ? DEXCOM_APP_ID_JP : DEXCOM_APP_ID
}

function restoreDexSession() {
  if (_dexSessionId) return
  try {
    const raw = settingsLib.getItem('_dex_session')
    if (raw) {
      const obj = JSON.parse(raw)
      if (obj && obj.sid) { _dexSessionId = obj.sid; _dexAccountId = obj.aid || null }
    }
  } catch (_e) {}
}

function persistDexSession() {
  try {
    settingsLib.setItem('_dex_session', JSON.stringify({ sid: _dexSessionId, aid: _dexAccountId }))
  } catch (_e) {}
}

function clearDexSession() {
  _dexSessionId = null
  _dexAccountId = null
  try { settingsLib.setItem('_dex_session', '') } catch (_e) {}
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
      applicationId: dexcomAppId(region),
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
      applicationId: dexcomAppId(region),
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
  _dexSessionId = sid
  persistDexSession()
  return sid
}

async function fetchGlucose() {
  const username = getSetting('dexcom_username', '')
  const password = getSetting('dexcom_password', '')
  const region   = getSetting('dexcom_region', 'us')
  const units    = getSetting('bg_units', 'mgdl')

  if (!username || !password) return null

  restoreDexSession()

  try {
    if (!_dexSessionId) {
      _dexSessionId = await dexcomLogin(username, password, region)
    }

    const url = dexcomBase(region)
              + '/Publisher/ReadPublisherLatestGlucoseValues'
              + '?sessionId=' + encodeURIComponent(_dexSessionId)
              + '&minutes=1440&maxCount=1'

    let resp = await _fetch({ url, method: 'GET' })

    if (resp && resp.status === 500) {
      _dexSessionId = await dexcomLogin(username, password, region)
      resp = await _fetch({
        url: dexcomBase(region)
           + '/Publisher/ReadPublisherLatestGlucoseValues'
           + '?sessionId=' + encodeURIComponent(_dexSessionId)
           + '&minutes=1440&maxCount=1',
        method: 'GET',
      })
    }

    if (!resp || resp.status !== 200) return null

    const readings = JSON.parse(await resp.text())
    if (!readings || !readings.length) return null

    const latest = readings[0]
    const raw    = latest.Value

    // Parse reading age from Dexcom WT timestamp (.NET JSON date "/Date(epochMs)/")
    let ageMs = 0
    const wtMatch = (latest.WT || latest.ST || '').match(/Date\((\d+)/)
    if (wtMatch) {
      ageMs = Date.now() - parseInt(wtMatch[1], 10)
    }

    const displayValue = units === 'mmol'
      ? (raw / 18.0182).toFixed(1)
      : '' + raw

    const trendArrow = TREND_ARROWS[latest.Trend] || ''

    return { value: displayValue, raw, trendArrow, ageMs }
  } catch (e) {
    clearDexSession()
    return null
  }
}

function glucoseColor(rawMgdl) {
  if (rawMgdl == null || isNaN(rawMgdl)) return 0x888888
  if (rawMgdl > 180) return 0xFF5555
  if (rawMgdl < 72)  return 0xFF5555
  return 0x44FF44
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenWeatherMap
// ─────────────────────────────────────────────────────────────────────────────

let _cachedWeather = null
let _weatherCacheTime = 0
let _weatherCacheLat = null
let _weatherCacheLon = null

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = v => v * Math.PI / 180
  const R = 6371 // km
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat/2) * Math.sin(dLat/2)
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
          * Math.sin(dLon/2) * Math.sin(dLon/2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function hasPrecipitation(weatherArr) {
  if (!weatherArr) return false
  for (let i = 0; i < weatherArr.length; i++) {
    const id = weatherArr[i].id
    if (id >= 200 && id < 700) return true
  }
  return false
}

async function checkForecastPrecipitation(apiKey, units, lat, lon) {
  try {
    const url = 'https://api.openweathermap.org/data/2.5/forecast'
              + '?appid=' + encodeURIComponent(apiKey)
              + '&units=' + units
              + '&lat=' + lat + '&lon=' + lon
    const resp = await _fetch({ url, method: 'GET' })
    if (!resp || resp.status !== 200) return false

    const data = JSON.parse(await resp.text())
    if (!data.list) return false

    // Check remaining forecast entries for today
    const now = new Date()
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    const endTs = Math.floor(endOfDay.getTime() / 1000)

    for (let i = 0; i < data.list.length; i++) {
      const item = data.list[i]
      if (item.dt > endTs) break
      if ((item.pop || 0) > 0.3) return true
      if (item.rain && (item.rain['3h'] || item.rain['1h'])) return true
      if (item.snow && (item.snow['3h'] || item.snow['1h'])) return true
      if (hasPrecipitation(item.weather)) return true
    }
    return false
  } catch (e) {
    return false
  }
}

async function fetchWeather(lat, lon) {
  const apiKey = getSetting('owm_api_key', '')
  if (!apiKey || lat == null || lon == null) return null

  // Smart caching — return cached data if within interval and location unchanged
  const intervalMs = parseInt(getSetting('weather_interval', '60'), 10) * 60000
  const elapsed = Date.now() - _weatherCacheTime
  if (_cachedWeather && elapsed < intervalMs) {
    if (_weatherCacheLat != null && haversineDistance(lat, lon, _weatherCacheLat, _weatherCacheLon) < 5) {
      console.log('[RatScout] Using cached weather (' + Math.round(elapsed/60000) + 'm old)')
      return _cachedWeather
    }
  }

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
    const currentPrecip = weatherId >= 200 && weatherId < 700

    // Check forecast for rest of day
    const forecastPrecip = await checkForecastPrecipitation(apiKey, units, lat, lon)

    const result = {
      temp:     Math.round(data.main.temp),
      tempUnit: metric ? '\u00b0C' : '\u00b0F',
      wind:     Math.round(data.wind.speed),
      windUnit: metric ? 'm/s' : 'mph',
      needsUmbrella: currentPrecip || forecastPrecip,
    }

    _cachedWeather = result
    _weatherCacheTime = Date.now()
    _weatherCacheLat = lat
    _weatherCacheLon = lon

    return result
  } catch (e) {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Garbage bin schedule
// ─────────────────────────────────────────────────────────────────────────────

function parseDays(csv) {
  if (!csv) return new Set()
  return new Set(csv.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)))
}

function computeGarbageBags() {
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

    return {
      organic: organic.has(wday),
      grey:    grey.has(wday),
      black:   black.has(wday),
    }
  } catch (e) {
    return { organic: false, grey: false, black: false }
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
// Retry helper
// ─────────────────────────────────────────────────────────────────────────────

async function withRetry(fn, label, maxRetries, delayMs) {
  if (maxRetries === undefined) maxRetries = 2
  if (delayMs === undefined) delayMs = 2000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn()
      if (result !== null) return result
      if (attempt < maxRetries) {
        console.log('[RatScout] ' + label + ' returned null, retrying (' + (attempt + 1) + '/' + maxRetries + ')')
        await new Promise(r => setTimeout(r, delayMs))
      }
    } catch (e) {
      console.log('[RatScout] ' + label + ' attempt ' + (attempt + 1) + ' failed: ' + e.message)
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, delayMs))
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Master fetch — gather everything in parallel
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAll() {
  const { lat, lon } = await ensureLocation()

  const [glucose, weather] = await Promise.all([
    withRetry(() => fetchGlucose(), 'glucose'),
    withRetry(() => fetchWeather(lat, lon), 'weather'),
  ])

  const bags = computeGarbageBags()

  // Weekday string computed here so watchface does no calculations
  const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const weekday  = WEEKDAYS[new Date().getDay()] || '---'

  // Glucose staleness: >10 min → show "---", >5 min → gray color
  let glucoseResult = null
  if (glucose) {
    if (glucose.ageMs > 10 * 60 * 1000) {
      glucoseResult = { value: '---', trendArrow: '', color: 0x888888 }
    } else {
      glucoseResult = {
        value:      glucose.value,
        trendArrow: glucose.trendArrow || '',
        color:      glucose.ageMs > 5 * 60 * 1000 ? 0x888888 : glucoseColor(glucose.raw),
      }
    }
  }

  return {
    type: 'all',
    weekday,
    glucose: glucoseResult,
    weather:  weather || null,
    settings: {
      garbage: bags,
    },
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
        const SENSITIVE = ['dexcom_password', 'owm_api_key']
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
