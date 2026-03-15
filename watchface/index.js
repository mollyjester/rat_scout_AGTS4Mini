/**
 * Rat Scout — Zepp OS Watchface for Amazfit GTS 4 Mini (336×384)
 *
 * Reimplementation of https://github.com/mollyjester/rat_scout
 *
 * Layout (portrait 336×384, 80px corner rounding):
 *   y=  0  h=42   Status bar: umbrella + garbage bag + weekday (left) | battery % + bar (right)
 *   y= 44  h=34   Date zone (DD.MM | Wnn) — above time
 *   y= 78  h=90   Time (HH:MM, 80pt, left-aligned)
 *   y=170  h=50   Glucose zone (left half, left-aligned)
 *   y=224  h=36   Temperature row (icon + value)
 *   y=260  h=36   Wind row (icon + value)
 *   y=296  h=36   Steps row (icon + count)
 */

// API 1.0 — globals: hmUI, hmSensor, hmBle, WatchFace (no @zos/* imports)

// ── Screen ───────────────────────────────────────────────────────────────────
var W = 336
var H = 384

// ── Colours ──────────────────────────────────────────────────────────────────
var C_WHITE  = 0xFFFFFF
var C_YELLOW = 0xFFFF00
var C_RED    = 0xFF3030
var C_ORANGE = 0xFF8C00
var C_GREEN  = 0x44FF44
var C_GRAY   = 0x888888
var C_DKGRAY = 0x333333
var C_BAR    = 0x141414
var C_TIME   = 0x343e9f

// ── Font sizes ────────────────────────────────────────────────────────────────
var FS_TIME  = 80
var FS_GLUC  = 48
var FS_DATE  = 34
var FS_SMALL = 20

// ── Garbage bag images (on/off variants) ─────────────────────────────────────

// ── Widget refs (populated in build functions) ────────────────────────────────
var R = {}

// ── Sensors ───────────────────────────────────────────────────────────────────
var _time, _ped, _bat

// ── State ─────────────────────────────────────────────────────────────────────
var _lastHour = -1
var _lastFetchTime = 0
var _fetchInProgress = false

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function isoWeek(date) {
  var d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + 4 - (d.getDay() || 7))
  var yearStart = new Date(d.getFullYear(), 0, 1)
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

function showGlucoseLoading() {
  _fetchInProgress = true
  setp(R.glucoseLoading, hmUI.prop.VISIBLE, true)
  setp(R.glucose, hmUI.prop.TEXT, '')
}

function hideGlucoseLoading() {
  _fetchInProgress = false
  setp(R.glucoseLoading, hmUI.prop.VISIBLE, false)
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout builders
// ─────────────────────────────────────────────────────────────────────────────

function buildStatusBar() {
  mkw(hmUI.widget.FILL_RECT, { x: 0, y: 0, w: W, h: 42, color: C_BAR, radius: 0 })

  // Umbrella icon — always visible, first in status bar
  R.umbrella = mkw(hmUI.widget.IMG, { x: 47, y: 5, w: 32, h: 32, src: 'images/umbrella_32_off.png' })

  // Garbage bag icons — all 3 always visible, switch between off/on
  R.bagOrganic = mkw(hmUI.widget.IMG, { x: 95, y: 5, w: 32, h: 32, src: 'images/organic_32_off.png' })
  R.bagGrey    = mkw(hmUI.widget.IMG, { x: 127, y: 5, w: 32, h: 32, src: 'images/greybag_32_off.png' })
  R.bagBlack   = mkw(hmUI.widget.IMG, { x: 159, y: 5, w: 32, h: 32, src: 'images/blackbag_32_off.png' })

  // Weekday — centered between last garbage icon and battery bar
  R.weekday = mkw(hmUI.widget.TEXT, {
    x: 191, y: 2, w: 68, h: 38,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.CENTER_H, align_v: hmUI.align.CENTER_V,
    text: '---',
  })

  // Battery bar background + fill — top right
  mkw(hmUI.widget.FILL_RECT, { x: 259, y: 13, w: 28, h: 16, color: C_DKGRAY, radius: 2 })
  R.batBar = mkw(hmUI.widget.FILL_RECT, {
    x: 260, y: 14, w: 26, h: 14, color: C_GREEN, radius: 1,
  })
}

function buildDateZone() {
  R.date = mkw(hmUI.widget.TEXT, {
    x: 15, y: 44, w: 120, h: 34,
    color: C_WHITE, text_size: FS_DATE,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })

  R.week = mkw(hmUI.widget.TEXT, {
    x: 140, y: 44, w: 80, h: 34,
    color: C_GRAY, text_size: FS_DATE,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: 'W--',
  })
}

function buildTimeZone() {
  R.time = mkw(hmUI.widget.TEXT, {
    x: 15, y: 78, w: W - 15, h: 90,
    color: C_TIME, text_size: FS_TIME,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--:--',
  })
}

function buildGlucoseZone() {
  R.glucose = mkw(hmUI.widget.TEXT, {
    x: 15, y: 170, w: Math.floor(W / 2), h: 50,
    color: C_GREEN, text_size: FS_GLUC,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '',
  })

  // Loading indicator — left half
  R.glucoseLoading = mkw(hmUI.widget.IMG_ANIM, {
    x: 15, y: 179, w: 32, h: 32,
    anim_path: 'images', anim_prefix: 'loading', anim_ext: 'png',
    anim_fps: 4, anim_size: 8, repeat_count: 0,
    anim_status: hmUI.anim_status.START,
  })
  if (!R.glucoseLoading) {
    R.glucoseLoading = mkw(hmUI.widget.IMG, {
      x: 15, y: 179, w: 32, h: 32, src: 'images/loading_0.png',
    })
  }
}

function buildWeatherRow() {
  // Temperature (y=224)
  mkw(hmUI.widget.IMG, { x: 15, y: 226, w: 22, h: 32, src: 'images/temperature.png' })
  R.temp = mkw(hmUI.widget.TEXT, {
    x: 39, y: 224, w: 80, h: 36,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--',
  })

  // Wind (y=260)
  mkw(hmUI.widget.IMG, { x: 15, y: 262, w: 22, h: 32, src: 'images/wind.png' })
  R.wind = mkw(hmUI.widget.TEXT, {
    x: 39, y: 260, w: 80, h: 36,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '--',
  })
}

function buildStepsRow() {
  // Steps (y=296)
  mkw(hmUI.widget.IMG, { x: 15, y: 298, w: 20, h: 32, src: 'images/steps.png' })
  R.steps = mkw(hmUI.widget.TEXT, {
    x: 39, y: 296, w: 132, h: 36,
    color: C_WHITE, text_size: FS_SMALL,
    align_h: hmUI.align.LEFT, align_v: hmUI.align.CENTER_V,
    text: '0',
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Update functions
// ─────────────────────────────────────────────────────────────────────────────

function updateTime() {
  if (!_time) return
  try {
    var h = _time.hour
    var m = _time.minute
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
    var day   = _time.day
    var month = _time.month
    var year  = _time.year
    if (day === undefined) return
    setp(R.date, hmUI.prop.TEXT, pad2(day) + '.' + pad2(month))
    var wn = isoWeek(new Date(year, month - 1, day))
    setp(R.week, hmUI.prop.TEXT, 'W' + pad2(wn))
  } catch (e) {}
}

function updateBattery() {
  if (!_bat) return
  try {
    var lvl = _bat.current
    if (lvl === undefined || lvl === null) return
    setp(R.batBar, hmUI.prop.MORE, { color: color, w: Math.max(2, Math.round(26 * lvl / 100)) })
  } catch (e) {}
}

function updateSteps() {
  if (!_ped) return
  try {
    var s = _ped.current
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
    hideGlucoseLoading()
    var displayVal = String(msg.value || '---')
    if (msg.trendArrow && displayVal !== '---') displayVal += ' ' + msg.trendArrow
    setp(R.glucose, hmUI.prop.TEXT, displayVal)
    setp(R.glucose, hmUI.prop.MORE, { color: msg.color || C_GRAY })
  } catch (e) {}
}

function applyWeather(msg) {
  if (!msg) return
  try {
    if (msg.temp !== undefined) setp(R.temp, hmUI.prop.TEXT, msg.temp + (msg.tempUnit || ''))
    if (msg.wind !== undefined) setp(R.wind, hmUI.prop.TEXT, msg.wind + (msg.windUnit || ''))
    if (msg.needsUmbrella !== undefined) {
      setp(R.umbrella, hmUI.prop.SRC, msg.needsUmbrella ? 'images/umbrella_32_on.png' : 'images/umbrella_32_off.png')
    }
  } catch (e) {}
}

function applySettings(msg) {
  if (!msg) return
  try {
    var g = msg.garbage || {}
    setp(R.bagOrganic, hmUI.prop.SRC, g.organic ? 'images/organic_32_on.png' : 'images/organic_32_off.png')
    setp(R.bagGrey,    hmUI.prop.SRC, g.grey    ? 'images/greybag_32_on.png' : 'images/greybag_32_off.png')
    setp(R.bagBlack,   hmUI.prop.SRC, g.black   ? 'images/blackbag_32_on.png' : 'images/blackbag_32_off.png')
  } catch (e) {}
}

function applyAll(msg) {
  if (!msg) return
  if (msg.weekday) setp(R.weekday, hmUI.prop.TEXT, msg.weekday)
  if (msg.glucose) applyGlucose(msg.glucose)
  else             hideGlucoseLoading()
  if (msg.weather) applyWeather(msg.weather)
  if (msg.settings) applySettings(msg.settings)
}

// ─────────────────────────────────────────────────────────────────────────────
// Messaging — watch side via hmBle (MessageBuilder-compatible framing)
// ─────────────────────────────────────────────────────────────────────────────

var _blePort = 0
var _traceId = 10000
var _spanId  = 1000
var _pending = {}
var _appId   = 0
var _bleConnected = false
var _shakeRetries = 0
var _shakeTimer   = null
var SHAKE_MAX_RETRIES = 15
var SHAKE_BASE_DELAY  = 3000
var FETCH_INTERVAL_MIN = 5

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
  _u32(buf,o,0);        o+=4
  _u32(buf,o,_spanId);  o+=4
  _u32(buf,o,1);        o+=4
  _u32(buf,o,totalLen); o+=4
  _u32(buf,o,dataBytes.length); o+=4
  buf[o++]=payloadType
  buf[o++]=0x01
  var ts=(Date.now()%10000000)|0; _u32(buf,o,ts); o+=4
  for(var i=1;i<8;i++){_u32(buf,o,0);o+=4}
  _u32(buf,o,0);o+=4; _u32(buf,o,0);o+=4
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
    var now = Date.now()
    for (var k in _pending) {
      if (_pending.hasOwnProperty(k) && now - _pending[k] > 120000) delete _pending[k]
    }
    _traceId++
    _pending[_traceId] = now
    _sendJson(_traceId, { action: 'fetchAll' }, 0x01)
  } catch(e) {}
}

function _triggerPeriodicFetch() {
  showGlucoseLoading()
  _lastFetchTime = Date.now()
  _bleConnected = false
  _blePort = 0
  _shakeRetries = 0
  _sendShake()
  _scheduleShakeRetry()
}

function _onResume() {
  try { updateTime()  } catch(e) {}
  try { updateSteps() } catch(e) {}
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
  if (_shakeTimer) { try { timer.stopTimer(_shakeTimer) } catch(e) {} _shakeTimer = null }
}

function setupMessaging() {
  if (typeof hmBle === 'undefined') return
  try {
    _appId = 1000090

    hmBle.createConnect(function(index, data, size) {
      try {
        var arr = new Uint8Array(data)
        if (arr.length < 16) return
        var outerType = arr[2] | (arr[3]<<8)
        var port2     = arr[4] | (arr[5]<<8)

        if (outerType === 0x1) {
          _bleConnected = true
          _shakeRetries = 0
          if (_shakeTimer) { try { timer.stopTimer(_shakeTimer) } catch(e) {} _shakeTimer = null }
          _blePort = port2
          _lastFetchTime = Date.now()
          _sendFetchAll()
          return
        }

        if (outerType === 0x2) {
          _scheduleShakeRetry()
          return
        }

        if ((outerType === 0x4 || outerType === 0x5) && arr.length > 82) {
          try {
            var traceId   = _r32(arr, 16)
            var payLen    = _r32(arr, 36)
            var payType   = arr[40]
            var dataStart = 82
            var payload   = arr.slice(dataStart, dataStart + payLen)
            var str = _b2s(Array.from(payload))
            var msg = JSON.parse(str)
            if (payType === 0x02 && _pending[traceId]) {
              delete _pending[traceId]
              var body = (msg && msg.result) || (msg && msg.data) || msg
              if (body) applyAll(body)
            } else if (payType === 0x03 && msg) {
              if (msg.type === 'all')      applyAll(msg)
              if (msg.type === 'glucose')  applyGlucose(msg)
              if (msg.type === 'weather')  applyWeather(msg)
              if (msg.type === 'settings') applySettings(msg)
            }
          } catch(e) {}
        }
      } catch(e) {}
    })

    _sendShake()
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
    try { mkw(hmUI.widget.IMG, { x: 0, y: 0, src: 'images/bg.png' }) } catch (e) {}
    try { buildStatusBar()   } catch (e) {}
    try { buildDateZone()    } catch (e) {}
    try { buildTimeZone()    } catch (e) {}
    try { buildGlucoseZone() } catch (e) {}
    try { buildWeatherRow()  } catch (e) {}
    try { buildStepsRow()    } catch (e) {}

    updateTime()
    updateDate()
    updateBattery()
    updateSteps()

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
