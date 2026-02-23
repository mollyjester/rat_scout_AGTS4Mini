# Rat Scout — Copilot Context

## Project

Port of [mollyjester/rat_scout](https://github.com/mollyjester/rat_scout) to the **Amazfit GTS 4 Mini** using the Zepp OS SDK (zeus-cli v1.8.2).

**App ID:** 1000089  
**Target device:** GTS 4 Mini (336×384 px), deviceSource 246/247  
**Toolchain:** `~/.nvm/versions/node/v24.13.1/bin/zeus`  
**Build:** `zeus build` · **Dev/watch:** `zeus dev` (connects to simulator at `http://127.0.0.1:7650`)  
**Compiled output:** `~/.config/simulator/apps/rat_scout_AGTS4Mini1000089/`

---

## Critical constraint: API 1.0 globals only

The GTS 4 Mini firmware runs API 1.0. The zeus bundler compiles `import` statements to `__$$RQR$$__()` calls, which **do not exist** at runtime on this firmware — they crash immediately on watchface open.

**`watchface/index.js` must never use `import`.** Use API 1.0 globals only:

| Global | Purpose |
|---|---|
| `hmUI` | Widget creation and properties |
| `hmSensor` | Sensor access |
| `hmBle` | Bluetooth messaging |
| `WatchFace({})` | Entry point |
| `hmApp` | App info (`hmApp.packageInfo().appId`) |
| `timer` | Timers |

`app-side/index.js` runs on the phone (Electron), so `import` from `@zos/*` is fine there.

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
watchface/index.js      — Watch-side UI, API 1.0 globals, ~500 lines
app-side/index.js       — Phone-side service, @zos/* imports OK, ~356 lines
app.js                  — Minimal app entry
app.json                — App manifest
assets/gts4mini/
  images/               — All PNG icons (downloaded from mollyjester/rat_scout)
    newmoon.png, waxingcrescentmoon.png, firstquartermoon.png,
    waxinggibbousmoon.png, fullmoon.png, waninggibbousmoon.png,
    thirdquartermoon.png, waningcrescentmoon.png
    organicbag.png, greybag.png, blackbag.png
    sun.png, umbrella.png, hourly.png, temperature.png, wind.png, steps.png
    bg.png
```

---

## Features

### Glucose (Dexcom CGM)
- Fetches from Dexcom Share API (US: `share2.dexcom.com`, OUS: `shareous1.dexcom.com`)
- Settings: `dexcom_username`, `dexcom_password`, `dexcom_region` (us/ous), `bg_units` (mgdl/mmol)
- Displays value, delta (±), and age in minutes
- Color: green (70–180 mg/dL), orange (>180), red (<70), gray (error)

### Weather (OpenWeatherMap)
- Settings: `owm_api_key`, `weather_units` (metric/imperial), `latitude`, `longitude`
- Displays temperature and wind speed

### Astronomy (ipgeolocation.io)
- Settings: `ipgeo_api_key`, `latitude`, `longitude`
- Displays next sunrise/sunset time with sun icon
- Displays next moonrise/moonset time with moon phase icon (8 phases, 0=new…7=waning crescent)

### Garbage bin schedule
- Settings: `garbage_organic`, `garbage_grey`, `garbage_black` — CSV of day numbers (0=Mon…6=Sun)
- Setting: `garbage_hour` — hour after which next-day bag is shown (default 9)
- Computed in `app-side/index.js` → `computeGarbageBag()` → returns `'O'`/`'G'`/`'B'`/`null`
- Watch shows the corresponding bag icon in the status bar; hidden when no pickup

---

## Messaging (watch ↔ phone)

The watch side cannot use `@zos/utils` `messageBuilder`. Instead, `watchface/index.js` implements inline `hmBle` framing compatible with the MessageBuilder protocol:

1. Watch sends a shake packet (`outerType=0x01`) to initiate
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll' }` wrapped in 16-byte outer + 66-byte inner header
4. Phone responds with data; watch parses and calls `applyAll(msg.data)`

Phone side (`app-side/index.js`) uses standard `messageBuilder` from `@zos/utils` — no changes needed there.

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


