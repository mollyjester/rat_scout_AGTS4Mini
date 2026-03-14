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
| `hmFS` | File system (read settings JSON) |
| `hmApp` | App info (`hmApp.packageInfo().appId`) |
| `WatchFace({})` | Watchface entry point |
| `Page({})` | App page entry point |
| `timer` | Timers |

**Phone-side code** (`app-side/index.js`) runs in the Zepp app worker, so imports are OK:
- Watchface side service: `import` from `@zeppos/zml/base-side` (bundled by rollup)
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

> **Firmware limitation:** `MINUTEEND` and `timer.createTimer()` do NOT fire
> when the screen is off. Use `WIDGET_DELEGATE` `resume_call` as the primary
> trigger for periodic work.

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

// WIDGET_DELEGATE — screen-on/off lifecycle callbacks
hmUI.createWidget(hmUI.widget.WIDGET_DELEGATE, {
  resume_call: function() { /* screen on (wrist raise) */ },
})
```

---

## Layout (336×384 portrait, 80px corner rounding)

```
y=  0  h=42   Status bar: garbage bag icon | weekday | battery % + bar  (x≥80 for rounding)
y= 44  h=34   Date zone: DD.MM (left) | Wnn ISO week (right)  (above time)
y= 78  h=116  Time (HH:MM, 100pt, color #343e9f, left-aligned x=80)
y=196  h=60   Glucose zone: CGM value + trend arrow (centered)
y=260  h=42   Weather row: temperature icon+value | wind icon+value
y=306  h=38   Steps row: steps icon + count
```

---

## File structure

```
watchface/index.js      — Watch-side UI, API 1.0 globals
                          Only computes: time, date (DD.MM), ISO week, battery, steps
                          All other values pre-computed by companion
                          Sends fetchAll to companion Side Service
                          (appId 1000090) via BLE
                          Reconnects (re-shakes) before each periodic fetch
                          Uses WIDGET_DELEGATE resume_call for screen-on refresh
                          (MINUTEEND does not fire when screen is off)
app-side/index.js       — Watchface phone-side service (STUB — never runs)
                          Zepp firmware does not launch side services for
                          appType "watchface" packages
setting/index.js        — (stub — Zepp App doesn't show settings for watchfaces)
app.js                  — Minimal app entry
app.json                — App manifest (appId 1000089)
package.json            — NPM deps: @zeppos/zml ^0.0.9
ARCHITECTURE.md         — Detailed architecture reference
assets/gts4mini/
  icon.png              — App icon
  images/               — PNG icons
    Bags: organicbag, greybag, blackbag
    Weather: umbrella, temperature, wind
    Other: steps, loading_0–7, bg

companion_app/          — Settings companion (appId 1000090)
  app.json              — Manifest (appType "app")
  app.js                — Minimal entry
  package.json          — @zeppos/zml dependency
  page/index.js         — Watch page: BLE + hmFS
  app-side/index.js     — Phone service: settings + data fetching
                          Handles getSettings (companion page) and
                          fetchAll (watchface) requests
                          Reads settings from settingsLib (settingsStorage)
                          directly — no file transfer needed
                          Computes: weekday, glucose color,
                          garbage bag, weather, glucose
  setting/index.js      — Settings UI: TextInput, Select
  assets/gts4mini/icon.png
```

---

## Settings (stored in companion app's settingsStorage)

| Key | Description |
|---|---|
| `dexcom_username` | Dexcom Share login |
| `dexcom_password` | Dexcom Share password |
| `dexcom_region` | `us`, `ous`, or `jp` |
| `bg_units` | `mgdl` or `mmol` |
| `owm_api_key` | OpenWeatherMap API key |
| `weather_units` | `metric` or `imperial` |
| `weather_interval` | Weather cache interval in minutes: `30`/`60`/`120`/`180` (default `60`) |
| `garbage_organic` | CSV of day numbers (0=Mon…6=Sun) |
| `garbage_grey` | CSV of day numbers |
| `garbage_black` | CSV of day numbers |
| `garbage_hour` | Hour after which next-day bag shown (default 9) |

Latitude/longitude auto-detected from IP (ip-api.com) — not in settings.

---

## Features

### Glucose (Dexcom CGM)
- Fetches from Dexcom Share API (US: `share2.dexcom.com`, OUS: `shareous1.dexcom.com`, JP: `share.dexcom.jp`)
- Session persistence: session/account IDs cached in `settingsLib` (`_dex_session` key), restored on next fetch
- Displays value + trend arrow (e.g. `"142 ↗"`), centered below time
- Trend arrows: `↑↑`, `↑`, `↗`, `→`, `↘`, `↓`, `↓↓`, `?`, `⚠` mapped from Dexcom `Trend` field
- Loading spinner shown in glucose zone during every BLE fetch (hides old data)
- Color: green (70–180 mg/dL), orange (>180), red (<70), gray (error)

### Weather (OpenWeatherMap)
- Fetches current weather + 5-day/3h forecast
- Displays temperature and wind speed
- Umbrella flag: current precipitation OR forecast precipitation today (`pop > 0.3`, rain/snow, weather ID 200–699)
- Smart caching: configurable interval (default 60 min) + Haversine location check (>5 km invalidates)

### Garbage bin schedule
- Computed in `companion_app/app-side/index.js` → `computeGarbageBag()` → returns `'O'`/`'G'`/`'B'`/`null`
- Watch shows the corresponding bag icon in the status bar; hidden when no pickup

### API retry logic
- All external fetches wrapped with `withRetry(fn, label, maxRetries=2, delayMs=2000)`
- Retries on both thrown exceptions and `null` returns
- Failed-after-retries returns `null`; `fetchAll()` handles gracefully

---

## Messaging (watch ↔ phone)

### Watchface ↔ Companion Side Service
The watch side cannot use `@zos/utils` `messageBuilder`. Instead, `watchface/index.js` implements inline `hmBle` framing compatible with the MessageBuilder protocol:

1. Watch sends a shake packet (`outerType=0x01`) to initiate — uses **companion appId** (1000090)
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll' }` wrapped in 16-byte outer + 66-byte inner header
4. Phone responds with data; watch parses and calls `applyAll(msg.result)`

The `fetchAll` response includes:
- `glucose`: `{ value, trendArrow, color }` (trendArrow = Unicode arrow string)
- `weather`: `{ temp, tempUnit, wind, windUnit, needsUmbrella }`
- `settings`: `{ garbageBag }` (always present)
- `weekday`: e.g. `'MON'`

The watchface targets the companion's appId (1000090) because Zepp firmware does NOT
register side services for `appType: "watchface"` packages (appId 1000089's side
service never launches).

The companion's Side Service uses `@zeppos/zml` `BaseSideService` for BLE handling
and handles both `getSettings` (from companion page) and `fetchAll` (from watchface).
The Side Service reads settings directly from `settingsLib` (`settingsStorage`) for
all API calls — no settings are passed in the BLE request.

Periodic refresh uses reconnect-before-fetch with two triggers:
- **`WIDGET_DELEGATE` `resume_call`** — fires on every screen-on (wrist raise).
  Primary trigger because `MINUTEEND` does NOT fire when screen is off.
- **`MINUTEEND` event** — fires each minute while screen stays on (secondary).

Both check `Date.now() - _lastFetchTime >= 5 min` before fetching.
On fetch: sets `_bleConnected = false`, re-shakes, and on reply sends `fetchAll`.

### Companion Page ↔ Companion Side Service
Same binary framing (16-byte outer + 66-byte inner). Side Service uses `@zeppos/zml` `BaseSideService` (internally uses `messaging.peerSocket`). ZML wraps `res(null, data)` as `{ result: data }` in BLE JSON — page must unwrap `msg.result`.

### Settings flow
1. User configures settings in Zepp App (companion's Settings App UI)
2. Values stored in companion app's `settingsStorage` (phone-side k/v store)
3. Watchface sends `{ action: 'fetchAll' }` via BLE to companion Side Service (appId 1000090)
4. Companion Side Service reads settings from `settingsLib` / `settingsStorage` directly
5. Companion Side Service uses those settings for all API calls

---

## Watchface constants to know

```js
const BAG_IMGS = {            // keyed by garbageBag value from app-side
  O: 'images/organicbag.png',
  G: 'images/greybag.png',
  B: 'images/blackbag.png',
}

const TREND_ARROWS = {        // Dexcom Trend field → Unicode arrow (used in app-side)
  None: '→', DoubleUp: '↑↑', SingleUp: '↑', FortyFiveUp: '↗',
  Flat: '→', FortyFiveDown: '↘', SingleDown: '↓', DoubleDown: '↓↓',
  NotComputable: '?', RateOutOfRange: '⚠',
}
```


