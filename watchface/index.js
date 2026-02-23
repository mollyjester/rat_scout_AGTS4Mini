/**
 * Rat Scout — Zepp OS Watchface for Amazfit GTS 4 Mini (336×384)
 *
 * Reimplementation of https://github.com/mollyjester/rat_scout
 *
 * Layout (portrait 336×384):
 *   y=  0  h=42   Status bar: weekday | garbage bag | battery
 *   y= 44  h=116  Time  (HH:MM, large)
 *   y=162  h=82   Glucose zone (CGM value | delta + age)
 *   y=246  h=54   Date zone (DD.MM | Wnn)
 *   y=302  h=82   Bottom zone: [sun/moon] | [temp / wind+steps]
 */

import WatchFace from '@zos/app'
import { createWidget, widget, align, prop, setStatusBarVisible } from '@zos/ui'
import { Time, Pedometer, Battery } from '@zos/sensor'
import { messageBuilder } from '@zos/utils'

// ── Screen ───────────────────────────────────────────────────────────────────
const W = 336
const H = 384

// ── Colours ──────────────────────────────────────────────────────────────────
const C_WHITE  = 0xFFFFFF
const C_YELLOW = 0xFFFF00
const C_CYAN   = 0x00FFFF
const C_RED    = 0xFF3030
const C_ORANGE = 0xFF8C00
const C_GREEN  = 0x44FF44
const C_GRAY   = 0x888888
const C_DKGRAY = 0x333333
const C_BAR    = 0x141414

// ── Font sizes ────────────────────────────────────────────────────────────────
const FS_TIME  = 80
const FS_GLUC  = 48
const FS_DATE  = 34
const FS_NORM  = 26
const FS_SMALL = 20

// ── Moon phase labels (ASCII — device fonts do not carry emoji) ───────────────
const MOON_PHASE_LABELS = ['NM', 'wC', 'FQ', 'wG', 'FM', 'WG', 'LQ', 'WC']

// ── Weekday abbreviations ─────────────────────────────────────────────────────
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

// ── Garbage bag labels ────────────────────────────────────────────────────────
const GARBAGE_LABEL = { O: 'ORG', G: 'GRY', B: 'BLK' }

// ── Widget refs (populated in build functions) ────────────────────────────────
const R = {}

// ── Sensors ───────────────────────────────────────────────────────────────────
let _time, _ped, _bat

// ── State ─────────────────────────────────────────────────────────────────────
let _lastHour = -1

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function isoWeek(date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  const yearStart = new Date(d.getFullYear(), 0, 1)
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
}

function glucoseColor(str) {
  const v = parseFloat(str)
  if (isNaN(v)) return C_GRAY
  if (v > 180)  return C_ORANGE
  if (v < 70)   return C_RED
  return C_GREEN
}

/** Safe createWidget — returns null instead of throwing */
function mkw(type, params) {
  try { return createWidget(type, params) } catch (e) { return null }
}

/** Safe setProperty — silently skips null widget refs */
function setp(wref, key, val) {
  try { if (wref) wref.setProperty(key, val) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout builders
// ─────────────────────────────────────────────────────────────────────────────

function buildStatusBar() {
  // Dark background strip
  mkw(widget.FILL_RECT, { x: 0, y: 0, w: W, h: 42, color: C_BAR, radius: 0 })

  // Weekday abbreviation (left)
  R.weekday = mkw(widget.TEXT, {
    x: 8, y: 2, w: 72, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '---',
  })

  // Garbage bag indicator (centre-left)
  R.garbage = mkw(widget.TEXT, {
    x: 84, y: 2, w: 72, h: 38,
    color: C_CYAN, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '',
  })

  // Battery percentage text
  R.batPct = mkw(widget.TEXT, {
    x: 196, y: 2, w: 66, h: 38,
    color: C_GRAY, text_size: FS_SMALL,
    align_h: align.RIGHT, align_v: align.CENTER_V,
    text: '--%',
  })

  // Battery bar — dark background
  mkw(widget.FILL_RECT, { x: 266, y: 13, w: 62, h: 16, color: C_DKGRAY, radius: 2 })

  // Battery bar — coloured fill (width updated dynamically)
  R.batBar = mkw(widget.FILL_RECT, {
    x: 268, y: 15, w: 58, h: 12, color: C_GREEN, radius: 1,
  })
}

function buildTimeZone() {
  R.time = mkw(widget.TEXT, {
    x: 0, y: 44, w: W, h: 116,
    color: C_WHITE, text_size: FS_TIME,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: '--:--',
  })
}

function buildGlucoseZone() {
  mkw(widget.FILL_RECT, { x: 8, y: 161, w: W - 16, h: 1, color: C_DKGRAY })

  // Large CGM glucose reading (left half)
  R.glucose = mkw(widget.TEXT, {
    x: 0, y: 162, w: 200, h: 82,
    color: C_GREEN, text_size: FS_GLUC,
    align_h: align.RIGHT, align_v: align.CENTER_V,
    text: '---',
  })

  // Rate-of-change delta (top-right of glucose zone)
  R.delta = mkw(widget.TEXT, {
    x: 208, y: 164, w: 128, h: 36,
    color: C_CYAN, text_size: FS_NORM,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '',
  })

  // Minutes since last reading (bottom-right of glucose zone)
  R.timeDelta = mkw(widget.TEXT, {
    x: 208, y: 204, w: 128, h: 36,
    color: C_GRAY, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '',
  })
}

function buildDateZone() {
  mkw(widget.FILL_RECT, { x: 8, y: 245, w: W - 16, h: 1, color: C_DKGRAY })

  // Date: DD.MM (left)
  R.date = mkw(widget.TEXT, {
    x: 0, y: 247, w: 176, h: 52,
    color: C_WHITE, text_size: FS_DATE,
    align_h: align.RIGHT, align_v: align.CENTER_V,
    text: '--:--',
  })

  // ISO week: Wnn (right)
  R.week = mkw(widget.TEXT, {
    x: 184, y: 247, w: 152, h: 52,
    color: C_GRAY, text_size: FS_DATE,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: 'W--',
  })
}

function buildBottomZone() {
  mkw(widget.FILL_RECT, { x: 8, y: 301, w: W - 16, h: 1, color: C_DKGRAY })
  // Vertical divider between left (sun/moon) and right (weather/steps) columns
  mkw(widget.FILL_RECT, { x: 168, y: 303, w: 1, h: 79, color: C_DKGRAY })

  // ── Left: Sun row ───────────────────────────────────────────────────────────
  // "SR" = sunrise coming, "SS" = sunset coming
  R.sunDir = mkw(widget.TEXT, {
    x: 8, y: 303, w: 38, h: 38,
    color: C_YELLOW, text_size: FS_SMALL,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: 'SR',
  })
  R.sunTime = mkw(widget.TEXT, {
    x: 48, y: 303, w: 116, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '--:--',
  })

  // ── Left: Moon row ──────────────────────────────────────────────────────────
  R.moonPhase = mkw(widget.TEXT, {
    x: 8, y: 343, w: 38, h: 38,
    color: C_GRAY, text_size: FS_SMALL,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: MOON_PHASE_LABELS[0],
  })
  R.moonTime = mkw(widget.TEXT, {
    x: 48, y: 343, w: 116, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '--:--',
  })

  // ── Right: Temperature row (top) ────────────────────────────────────────────
  mkw(widget.TEXT, {
    x: 174, y: 303, w: 22, h: 38,
    color: C_ORANGE, text_size: FS_SMALL,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: 'T',
  })
  R.temp = mkw(widget.TEXT, {
    x: 198, y: 303, w: 138, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '--',
  })

  // ── Right: Wind (bottom-left half) ──────────────────────────────────────────
  mkw(widget.TEXT, {
    x: 174, y: 343, w: 22, h: 38,
    color: C_CYAN, text_size: FS_SMALL,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: 'W',
  })
  R.wind = mkw(widget.TEXT, {
    x: 198, y: 343, w: 74, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '--',
  })

  // ── Right: Steps (bottom-right half) ────────────────────────────────────────
  mkw(widget.TEXT, {
    x: 274, y: 343, w: 20, h: 38,
    color: C_CYAN, text_size: FS_SMALL,
    align_h: align.CENTER_H, align_v: align.CENTER_V,
    text: 'S',
  })
  R.steps = mkw(widget.TEXT, {
    x: 296, y: 343, w: 40, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: align.LEFT, align_v: align.CENTER_V,
    text: '0',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Update functions (guard against null sensor and null widget refs)
// ─────────────────────────────────────────────────────────────────────────────

function updateTime() {
  if (!_time) return
  try {
    const t = _time.getTime()
    setp(R.time, prop.TEXT, pad2(t.hour) + ':' + pad2(t.minute))
    if (t.hour !== _lastHour) {
      _lastHour = t.hour
      updateDate(t)
    }
  } catch (e) {}
}

function updateDate(t) {
  try {
    const info = t || (_time ? _time.getTime() : null)
    if (!info) return
    setp(R.date,    prop.TEXT, pad2(info.day) + '.' + pad2(info.month))
    setp(R.weekday, prop.TEXT, WEEKDAYS[info.week] || '---')
    const week = isoWeek(new Date(info.year, info.month - 1, info.day))
    setp(R.week, prop.TEXT, 'W' + pad2(week))
  } catch (e) {}
}

function updateBattery() {
  if (!_bat) return
  try {
    const lvl = _bat.getCurrent()
    if (lvl === undefined || lvl === null) return
    setp(R.batPct, prop.TEXT, lvl + '%')
    const color = lvl > 50 ? C_GREEN : lvl > 20 ? C_YELLOW : C_RED
    setp(R.batBar, prop.MORE, { color, w: Math.max(2, Math.round(58 * lvl / 100)) })
  } catch (e) {}
}

function updateSteps() {
  if (!_ped) return
  try {
    const s = _ped.getStepCount()
    if (s === undefined || s === null) return
    setp(R.steps, prop.TEXT, s >= 1000 ? (s / 1000).toFixed(1) + 'k' : '' + s)
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote-data applicators (called from app-side messages)
// ─────────────────────────────────────────────────────────────────────────────

function applyGlucose(msg) {
  if (!msg) return
  try {
    const val = String(msg.value || '---')
    setp(R.glucose,   prop.TEXT, val)
    setp(R.glucose,   prop.MORE, { color: glucoseColor(val) })
    setp(R.delta,     prop.TEXT, msg.delta     || '')
    setp(R.timeDelta, prop.TEXT, msg.timeDelta ? msg.timeDelta + 'm' : '')
  } catch (e) {}
}

function applyWeather(msg) {
  if (!msg) return
  try {
    if (msg.temp !== undefined) setp(R.temp, prop.TEXT, msg.temp + (msg.tempUnit || ''))
    if (msg.wind !== undefined) setp(R.wind, prop.TEXT, msg.wind + (msg.windUnit || ''))
  } catch (e) {}
}

function applyAstronomy(msg) {
  if (!msg) return
  try {
    if (msg.sunTime)             setp(R.sunTime,   prop.TEXT, msg.sunTime)
    if (msg.sunIsRising != null) setp(R.sunDir,    prop.TEXT, msg.sunIsRising ? 'SR' : 'SS')
    if (msg.moonTime)            setp(R.moonTime,  prop.TEXT, msg.moonTime)
    if (typeof msg.moonPhase === 'number') {
      setp(R.moonPhase, prop.TEXT, MOON_PHASE_LABELS[msg.moonPhase] || MOON_PHASE_LABELS[0])
    }
  } catch (e) {}
}

function applySettings(msg) {
  if (!msg) return
  try {
    if (msg.garbageBag) setp(R.garbage, prop.TEXT, GARBAGE_LABEL[msg.garbageBag] || '')
  } catch (e) {}
}

function applyAll(msg) {
  if (!msg) return
  if (msg.glucose)   applyGlucose(msg.glucose)
  if (msg.weather)   applyWeather(msg.weather)
  if (msg.astronomy) applyAstronomy(msg.astronomy)
  if (msg.settings)  applySettings(msg.settings)
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging — watch-side
// ─────────────────────────────────────────────────────────────────────────────

function setupMessaging() {
  try {
    messageBuilder.connect()

    // Listen for app-side initiated pushes
    messageBuilder.on('call', (data) => {
      try {
        const msg = messageBuilder.buf2Json(data.payload)
        if (!msg) return
        switch (msg.type) {
          case 'glucose':   applyGlucose(msg);   break
          case 'weather':   applyWeather(msg);   break
          case 'astronomy': applyAstronomy(msg); break
          case 'settings':  applySettings(msg);  break
          case 'all':       applyAll(msg);        break
        }
      } catch (e) {}
    })

    // Request initial full data set from app-side
    messageBuilder
      .request({ action: 'fetchAll' }, { timeout: 60000 })
      .then((res) => {
        try { if (res && res.data) applyAll(res.data) } catch (e) {}
      })
      .catch(() => {})

  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchface entry point
// ─────────────────────────────────────────────────────────────────────────────

WatchFace({
  onInit() {
    try { setStatusBarVisible(false) } catch (e) {}
    try { _time = new Time() }      catch (e) {}
    try { _ped  = new Pedometer() } catch (e) {}
    try { _bat  = new Battery() }   catch (e) {}
  },

  build() {
    try { buildStatusBar() }   catch (e) {}
    try { buildTimeZone() }    catch (e) {}
    try { buildGlucoseZone() } catch (e) {}
    try { buildDateZone() }    catch (e) {}
    try { buildBottomZone() }  catch (e) {}

    // Populate from on-device sensors immediately
    updateTime()
    updateDate()
    updateBattery()
    updateSteps()

    // Register sensor callbacks for live updates
    if (_time) try { _time.onPerMinute(() => { updateTime(); updateSteps() }) } catch (e) {}
    if (_bat)  try { _bat.onChange(() => { updateBattery() }) }                  catch (e) {}
    if (_ped)  try { _ped.onChange(() => { updateSteps() }) }                    catch (e) {}

    // Connect to phone for remote data (Dexcom + weather + astronomy)
    setupMessaging()
  },

  onDestroy() {
    try { if (_time) _time.offPerMinute() } catch (e) {}
    try { if (_bat)  _bat.offChange() }     catch (e) {}
    try { if (_ped)  _ped.offChange() }     catch (e) {}
    try { messageBuilder.disConnect() }     catch (e) {}
  },
})
