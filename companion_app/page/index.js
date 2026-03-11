/**
 * Rat Scout Settings — Device App Page (runs on the watch)
 *
 * API 1.0 globals only (no imports).
 * Globals: hmUI, hmBle, hmFS, hmApp, Page
 *
 * Flow:
 *   1. Shows status text on screen
 *   2. Connects to the companion Side Service via BLE
 *   3. Sends { action: 'getSettings' } request
 *   4. Receives settings JSON
 *   5. Writes settings to hmFS as 'rat_scout_settings.json'
 *   6. Attempts cross-app write to the watchface's data directory
 *   7. Shows success/failure message
 */

// ── Screen dimensions (GTS 4 Mini) ──────────────────────────────────────────
var W = 336
var H = 384

// ── Widget refs ──────────────────────────────────────────────────────────────
var _statusWidget = null

// ── BLE state ────────────────────────────────────────────────────────────────
var _blePort  = 0
var _traceId  = 20000
var _spanId   = 2000
var _pending  = {}
var _appId    = 0

// ── Watchface appId (for cross-app file write) ──────────────────────────────
var WATCHFACE_APP_ID = 1000089

// ─────────────────────────────────────────────────────────────────────────────
// UTF-8 helpers (same as watchface)
// ─────────────────────────────────────────────────────────────────────────────

function _s2b(str) {
  var o = []
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i)
    if (c < 0x80) o.push(c)
    else if (c < 0x800) o.push(0xC0 | (c >> 6), 0x80 | (c & 63))
    else o.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return o
}

function _b2s(arr) {
  var s = '', i = 0
  while (i < arr.length) {
    var b = arr[i++]
    if (b < 0x80) s += String.fromCharCode(b)
    else if ((b & 0xE0) === 0xC0) s += String.fromCharCode(((b & 31) << 6) | (arr[i++] & 63))
    else s += String.fromCharCode(((b & 15) << 12) | ((arr[i++] & 63) << 6) | (arr[i++] & 63))
  }
  return s
}

// ─────────────────────────────────────────────────────────────────────────────
// BLE binary helpers
// ─────────────────────────────────────────────────────────────────────────────

function _u16(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF }
function _u32(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; b[o + 3] = (v >> 24) & 0xFF }
function _r32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0 }

function _buildPkt(outerType, port2, appId, payBytes) {
  var buf = new Uint8Array(16 + payBytes.length)
  buf[0] = 0x01; buf[1] = 0x01
  _u16(buf, 2, outerType); _u16(buf, 4, 20); _u16(buf, 6, port2)
  _u32(buf, 8, appId); _u32(buf, 12, 0)
  for (var i = 0; i < payBytes.length; i++) buf[16 + i] = payBytes[i]
  return buf
}

function _buildInner(traceId, totalLen, dataBytes, payloadType) {
  _spanId++
  var buf = new Uint8Array(66 + dataBytes.length), o = 0
  _u32(buf, o, traceId);        o += 4
  _u32(buf, o, 0);              o += 4   // parentId
  _u32(buf, o, _spanId);        o += 4
  _u32(buf, o, 1);              o += 4   // seqId=1
  _u32(buf, o, totalLen);       o += 4
  _u32(buf, o, dataBytes.length); o += 4
  buf[o++] = payloadType
  buf[o++] = 0x01               // opCode=Finished
  var ts = (Date.now() % 10000000) | 0
  _u32(buf, o, ts); o += 4
  for (var i = 1; i < 8; i++) { _u32(buf, o, 0); o += 4 }
  _u32(buf, o, 0); o += 4
  _u32(buf, o, 0); o += 4
  for (var j = 0; j < dataBytes.length; j++) buf[o + j] = dataBytes[j]
  return buf
}

function _sendJson(traceId, json, payloadType) {
  try {
    var bytes = _s2b(JSON.stringify(json))
    var inner = Array.from(_buildInner(traceId, bytes.length, bytes, payloadType))
    var outer = _buildPkt(0x4, _blePort, _appId, inner)
    hmBle.send(outer.buffer, outer.byteLength)
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Status display
// ─────────────────────────────────────────────────────────────────────────────

function setStatus(text, color) {
  if (_statusWidget) {
    try {
      _statusWidget.setProperty(hmUI.prop.MORE, {
        text: text,
        color: color || 0x44FF44,
      })
    } catch (e) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File I/O — write settings JSON to watch storage
// ─────────────────────────────────────────────────────────────────────────────

var SETTINGS_FILE = 'rat_scout_settings.json'

function writeSettingsFile(settings) {
  var jsonStr = JSON.stringify(settings)
  var bytes   = _s2b(jsonStr)
  var buf     = new ArrayBuffer(bytes.length)
  var view    = new Uint8Array(buf)
  for (var i = 0; i < bytes.length; i++) view[i] = bytes[i]

  var wrote = false

  // 1. Write to own data directory (guaranteed to work)
  try {
    try { hmFS.remove(SETTINGS_FILE) } catch (e) {}
    var fd = hmFS.open(SETTINGS_FILE, hmFS.O_WRONLY | hmFS.O_CREAT)
    hmFS.write(fd, buf, 0, bytes.length)
    hmFS.close(fd)
    wrote = true
  } catch (e) {}

  // 2. Also try writing to the watchface's data directory (cross-app)
  var crossPath = '../' + WATCHFACE_APP_ID + '/' + SETTINGS_FILE
  try {
    try { hmFS.remove(crossPath) } catch (e) {}
    var fd2 = hmFS.open(crossPath, hmFS.O_WRONLY | hmFS.O_CREAT)
    hmFS.write(fd2, buf, 0, bytes.length)
    hmFS.close(fd2)
  } catch (e) {
    // Cross-app write may fail — that's OK, watchface will try reading from
    // the companion's directory instead
  }

  return wrote
}

// ─────────────────────────────────────────────────────────────────────────────
// BLE setup and request
// ─────────────────────────────────────────────────────────────────────────────

function setupBle() {
  if (typeof hmBle === 'undefined') {
    setStatus('BLE not available', 0xFF3030)
    return
  }

  try { _appId = hmApp.packageInfo().appId } catch (e) { _appId = 1000090 }

  hmBle.createConnect(function (index, data, size) {
    try {
      var arr = new Uint8Array(data)
      if (arr.length < 16) return
      var outerType = arr[2] | (arr[3] << 8)
      var port2     = arr[4] | (arr[5] << 8)

      // ── Shake reply ──────────────────────────────────────────────────
      if (outerType === 0x1) {
        _blePort = port2
        setStatus('Connected!\nRequesting settings...', 0xFFFF00)
        _traceId++
        _pending[_traceId] = 1
        _sendJson(_traceId, { action: 'getSettings' }, 0x01)
        return
      }

      // ── Data response ────────────────────────────────────────────────
      if ((outerType === 0x4 || outerType === 0x5) && arr.length > 82) {
        try {
          var traceId  = _r32(arr, 16)
          var payLen   = _r32(arr, 32)
          var payType  = arr[36]
          var dataStart = 82
          var payload  = arr.slice(dataStart, dataStart + payLen)
          var str      = _b2s(Array.from(payload))
          var msg      = JSON.parse(str)

          if (payType === 0x02 && _pending[traceId]) {
            delete _pending[traceId]

            // ZML BaseSideService wraps responses as {data: {result: ...}}
            // Handle both ZML format and direct format for robustness
            var responseData = null
            if (msg && msg.data) {
              responseData = msg.data.result || msg.data
            }

            if (responseData && responseData.settings) {
              var count = 0
              for (var k in responseData.settings) {
                if (responseData.settings.hasOwnProperty(k)) count++
              }

              if (count === 0) {
                setStatus(
                  'No settings configured yet.\n\n' +
                  'Open Zepp App on your phone:\n' +
                  'Profile > [watch] > Apps >\n' +
                  'Rat Scout Settings > Settings',
                  0xFF8C00
                )
                return
              }

              var ok = writeSettingsFile(responseData.settings)
              if (ok) {
                setStatus(
                  'Settings saved! (' + count + ' keys)\n\n' +
                  'You can now go back\nto the watchface.\n\n' +
                  'The watchface will use\nthese settings on next load.',
                  0x44FF44
                )
              } else {
                setStatus('Error writing settings file.', 0xFF3030)
              }
            } else if (responseData && responseData.error) {
              setStatus('Error: ' + (responseData.error.message || responseData.error), 0xFF3030)
            } else {
              setStatus(
                'No settings found.\n\nConfigure in Zepp App first.',
                0xFF8C00
              )
            }
          }
        } catch (e) {
          setStatus('Parse error: ' + (e.message || e), 0xFF3030)
        }
      }
    } catch (e) {
      setStatus('BLE error: ' + (e.message || e), 0xFF3030)
    }
  })

  // Send shake handshake to initiate BLE connection
  setStatus('Connecting to phone...', 0xFFFF00)
  var shake = _buildPkt(0x1, 0, _appId, [_appId & 0xFF])
  hmBle.send(shake.buffer, shake.byteLength)
}

// ─────────────────────────────────────────────────────────────────────────────
// Page entry point
// ─────────────────────────────────────────────────────────────────────────────

Page({
  build() {
    // Background
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 0, y: 0, w: W, h: H, color: 0x000000,
    })

    // Title
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 8, y: 24, w: W - 16, h: 48,
      color: 0xFF8C00,
      text_size: 28,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Rat Scout Settings',
    })

    // Instructions
    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16, y: 80, w: W - 32, h: 80,
      color: 0x888888,
      text_size: 18,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Configure settings in the Zepp\nphone app, then open this app\nto sync them to the watch.',
    })

    // Status area
    _statusWidget = hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16, y: 175, w: W - 32, h: 200,
      color: 0x44FF44,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Initializing...',
    })

    // Start BLE communication
    setupBle()
  },

  onDestroy() {
    try { hmBle.disConnect() } catch (e) {}
  },
})
