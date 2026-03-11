# Rat Scout — Copilot Context

## Project

Port of [mollyjester/rat_scout](https://github.com/mollyjester/rat_scout) to the **Amazfit GTS 4 Mini** using the Zepp OS SDK (zeus-cli v1.8.2).

**Two packages:**
| | Watchface | Companion App |
|---|---|---|
| App ID | 1000089 | 1000090 |
| App Type | `watchface` | `app` |
| Directory | root (`/`) | `companion_app/` |

**Target device:** GTS 4 Mini (336×384 px), deviceSource 246/247  
**Toolchain:** `~/.nvm/versions/node/v24.13.1/bin/zeus`  
**Build:** `zeus build` (run in root for watchface, in `companion_app/` for companion)  
**Bridge:** `zeus bridge` → `connect` → `install`

---

## Critical constraint: API 1.0 globals only

The GTS 4 Mini firmware runs API 1.0. The zeus bundler compiles `import` statements to `__$$RQR$$__()` calls, which **do not exist** at runtime on this firmware — they crash immediately.

**`watchface/index.js` and `companion_app/page/index.js` must never use `import`.** Use API 1.0 globals only:

| Global | Purpose |
|---|---|
| `hmUI` | Widget creation and properties |
| `hmSensor` | Sensor access |
| `hmBle` | Bluetooth messaging |
| `hmFS` | File system (read/write settings JSON) |
| `hmApp` | App info (`hmApp.packageInfo().appId`) |
| `WatchFace({})` | Watchface entry point |
| `Page({})` | App page entry point |
| `timer` | Timers |

**Phone-side code** (`app-side/index.js`) runs in the Zepp app worker, so imports are OK:
- Watchface side service: `import` from `@zos/utils`, `@zos/app`, etc.
- Companion side service: `import` from `@zeppos/zml/base-side` (bundled by rollup)
- `AppSideService` is a **GLOBAL** in the worker context — never imported.

### API 1.0 sensor access
```js
const _time = hmSensor.createSensor(hmSensor.id.TIME)
// Direct property access — NOT .getTime(), .getCurrent(), etc.
_time.hour   _time.minute   _time.day   _time.month   _time.year   _time.week
_bat.current   _ped.current
// Events
_time.addEventListener(_time.event.MINUTEEND, cb)
_bat.addEventListener(_bat.event.POWER, cb)
_ped.addEventListener(hmSensor.event.CHANGE, cb)
```

### API 1.0 widget pattern
```js
function mkw(type, params) { return hmUI.createWidget(type, params) }
function setp(w, key, val) { if (w) w.setProperty(key, val) }

// TEXT widget
const w = mkw(hmUI.widget.TEXT, { x, y, w, h, color, text_size, align_h, align_v, text })
setp(w, hmUI.prop.TEXT, 'new value')
setp(w, hmUI.prop.MORE, { color: 0xFF0000, w: 40 })

// IMG widget
const img = mkw(hmUI.widget.IMG, { x, y, w, h, src: 'images/foo.png' })
setp(img, hmUI.prop.SRC,     'images/bar.png')
setp(img, hmUI.prop.VISIBLE, false)
```

---

## Layout (336×384 portrait)

```
y=  0  h=42   Status bar: weekday | garbage bag icon | battery %  + graphical bar
y= 44  h=116  Time (HH:MM, large font)
y=162  h=82   Glucose zone: CGM value (left) | delta + age (right)
y=246  h=54   Date zone: DD.MM (left) | Wnn ISO week (right)
y=302  h=82   Bottom zone:
               Left col (x=8..167):   sun icon + time / moon phase icon + time
               Right col (x=168..335): temperature icon + value / wind icon + value / steps icon + count
```

---

## File structure

```
watchface/index.js      — Watch-side UI, API 1.0 globals, ~520 lines
app-side/index.js       — Watchface phone-side service, @zos/* imports, ~430 lines
setting/index.js        — (unused — Zepp App doesn't show settings for watchfaces)
app.js                  — Minimal app entry
app.json                — App manifest (appId 1000089)
ARCHITECTURE.md         — Detailed architecture reference
assets/gts4mini/
  images/               — All PNG icons (18 files)
    Moon: newmoon, waxingcrescentmoon, firstquartermoon, waxinggibbousmoon,
          fullmoon, waninggibbousmoon, thirdquartermoon, waningcrescentmoon
    Bags: organicbag, greybag, blackbag
    Weather: sun, umbrella, hourly, temperature, wind
    Other: steps, bg

companion_app/          — Settings companion (appId 1000090)
  app.json              — Manifest (appType "app")
  app.js                — Minimal entry
  package.json          — @zeppos/zml dependency
  page/index.js         — Watch page: BLE + hmFS ~314 lines
  app-side/index.js     — Phone service: settingsLib + BLE ~103 lines
  setting/index.js      — Settings UI: TextInput, Select ~228 lines
  assets/gts4mini/icon.png
```

---

## Settings (stored in companion app's settingsStorage)

| Key | Description |
|---|---|
| `dexcom_username` | Dexcom Share login |
| `dexcom_password` | Dexcom Share password |
| `dexcom_region` | `us` or `ous` |
| `bg_units` | `mgdl` or `mmol` |
| `owm_api_key` | OpenWeatherMap API key |
| `weather_units` | `metric` or `imperial` |
| `ipgeo_api_key` | ipgeolocation.io API key |
| `garbage_organic` | CSV of day numbers (0=Mon…6=Sun) |
| `garbage_grey` | CSV of day numbers |
| `garbage_black` | CSV of day numbers |
| `garbage_hour` | Hour after which next-day bag shown (default 9) |

Latitude/longitude auto-detected from IP (ip-api.com) — not in settings.

---

## Features

### Glucose (Dexcom CGM)
- Fetches from Dexcom Share API (US: `share2.dexcom.com`, OUS: `shareous1.dexcom.com`)
- Displays value, delta (±), and age in minutes
- Color: green (70–180 mg/dL), orange (>180), red (<70), gray (error)

### Weather (OpenWeatherMap)
- Displays temperature and wind speed

### Astronomy (ipgeolocation.io)
- Displays next sunrise/sunset time with sun icon
- Displays next moonrise/moonset time with moon phase icon (8 phases, 0=new…7=waning crescent)

### Garbage bin schedule
- Computed in `app-side/index.js` → `computeGarbageBag()` → returns `'O'`/`'G'`/`'B'`/`null`
- Watch shows the corresponding bag icon in the status bar; hidden when no pickup

---

## Messaging (watch ↔ phone)

### Watchface ↔ Watchface Side Service
The watch side cannot use `@zos/utils` `messageBuilder`. Instead, `watchface/index.js` implements inline `hmBle` framing compatible with the MessageBuilder protocol:

1. Watch sends a shake packet (`outerType=0x01`) to initiate
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll', settings: {...} }` wrapped in 16-byte outer + 66-byte inner header
4. Phone responds with data; watch parses and calls `applyAll(msg.data)`

Phone side uses `messageBuilder.listen()` from `@zos/utils`.

### Companion Page ↔ Companion Side Service
Same binary framing (16-byte outer + 66-byte inner). Side Service uses `@zeppos/zml` `BaseSideService` (internally uses `messaging.peerSocket`). ZML wraps `res(null, data)` as `{ result: data }` in BLE JSON — page must unwrap `msg.result`.

### Settings flow
1. User configures settings in Zepp App (companion's Settings App UI)
2. User opens companion app on watch → BLE request → gets settings → writes `rat_scout_settings.json` to hmFS
3. Watchface reads file on init → passes settings in `fetchAll` BLE request → Side Service uses as `_overrideSettings`

---

## Watchface constants to know

```js
const MOON_IMGS = [           // index 0–7 maps moonPhase from astronomy API
  'images/newmoon.png', 'images/waxingcrescentmoon.png',
  'images/firstquartermoon.png', 'images/waxinggibbousmoon.png',
  'images/fullmoon.png', 'images/waninggibbousmoon.png',
  'images/thirdquartermoon.png', 'images/waningcrescentmoon.png',
]
const BAG_IMGS = {            // keyed by garbageBag value from app-side
  O: 'images/organicbag.png',
  G: 'images/greybag.png',
  B: 'images/blackbag.png',
}
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']  // _time.week is 0=Sun
```


