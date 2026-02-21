/**
 * Rat Scout — Zepp OS Watchface for Amazfit GTS 4 Mini (336×384)
 *
 * A faithful reimplementation of the Pebble Rat Scout watchface:
 * https://github.com/mollyjester/rat_scout
 *
 * Displays:
 *   - Time (HH:MM, 24h)
 *   - Dexcom CGM glucose reading + delta (via app-side Dexcom Share API)
 *   - Date (DD.MM) and ISO week number
 *   - Sunrise/sunset and moonrise/moonset times
 *   - Moon phase
 *   - Weather (temperature + wind speed) via OpenWeatherMap
 *   - Step count
 *   - Battery indicator
 *   - Weekday abbreviation
 */

import { WatchFace } from '@zos/app'
import { createWidget, widget, align, prop, setStatusBarVisible } from '@zos/ui'
import { Time, Pedometer, Battery, Weather } from '@zos/sensor'
import { messageBuilder } from '@zos/utils'

// ─── Screen dimensions ────────────────────────────────────────────────────────
const SCREEN_W = 336
const SCREEN_H = 384

// ─── Colour palette ──────────────────────────────────────────────────────────
const C_WHITE   = 0xFFFFFF
const C_BLACK   = 0x000000
const C_YELLOW  = 0xFFFF00
const C_CYAN    = 0x00FFFF
const C_RED     = 0xFF4040
const C_ORANGE  = 0xFF8C00
const C_GREEN   = 0x44FF44
const C_GRAY    = 0xAAAAAA
const C_DKGRAY  = 0x555555
const C_BG      = 0x000000

// ─── Font sizes ───────────────────────────────────────────────────────────────
const FONT_HUGE   = 96   // HH:MM time
const FONT_LARGE  = 48   // Glucose reading
const FONT_MED    = 36   // Date
const FONT_SMALL  = 28   // Delta, week, astronomy, weather, steps
const FONT_TINY   = 22   // Status bar labels

// ─── Layout zones (y-start) ───────────────────────────────────────────────────
//   STATUS BAR  : y=0   , h=38
//   TIME        : y=44  , h=130
//   GLUCOSE     : y=180 , h=72
//   DATE / WEEK : y=256 , h=50
//   ASTRO/WTHR  : y=308 , h=38
//   ASTRO2/WTHR2: y=346 , h=38

// Moon phase symbols (Unicode) for 8 phases
const MOON_PHASES = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']

// Weekday abbreviations
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ─── Widget handles (module-level so event handlers can update them) ──────────
let wTime, wDate, wWeek, wWeekday
let wGlucose, wDelta, wTimeDelta
let wSunIcon, wSunTime, wMoonIcon, wMoonTime
let wTemp, wWind, wSteps
let wBattery, wBatteryBar

// ─── Sensor instances ─────────────────────────────────────────────────────────
let timeSensor, pedometerSensor, batterySensor, weatherSensor

// ─── Cached remote data (from app-side) ───────────────────────────────────────
let glucoseValue = '--'
let glucoseDelta = ''
let glucoseTimeDelta = ''
let sunTime = '--:--'
let moonTime = '--:--'
let moonPhaseIdx = 0
let sunIsRising = true
let moonIsRising = true
let weatherTemp = ''
let weatherWind = ''

// ─── State ────────────────────────────────────────────────────────────────────
let lastHour = -1
let lastBatteryLevel = -1

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Zero-pad a number to at least 2 digits.
 */
function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

/**
 * Return the ISO week number for the given date.
 */
function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  // ISO week: Thursday of current week determines the year
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7)
}

/**
 * Determine glucose colour based on value.
 * High (>180 mg/dL), low (<70 mg/dL), or normal.
 */
function glucoseColor(valueStr) {
  const v = parseFloat(valueStr)
  if (isNaN(v)) return C_GRAY
  if (v > 180) return C_ORANGE
  if (v < 70) return C_RED
  return C_GREEN
}

// ─── Widget creation ──────────────────────────────────────────────────────────

function buildStatusBar() {
  // Dark background strip
  createWidget(widget.FILL_RECT, {
    x: 0, y: 0, w: SCREEN_W, h: 38,
    color: 0x1A1A1A,
    radius: 0,
  })

  // Weekday label (left)
  wWeekday = createWidget(widget.TEXT, {
    x: 10, y: 6, w: 80, h: 26,
    color: C_WHITE,
    text_size: FONT_TINY,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: '---',
  })

  // Battery percentage text (right side)
  wBattery = createWidget(widget.TEXT, {
    x: 240, y: 6, w: 56, h: 26,
    color: C_GRAY,
    text_size: FONT_TINY,
    align_h: align.RIGHT,
    align_v: align.CENTER_V,
    text: '--%',
  })

  // Battery bar background (dark outline, always full width)
  createWidget(widget.FILL_RECT, {
    x: 298, y: 10, w: 34, h: 18,
    color: C_DKGRAY,
    radius: 2,
  })

  // Battery bar fill (variable width and color, drawn on top of background)
  wBatteryBar = createWidget(widget.FILL_RECT, {
    x: 300, y: 12, w: 30, h: 14,
    color: C_GREEN,
    radius: 1,
  })
}

function buildTime() {
  wTime = createWidget(widget.TEXT, {
    x: 0, y: 44,
    w: SCREEN_W, h: 130,
    color: C_WHITE,
    text_size: FONT_HUGE,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: '--:--',
  })
}

function buildGlucoseZone() {
  // Large glucose value (left half)
  wGlucose = createWidget(widget.TEXT, {
    x: 0, y: 178,
    w: 190, h: 78,
    color: C_GREEN,
    text_size: FONT_LARGE,
    align_h: align.RIGHT,
    align_v: align.CENTER_V,
    text: glucoseValue,
  })

  // Glucose delta — rate of change (right half, small)
  wDelta = createWidget(widget.TEXT, {
    x: 196, y: 186,
    w: 140, h: 36,
    color: C_CYAN,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: glucoseDelta,
  })

  // Minutes since last CGM reading (below delta)
  wTimeDelta = createWidget(widget.TEXT, {
    x: 196, y: 222,
    w: 140, h: 30,
    color: C_GRAY,
    text_size: FONT_TINY,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: glucoseTimeDelta,
  })

  // Thin divider line below time
  createWidget(widget.FILL_RECT, {
    x: 8, y: 174, w: SCREEN_W - 16, h: 1, color: C_DKGRAY,
  })
}

function buildDateZone() {
  // Divider
  createWidget(widget.FILL_RECT, {
    x: 8, y: 252, w: SCREEN_W - 16, h: 1, color: C_DKGRAY,
  })

  // Date (left half)
  wDate = createWidget(widget.TEXT, {
    x: 0, y: 256,
    w: 180, h: 50,
    color: C_WHITE,
    text_size: FONT_MED,
    align_h: align.RIGHT,
    align_v: align.CENTER_V,
    text: '--.--.--',
  })

  // Week number (right half)
  wWeek = createWidget(widget.TEXT, {
    x: 186, y: 256,
    w: 150, h: 50,
    color: C_GRAY,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: 'W--',
  })
}

function buildAstronomyWeatherZone() {
  // Divider
  createWidget(widget.FILL_RECT, {
    x: 8, y: 306, w: SCREEN_W - 16, h: 1, color: C_DKGRAY,
  })

  // ── Left column: Sun & Moon ────────────────────────────────────────────────

  // Sun direction/icon label (updateable so arrow flips when data arrives)
  wSunIcon = createWidget(widget.TEXT, {
    x: 10, y: 310, w: 36, h: 36,
    color: C_YELLOW,
    text_size: FONT_SMALL,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: '↑☀',
  })

  // Sun time
  wSunTime = createWidget(widget.TEXT, {
    x: 46, y: 310, w: 90, h: 36,
    color: C_WHITE,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: sunTime,
  })

  // Moon phase icon (updateable)
  wMoonIcon = createWidget(widget.TEXT, {
    x: 10, y: 348, w: 36, h: 36,
    color: C_GRAY,
    text_size: FONT_SMALL,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: MOON_PHASES[moonPhaseIdx],
  })

  // Moon time
  wMoonTime = createWidget(widget.TEXT, {
    x: 46, y: 348, w: 90, h: 36,
    color: C_WHITE,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: moonTime,
  })

  // ── Right column: Weather & Steps ─────────────────────────────────────────

  // Temperature (top right, first half)
  createWidget(widget.TEXT, {
    x: 168, y: 310, w: 26, h: 36,
    color: C_ORANGE,
    text_size: FONT_SMALL,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: '🌡',
  })
  wTemp = createWidget(widget.TEXT, {
    x: 194, y: 310, w: 62, h: 36,
    color: C_WHITE,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: '--',
  })

  // Wind speed (top right, second half — same row as temperature)
  createWidget(widget.TEXT, {
    x: 258, y: 310, w: 26, h: 36,
    color: C_CYAN,
    text_size: FONT_SMALL,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: '🌬',
  })
  wWind = createWidget(widget.TEXT, {
    x: 284, y: 310, w: 52, h: 36,
    color: C_WHITE,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: '--',
  })

  // Steps (bottom right)
  createWidget(widget.TEXT, {
    x: 168, y: 348, w: 26, h: 36,
    color: C_CYAN,
    text_size: FONT_SMALL,
    align_h: align.CENTER_H,
    align_v: align.CENTER_V,
    text: '👟',
  })
  wSteps = createWidget(widget.TEXT, {
    x: 194, y: 348, w: 142, h: 36,
    color: C_WHITE,
    text_size: FONT_SMALL,
    align_h: align.LEFT,
    align_v: align.CENTER_V,
    text: '0',
  })
}

// ─── Update functions ─────────────────────────────────────────────────────────

function updateTime() {
  const info = timeSensor.getTime()
  const h = info.hour
  const m = info.minute

  wTime.setProperty(prop.TEXT, pad2(h) + ':' + pad2(m))

  // Update date/week/weekday once per hour (catches midnight transition)
  if (h !== lastHour) {
    lastHour = h
    updateDate(info)
  }
}

function updateDate(info) {
  if (!info) info = timeSensor.getTime()
  const d = info.day
  const mo = info.month
  const wd = info.week // 0=Sun
  const year = info.year

  wDate.setProperty(prop.TEXT, pad2(d) + '.' + pad2(mo))

  const date = new Date(year, mo - 1, d)
  const week = isoWeek(date)
  wWeek.setProperty(prop.TEXT, 'W' + pad2(week))

  wWeekday.setProperty(prop.TEXT, WEEKDAYS[wd] || '---')
}

function updateBattery() {
  const level = batterySensor.getCurrent()
  if (level === undefined || level === null) return
  if (level === lastBatteryLevel) return

  lastBatteryLevel = level
  wBattery.setProperty(prop.TEXT, level + '%')

  // Color-code battery bar
  let barColor
  if (level > 50) barColor = C_GREEN
  else if (level > 20) barColor = C_YELLOW
  else barColor = C_RED

  wBatteryBar.setProperty(prop.MORE, {
    color: barColor,
    w: Math.max(0, Math.round(30 * level / 100)),
  })
}

function updateSteps() {
  const steps = pedometerSensor.getStepCount()
  if (steps === undefined || steps === null) return
  const formatted = steps >= 1000
    ? (steps / 1000).toFixed(1) + 'k'
    : '' + steps
  wSteps.setProperty(prop.TEXT, formatted)
}

function updateGlucose(value, delta, timeDeltaMin) {
  glucoseValue = value || '--'
  glucoseDelta = delta || ''
  glucoseTimeDelta = timeDeltaMin ? timeDeltaMin + 'm' : ''

  wGlucose.setProperty(prop.TEXT, glucoseValue)
  wGlucose.setProperty(prop.MORE, { color: glucoseColor(glucoseValue) })
  wDelta.setProperty(prop.TEXT, glucoseDelta)
  wTimeDelta.setProperty(prop.TEXT, glucoseTimeDelta)
}

function updateAstronomy(data) {
  if (data.sunTime) {
    sunTime = data.sunTime
    wSunTime.setProperty(prop.TEXT, sunTime)
  }
  if (typeof data.sunIsRising === 'boolean') {
    sunIsRising = data.sunIsRising
    wSunIcon.setProperty(prop.TEXT, sunIsRising ? '↑☀' : '↓☀')
  }
  if (data.moonTime) {
    moonTime = data.moonTime
    wMoonTime.setProperty(prop.TEXT, moonTime)
  }
  if (typeof data.moonPhase === 'number') {
    moonPhaseIdx = data.moonPhase
    wMoonIcon.setProperty(prop.TEXT, MOON_PHASES[moonPhaseIdx] || MOON_PHASES[0])
  }
}

function updateWeather(data) {
  if (data.temp !== undefined) {
    weatherTemp = data.temp + '°'
    wTemp.setProperty(prop.TEXT, weatherTemp)
  }
  if (data.wind !== undefined) {
    weatherWind = data.wind + (data.windUnit || '')
    wWind.setProperty(prop.TEXT, weatherWind)
  }
}

// ─── App-side message handling ────────────────────────────────────────────────

function setupMessaging() {
  try {
    messageBuilder.connect()

    messageBuilder.on('call', (data) => {
      try {
        const payload = messageBuilder.buf2Json(data.payload)
        handleAppSideMessage(payload)
      } catch (e) {
        // ignore parse errors
      }
    })

    // Request fresh data from app-side on startup
    requestRemoteData()
  } catch (e) {
    // Messaging may not be available in all environments
  }
}

function requestRemoteData() {
  try {
    messageBuilder.request(
      { action: 'fetchAll' },
      { timeout: 30000 }
    ).then((res) => {
      if (res && res.data) handleAppSideMessage(res.data)
    }).catch(() => {
      // Network or device not connected — show cached/placeholder values
    })
  } catch (e) {
    // ignore
  }
}

function handleAppSideMessage(msg) {
  if (!msg) return

  if (msg.type === 'glucose') {
    updateGlucose(msg.value, msg.delta, msg.timeDelta)
  } else if (msg.type === 'astronomy') {
    updateAstronomy(msg)
  } else if (msg.type === 'weather') {
    updateWeather(msg)
  } else if (msg.type === 'all') {
    // Combined payload
    if (msg.glucose) updateGlucose(msg.glucose.value, msg.glucose.delta, msg.glucose.timeDelta)
    if (msg.astronomy) updateAstronomy(msg.astronomy)
    if (msg.weather) updateWeather(msg.weather)
  }
}

// ─── Watchface entry point ────────────────────────────────────────────────────

WatchFace({
  onInit() {
    // Hide system status bar so we draw our own
    setStatusBarVisible(false)

    // Initialise sensors
    timeSensor      = new Time()
    pedometerSensor = new Pedometer()
    batterySensor   = new Battery()
    weatherSensor   = new Weather()
  },

  build() {
    buildStatusBar()
    buildTime()
    buildGlucoseZone()
    buildDateZone()
    buildAstronomyWeatherZone()

    // Populate initial values from sensors
    updateTime()
    updateDate()
    updateBattery()
    updateSteps()

    // Try to get weather from built-in sensor first
    try {
      const w = weatherSensor.getWeatherInfo()
      if (w) {
        const current = (w.current) || (Array.isArray(w) && w[0]) || w
        if (current && current.temp !== undefined) {
          updateWeather({
            temp: current.temp,
            wind: current.windSpeed || current.wind || 0,
            windUnit: 'm/s',
          })
        }
      }
    } catch (e) {
      // Built-in weather sensor may not be available
    }

    // Register event-driven sensor callbacks (more efficient than setInterval)
    timeSensor.onPerMinute(() => {
      updateTime()
    })
    batterySensor.onChange(() => {
      updateBattery()
    })
    pedometerSensor.onChange(() => {
      updateSteps()
    })

    // Connect to app-side for Dexcom CGM + astronomy data
    setupMessaging()
  },

  onDestroy() {
    // Deregister sensor callbacks to prevent leaks
    try { timeSensor.offPerMinute() } catch (e) {}
    try { batterySensor.offChange() } catch (e) {}
    try { pedometerSensor.offChange() } catch (e) {}
    try { messageBuilder.disConnect() } catch (e) {}
  },
})
