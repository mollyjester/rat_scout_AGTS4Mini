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

// API 1.0 — globals: hmUI, hmSensor, hmBle, WatchFace (no @zos/* imports)

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

// ── Moon phase images ────────────────────────────────────────────────────────
const MOON_IMGS = [
  'images/newmoon.png',
  'images/waxingcrescentmoon.png',
  'images/firstquartermoon.png',
  'images/waxinggibbousmoon.png',
  'images/fullmoon.png',
  'images/waninggibbousmoon.png',
  'images/thirdquartermoon.png',
  'images/waningcrescentmoon.png',
]



// ── Garbage bag images ────────────────────────────────────────────────────────
const BAG_IMGS = { O: 'images/organicbag.png', G: 'images/greybag.png', B: 'images/blackbag.png' }

// ── Widget refs (populated in build functions) ────────────────────────────────
const R = {}

// ── Sensors ───────────────────────────────────────────────────────────────────
let _time, _ped, _bat

// ── State ─────────────────────────────────────────────────────────────────────
let _lastHour = -1
let _lastFetchTime = 0



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



/** Safe createWidget — returns null instead of throwing */
function mkw(type, params) {
  try { return hmUI.createWidget(type, params) } catch (e) { return null }
}

/** Safe setProperty — silently skips null widget refs */
function setp(wref, key, val) {
  try { if (wref) wref.setProperty(key, val) } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout builders
// ─────────────────────────────────────────────────────────────────────────────

function buildStatusBar() {
  mkw(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 42, color: C_BAR, radius: 0 })

  // Left icons: umbrella (hidden), garbage bag (hidden)
  R.umbrella = mkw(hmUI.widget.IMG, { x: 8, y: 5, w: 32, h: 32, src: 'images/umbrella.png' })
  setp(R.umbrella, hmUI.prop.VISIBLE, false)

  R.garbage = mkw(hmUI.widget.IMG, { x: 44, y: 5, w: 32, h: 32, src: 'images/organicbag.png' })
  setp(R.garbage, hmUI.prop.VISIBLE, false)

  // Weekday (center area)
  R.weekday = mkw(hmUI.widget.TEXT, {
    x: 100, y: 2, w: 90, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    text: '---',
  })

  // Battery percentage
  R.batPct = mkw(hmUI.widget.TEXT, {
    x: 200, y: 2, w: 62, h: 38,
    color: C_GRAY, text_size: FS_SMALL,
    align_h: hmUI.align.RIGHT, align_v: hmUI.align.CENTER_V,
    text: '--%',
  })

  // Battery bar background + fill
  mkw(hmUI.widget.FILL_RECT, { x: 266, y: 13, w: 62, h: 16, color: C_DKGRAY, radius: 2 })

  R.batBar = mkw(hmUI.widget.FILL_RECT, {
    x: 268, y: 15, w: 58, h: 12, color: C_GREEN, radius: 1,
  })
}

function buildTimeZone() {
  R.time = mkw(hmUI.widget.TEXT, {
    x: 0, y: 44, w: W, h: 116,
    color: C_WHITE, text_size: FS_TIME,
    align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })
}

function buildGlucoseZone() {
  mkw(hmUI.widget.FILL_RECT, { x: 8, y: 161, w: W - 16, h: 1, color: C_DKGRAY })

  R.glucose = mkw(hmUI.widget.TEXT, {
    x: 0, y: 162, w: 200, h: 82,
    color: C_GREEN, text_size: FS_GLUC,
    align_h: hmUI.align.RIGHT, align_v: hmUI.align.CENTER_V,
    text: '---',
  })

  R.delta = mkw(hmUI.widget.TEXT, {
    x: 208, y: 164, w: 128, h: 36,
    color: C_CYAN, text_size: FS_NORM,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '',
  })

  R.timeDelta = mkw(hmUI.widget.TEXT, {
    x: 208, y: 204, w: 128, h: 36,
    color: C_GRAY, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '',
  })
}

function buildDateZone() {
  mkw(hmUI.widget.FILL_RECT, { x: 8, y: 245, w: W - 16, h: 1, color: C_DKGRAY })

  R.date = mkw(hmUI.widget.TEXT, {
    x: 0, y: 247, w: 176, h: 52,
    color: C_WHITE, text_size: FS_DATE,
    align_h: hmUI.align.RIGHT, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })

  R.week = mkw(hmUI.widget.TEXT, {
    x: 184, y: 247, w: 152, h: 52,
    color: C_GRAY, text_size: FS_DATE,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: 'W--',
  })
}

function buildBottomZone() {
  mkw(hmUI.widget.FILL_RECT, { x: 8, y: 301, w: W - 16, h: 1, color: C_DKGRAY })
  // Vertical divider between left (sun/moon) and right (weather/steps) columns
  mkw(hmUI.widget.FILL_RECT, { x: 168, y: 303, w: 1, h: 79, color: C_DKGRAY })

  // ── Left: Sun row ───────────────────────────────────────────────────────────
  R.sunDir = mkw(hmUI.widget.IMG, { x: 8, y: 306, w: 32, h: 32, src: 'images/sun.png' })
  R.sunTime = mkw(hmUI.widget.TEXT, {
    x: 44, y: 303, w: 120, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })

  // ── Left: Moon row ──────────────────────────────────────────────────────────
  R.moonPhase = mkw(hmUI.widget.IMG, { x: 8, y: 346, w: 32, h: 32, src: MOON_IMGS[0] })
  R.moonTime = mkw(hmUI.widget.TEXT, {
    x: 44, y: 343, w: 120, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })

  // ── Right top: Temperature + Wind ───────────────────────────────────────────
  mkw(hmUI.widget.IMG, { x: 174, y: 306, w: 22, h: 32, src: 'images/temperature.png' })
  R.temp = mkw(hmUI.widget.TEXT, {
    x: 198, y: 303, w: 56, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--',
  })

  mkw(hmUI.widget.IMG, { x: 256, y: 306, w: 22, h: 32, src: 'images/wind.png' })
  R.wind = mkw(hmUI.widget.TEXT, {
    x: 280, y: 303, w: 56, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--',
  })

  // ── Right bottom: Steps ─────────────────────────────────────────────────────
  mkw(hmUI.widget.IMG, { x: 174, y: 346, w: 20, h: 32, src: 'images/steps.png' })
  R.steps = mkw(hmUI.widget.TEXT, {
    x: 198, y: 343, w: 132, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '0',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Update functions (guard against null sensor and null widget refs)
// ─────────────────────────────────────────────────────────────────────────────

function updateTime() {
  if (!_time) return
  try {
    const h = _time.hour
    const m = _time.minute
    if (h === undefined) return
    setp(R.time, hmUI.prop.TEXT, pad2(h) + ':' + pad2(m))
    if (h !== _lastHour) {
      _lastHour = h
      updateDate()
    }
  } catch (e) {}
}

function updateDate() {
  if (!_time) return
  try {
    const day   = _time.day
    const month = _time.month
    const year  = _time.year
    const week  = _time.week   // 0=Sun … 6=Sat
    if (day === undefined) return
    setp(R.date,    hmUI.prop.TEXT, pad2(day) + '.' + pad2(month))
    const wn = isoWeek(new Date(year, month - 1, day))
    setp(R.week, hmUI.prop.TEXT, 'W' + pad2(wn))
  } catch (e) {}
}

function updateBattery() {
  if (!_bat) return
  try {
    const lvl = _bat.current
    if (lvl === undefined || lvl === null) return
    setp(R.batPct, hmUI.prop.TEXT, lvl + '%')
    const color = lvl > 50 ? C_GREEN : lvl > 20 ? C_YELLOW : C_RED
    setp(R.batBar, hmUI.prop.MORE, { color, w: Math.max(2, Math.round(58 * lvl / 100)) })
  } catch (e) {}
}

function updateSteps() {
  if (!_ped) return
  try {
    const s = _ped.current
    if (s === undefined || s === null) return
    setp(R.steps, hmUI.prop.TEXT, s >= 1000 ? (s / 1000).toFixed(1) + 'k' : '' + s)
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Remote-data applicators (called from app-side messages)
// ─────────────────────────────────────────────────────────────────────────────

function applyGlucose(msg) {
  if (!msg) return
  try {
    setp(R.glucose,   hmUI.prop.TEXT, String(msg.value || '---'))
    setp(R.glucose,   hmUI.prop.MORE, { color: msg.color || C_GRAY })
    setp(R.delta,     hmUI.prop.TEXT, msg.delta     || '')
    setp(R.timeDelta, hmUI.prop.TEXT, msg.timeDelta || '')
  } catch (e) {}
}

function applyWeather(msg) {
  if (!msg) return
  try {
    if (msg.temp !== undefined) setp(R.temp, hmUI.prop.TEXT, msg.temp + (msg.tempUnit || ''))
    if (msg.wind !== undefined) setp(R.wind, hmUI.prop.TEXT, msg.wind + (msg.windUnit || ''))
    if (msg.needsUmbrella !== undefined) {
      setp(R.umbrella, hmUI.prop.VISIBLE, !!msg.needsUmbrella)
    }
  } catch (e) {}
}

function applyAstronomy(msg) {
  if (!msg) return
  try {
    if (msg.sunTime)  setp(R.sunTime,  hmUI.prop.TEXT, msg.sunTime)
    if (msg.moonTime) setp(R.moonTime, hmUI.prop.TEXT, msg.moonTime)
    if (typeof msg.moonPhase === 'number') {
      setp(R.moonPhase, hmUI.prop.SRC, MOON_IMGS[msg.moonPhase] || MOON_IMGS[0])
    }
  } catch (e) {}
}

function applySettings(msg) {
  if (!msg) return
  try {
    if (msg.garbageBag && BAG_IMGS[msg.garbageBag]) {
      setp(R.garbage, hmUI.prop.SRC,     BAG_IMGS[msg.garbageBag])
      setp(R.garbage, hmUI.prop.VISIBLE, true)
    } else {
      setp(R.garbage, hmUI.prop.VISIBLE, false)
    }
  } catch (e) {}
}

function applyAll(msg) {
  if (!msg) return
  if (msg.weekday)   setp(R.weekday, hmUI.prop.TEXT, msg.weekday)
  if (msg.glucose)   applyGlucose(msg.glucose)
  if (msg.weather)   applyWeather(msg.weather)
  if (msg.astronomy) applyAstronomy(msg.astronomy)
  if (msg.settings)  applySettings(msg.settings)
}



// ─────────────────────────────────────────────────────────────────────────────
// Messaging — watch side via hmBle (MessageBuilder-compatible framing)
// ─────────────────────────────────────────────────────────────────────────────

let _blePort = 0
let _traceId = 10000
let _spanId  = 1000
let _pending = {}
let _appId   = 0
let _bleConnected = false
let _shakeRetries = 0
let _shakeTimer   = null
var SHAKE_MAX_RETRIES = 15
var SHAKE_BASE_DELAY  = 3000   // 3 s, increases with each retry
var FETCH_INTERVAL_MIN = 5    // minutes between fetches

function _u16(b, o, v) { b[o] = v & 0xFF; b[o+1] = (v>>8) & 0xFF }
function _u32(b, o, v) { b[o] = v&0xFF; b[o+1]=(v>>8)&0xFF; b[o+2]=(v>>16)&0xFF; b[o+3]=(v>>24)&0xFF }
function _r32(b, o)    { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0 }

function _s2b(str) {
  var o=[]; for(var i=0;i<str.length;i++){var c=str.charCodeAt(i); if(c<0x80)o.push(c); else if(c<0x800)o.push(0xC0|(c>>6),0x80|(c&63)); else o.push(0xE0|(c>>12),0x80|((c>>6)&63),0x80|(c&63));} return o;
}
function _b2s(arr) {
  var s='',i=0; while(i<arr.length){var b=arr[i++]; if(b<0x80)s+=String.fromCharCode(b); else if((b&0xE0)===0xC0)s+=String.fromCharCode(((b&31)<<6)|(arr[i++]&63)); else s+=String.fromCharCode(((b&15)<<12)|((arr[i++]&63)<<6)|(arr[i++]&63));} return s;
}

function _buildPkt(outerType, port2, appId, payBytes) {
  var buf = new Uint8Array(16 + payBytes.length)
  buf[0]=0x01; buf[1]=0x01; _u16(buf,2,outerType); _u16(buf,4,20); _u16(buf,6,port2)
  _u32(buf,8,appId); _u32(buf,12,0)
  for(var i=0;i<payBytes.length;i++) buf[16+i]=payBytes[i]
  return buf
}

function _buildInner(traceId, totalLen, dataBytes, payloadType) {
  _spanId++
  var buf = new Uint8Array(66 + dataBytes.length), o=0
  _u32(buf,o,traceId);  o+=4
  _u32(buf,o,0);        o+=4   // parentId
  _u32(buf,o,_spanId);  o+=4
  _u32(buf,o,1);        o+=4   // seqId=1
  _u32(buf,o,totalLen); o+=4
  _u32(buf,o,dataBytes.length); o+=4
  buf[o++]=payloadType
  buf[o++]=0x01          // opCode=Finished
  var ts=(Date.now()%10000000)|0; _u32(buf,o,ts); o+=4
  for(var i=1;i<8;i++){_u32(buf,o,0);o+=4}  // timestamps 2-8
  _u32(buf,o,0);o+=4; _u32(buf,o,0);o+=4  // extra1,2
  for(var j=0;j<dataBytes.length;j++) buf[o+j]=dataBytes[j]
  return buf
}

function _sendJson(traceId, json, payloadType) {
  try {
    var bytes  = _s2b(JSON.stringify(json))
    var inner  = Array.from(_buildInner(traceId, bytes.length, bytes, payloadType))
    var outer  = _buildPkt(0x4, _blePort, _appId, inner)
    hmBle.send(outer.buffer, outer.byteLength)
  } catch(e) {}
}

function _sendShake() {
  try {
    var shake = _buildPkt(0x1, 0, _appId, [_appId & 0xFF])
    hmBle.send(shake.buffer, shake.byteLength)
  } catch(e) {}
}

function _scheduleShakeRetry() {
  if (_bleConnected || _shakeRetries >= SHAKE_MAX_RETRIES) return
  if (_shakeTimer) { try { timer.stopTimer(_shakeTimer) } catch(e) {} _shakeTimer = null }
  var delay = Math.min(SHAKE_BASE_DELAY * (_shakeRetries + 1), 15000)
  _shakeTimer = timer.createTimer(delay, 0, function() {
    _shakeTimer = null
    if (_bleConnected) return
    _shakeRetries++
    _sendShake()
    _scheduleShakeRetry()
  })
}

function _sendFetchAll() {
  if (!_bleConnected) return
  try {
    // Purge stale pending entries (responses that never arrived)
    var now = Date.now()
    for (var k in _pending) {
      if (_pending.hasOwnProperty(k) && now - _pending[k] > 120000) delete _pending[k]
    }
    _traceId++
    _pending[_traceId] = now
    _sendJson(_traceId, { action: 'fetchAll' }, 0x01)
  } catch(e) {}
}

// MINUTEEND does NOT fire when the screen is off on the GTS 4 Mini.
// We use WIDGET_DELEGATE resume_call (fires on wrist-raise / screen-on)
// combined with MINUTEEND for updates while the screen stays on.
function _triggerPeriodicFetch() {
  _lastFetchTime = Date.now()
  _bleConnected = false
  _blePort = 0
  _shakeRetries = 0
  _sendShake()
  _scheduleShakeRetry()
}

function _onResume() {
  // Screen just turned on — update display immediately
  try { updateTime()  } catch(e) {}
  try { updateSteps() } catch(e) {}
  // Trigger fetch if enough time has passed (or if this is the first resume)
  if (_lastFetchTime === 0 || (Date.now() - _lastFetchTime) >= FETCH_INTERVAL_MIN * 60000) {
    _triggerPeriodicFetch()
  }
}

function _onMinuteTick() {
  updateTime()
  updateSteps()
  if (_lastFetchTime > 0 && (Date.now() - _lastFetchTime) >= FETCH_INTERVAL_MIN * 60000) {
    _triggerPeriodicFetch()
  }
}

function _stopTimers() {
  if (_shakeTimer)  { try { timer.stopTimer(_shakeTimer)  } catch(e) {} _shakeTimer  = null }
}

function setupMessaging() {
  if (typeof hmBle === 'undefined') return
  try {
    // Connect to companion app (appId 1000090) — watchface packages cannot
    // run their own phone-side service on this firmware.
    _appId = 1000090

    hmBle.createConnect(function(index, data, size) {
      try {
        var arr = new Uint8Array(data)
        if (arr.length < 16) return
        var outerType = arr[2] | (arr[3]<<8)
        var port2     = arr[4] | (arr[5]<<8)

        if (outerType === 0x1) {
          // Shake reply — side service is up, learn appSidePort
          _bleConnected = true
          _shakeRetries = 0
          if (_shakeTimer) { try { timer.stopTimer(_shakeTimer) } catch(e) {} _shakeTimer = null }
          _blePort = port2
          _lastFetchTime = Date.now()
          _sendFetchAll()
          return
        }

        if (outerType === 0x2) {
          // Shake error — side service not ready yet, schedule retry
          _scheduleShakeRetry()
          return
        }

        if ((outerType === 0x4 || outerType === 0x5) && arr.length > 82) {
          try {
            var traceId   = _r32(arr, 16)
            var totalLen  = _r32(arr, 32)
            var payLen    = _r32(arr, 36)
            var payType   = arr[40]
            var dataStart = 82
            var payload   = arr.slice(dataStart, dataStart + payLen)
            var str = _b2s(Array.from(payload))
            var msg = JSON.parse(str)
            if (payType === 0x02 && _pending[traceId]) {
              delete _pending[traceId]
              // ZML wraps responses as {result: data}, messageBuilder uses {data: data}
              var body = (msg && msg.result) || (msg && msg.data) || msg
              if (body) applyAll(body)
            } else if (payType === 0x03 && msg) {
              if (msg.type === 'all')       applyAll(msg)
              if (msg.type === 'glucose')   applyGlucose(msg)
              if (msg.type === 'weather')   applyWeather(msg)
              if (msg.type === 'astronomy') applyAstronomy(msg)
              if (msg.type === 'settings')  applySettings(msg)
            }
          } catch(e) {}
        }
      } catch(e) {}
    })

    // Send initial shake handshake
    _sendShake()
    // If it fails, the outerType=0x02 handler will trigger retries
    // Also schedule a safety-net retry in case no response at all
    _scheduleShakeRetry()
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Watchface entry point
// ─────────────────────────────────────────────────────────────────────────────

WatchFace({
  onInit() {
    try { _time = hmSensor.createSensor(hmSensor.id.TIME)    } catch (e) {}
    try { _ped  = hmSensor.createSensor(hmSensor.id.STEP)    } catch (e) {}
    try { _bat  = hmSensor.createSensor(hmSensor.id.BATTERY) } catch (e) {}
  },

  build() {
    try { buildStatusBar()   } catch (e) {}
    try { buildTimeZone()    } catch (e) {}
    try { buildGlucoseZone() } catch (e) {}
    try { buildDateZone()    } catch (e) {}
    try { buildBottomZone()  } catch (e) {}

    updateTime()
    updateDate()
    updateBattery()
    updateSteps()

    // WIDGET_DELEGATE — resume_call fires on wrist-raise / screen-on
    try {
      hmUI.createWidget(hmUI.widget.WIDGET_DELEGATE, {
        resume_call: function() { try { _onResume() } catch(e) {} },
      })
    } catch (e) {}

    if (_time) try { _time.addEventListener(_time.event.MINUTEEND, function() { _onMinuteTick() }) } catch (e) {}
    if (_bat)  try { _bat.addEventListener(_bat.event.POWER, function() { updateBattery() }) } catch (e) {}
    if (_ped)  try { _ped.addEventListener(hmSensor.event.CHANGE, function() { updateSteps() }) } catch (e) {}

    setupMessaging()
  },

  onDestroy() {
    _stopTimers()
    try { if (_time) _time.removeEventListener(_time.event.MINUTEEND) } catch (e) {}
    try { if (_bat)  _bat.removeEventListener(_bat.event.POWER) }       catch (e) {}
    try { if (_ped)  _ped.removeEventListener(hmSensor.event.CHANGE) }  catch (e) {}
    try { if (typeof hmBle !== 'undefined') hmBle.disConnect() }        catch (e) {}
  },
})
