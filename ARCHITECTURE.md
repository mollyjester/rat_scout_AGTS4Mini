# Rat Scout — Architecture Reference (Amazfit GTS 4 Mini)

## App Identity

This project consists of **two Zepp OS packages** that work together:

| | Watchface | Companion App |
|---|---|---|
| **App ID** | 1000089 | 1000090 |
| **App Type** | `watchface` | `app` |
| **Purpose** | Display UI on watch | Provide settings UI + relay settings to watch |
| **Target Device** | Amazfit GTS 4 Mini (336×384 px) | Amazfit GTS 4 Mini (336×384 px) |
| **Device Source** | 246 (CN), 247 (global) | 246 (CN), 247 (global) |
| **Zepp OS API** | 1.0 | 1.0 |

| Key | Value |
|---|---|
| Toolchain | zeus-cli v1.8.2 (`~/.nvm/versions/node/v24.13.1/bin/zeus`) |
| Build | `zeus build` (run separately in root and `companion_app/`) |
| Dev/Bridge | `zeus bridge` → `connect` → `install` |
| Preview | `zeus preview` (simulator at `http://127.0.0.1:7650`) |

---

## Two-Package Architecture

Zepp OS does **not** expose a Settings page for `appType: "watchface"`. Only
`appType: "app"` gets a settings gear icon in the Zepp phone app. To work around
this, the project ships a **companion app** (appId 1000090) whose sole purpose is
to provide a settings UI and relay configured values to the watchface (appId 1000089)
via an hmFS file.

```
┌─────────────────────────────────────────────────────────────────────┐
│ PHONE (Zepp App)                                                    │
│                                                                     │
│  Companion App (1000090)                  Watchface (1000089)       │
│  ┌────────────────┐  settingsStorage  ┌──────────────────────────┐ │
│  │ Settings App UI │◄════════════════►│ Side Service             │ │
│  │ setting/index   │                  │ app-side/index           │ │
│  └────────────────┘                  │                          │ │
│                                       │ fetch():                 │ │
│  ┌────────────────┐      BLE         │  • Dexcom Share API      │ │
│  │ Side Service    │◄── (ZML) ──┐    │  • OpenWeatherMap API    │ │
│  │ app-side/index  │            │    │  • ipgeolocation.io API  │ │
│  │ (@zeppos/zml)   │            │    │  • ip-api.com (geoloc)   │ │
│  └────────────────┘            │    └────────────┬─────────────┘ │
│                                 │                  │ BLE           │
│                                 │                  │ (messageBuilder)│
├─────────────────────────────────┼──────────────────┼───────────────┤
│ WATCH (Amazfit GTS 4 Mini)      │                  │               │
│                                 │                  ▼               │
│  ┌──────────────────┐          │    ┌──────────────────────────┐  │
│  │ Companion Page    │──────────┘    │ Watchface                │  │
│  │ page/index.js     │              │ watchface/index.js       │  │
│  │                   │── hmFS ──────►│                          │  │
│  │ Requests settings │  writes      │ Reads settings file      │  │
│  │ via BLE, writes   │  JSON file   │ Sends to own Side Service│  │
│  │ to hmFS           │              │ for API calls            │  │
│  └──────────────────┘              └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### End-to-End Settings Flow

1. User opens **Zepp App → Profile → [watch] → App List → Rat Scout Settings → ⚙️**
2. Configures Dexcom, weather, astronomy, garbage schedule in the Settings App UI
3. Values stored in companion app's `settingsStorage` (phone-side k/v store)
4. User opens **Rat Scout Settings** on the watch (companion app page)
5. Page sends BLE shake + `{ action: 'getSettings' }` to companion Side Service
6. Companion Side Service reads `settingsStorage`, normalises values, responds via BLE
7. Page writes `rat_scout_settings.json` to hmFS (own dir + cross-app to `../1000089/`)
8. User returns to the **Rat Scout** watchface
9. Watchface reads `rat_scout_settings.json` from hmFS on init
10. Watchface sends settings in `{ action: 'fetchAll', settings: {...} }` to its own Side Service
11. Side Service uses settings as `_overrideSettings` for all API calls

---

## File Map

### Watchface (root — appId 1000089)

```
app.js                  — App({ globalData, onCreate, onDestroy })
app.json                — Manifest: appId 1000089, appType "watchface"
ARCHITECTURE.md         — This file

watchface/index.js      — Watch-side UI (~520 lines, API 1.0 globals only)
                          WatchFace({ onInit, build, onDestroy })
                          Manual hmBle framing (MessageBuilder-compatible)
                          Reads rat_scout_settings.json from hmFS on init

app-side/index.js       — Phone-side service (~430 lines)
                          AppSideService({ onInit, onRun, onDestroy })
                          Uses messageBuilder from @zos/utils
                          Fetches: Dexcom, OpenWeatherMap, ipgeolocation.io
                          Accepts _overrideSettings from companion app

setting/index.js        — Settings App (unreachable — Zepp App doesn't
                          expose settings for watchfaces, kept for reference)

assets/gts4mini/images/ — All PNG icons (18 files):
                          Moon phases (8), garbage bags (3), weather (4),
                          steps, background, hourly, umbrella
```

### Companion App (`companion_app/` — appId 1000090)

```
companion_app/
├── app.json            — Manifest: appId 1000090, appType "app"
├── app.js              — Minimal App({}) entry (API 1.0 globals)
├── package.json        — NPM deps: @zeppos/zml ^0.0.9
├── page/
│   └── index.js        — Watch-side page (~314 lines, API 1.0 globals)
│                         Manual hmBle framing, hmFS write
├── app-side/
│   └── index.js        — Phone-side service (~103 lines)
│                         Uses @zeppos/zml BaseSideService + settingsLib
│                         AppSideService is a GLOBAL (not imported)
├── setting/
│   └── index.js        — Settings App UI (~228 lines)
│                         AppSettingsPage, Section, TextInput, Select
└── assets/
    └── gts4mini/
        └── icon.png    — App icon (62×62)
```

---

## Communication Protocols

### Watchface ↔ Watchface Side Service (BLE)

The watch side cannot use `@zos/utils` `messageBuilder` (import crashes API 1.0).
Instead, `watchface/index.js` implements inline `hmBle` framing compatible with
the MessageBuilder binary protocol:

1. Watch sends **shake packet** (`outerType=0x01`) to initiate
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll', settings: {...} }` wrapped in:
   - 16-byte outer header (flag, version, outerType, port1, port2, appId, extra)
   - 66-byte inner header (traceId, spanId, seqId, lengths, payloadType, timestamps)
4. Phone responds with data; watch parses and calls `applyAll(msg.data)`

Phone side uses standard `messageBuilder.listen()` from `@zos/utils`.

### Companion Page ↔ Companion Side Service (BLE)

The companion's `page/index.js` uses the **same** MessageBuilder-compatible binary
framing (16-byte outer + 66-byte inner header). The companion Side Service uses
`@zeppos/zml` `BaseSideService`, which internally calls `messaging.peerSocket`
(the phone-side BLE transport).

**Inner header byte layout** (66 bytes, all little-endian):

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | traceId |
| 4 | 4 | parentId (always 0) |
| 8 | 4 | spanId |
| 12 | 4 | seqId |
| 16 | 4 | totalLength |
| 20 | 4 | payloadLength |
| 24 | 1 | payloadType (0x01=request, 0x02=response) |
| 25 | 1 | opCode (0x01=finished) |
| 26 | 28 | timestamps + reserved |
| 54 | 1 | contentType (0x02=JSON) |
| 55 | 1 | dataType (0x02=JSON) |
| 56 | 10 | reserved |
| 66 | … | JSON payload bytes |

When the outer 16-byte header is prepended, the payload starts at byte 82.

**ZML response wrapping**: `BaseSideService`'s `onRequest(req, res)` callback calls
`res(null, data)` which serialises the BLE JSON as `{"result": data}`. The companion
page must unwrap `msg.result` to get the actual response payload.

### Settings App ↔ Side Service (settingsStorage)

Both the Settings App and Side Service share `settingsStorage` — a persistent
key-value store in the Zepp phone app. No BLE involved.

- **Settings App → Side Service**: User changes a field → `settingsStorage.setItem(key, value)`.
  Side Service can listen via `settingsStorage.addListener('change', callback)`.
- **Side Service → Settings App**: `settingsStorage.setItem()` in Side Service triggers
  automatic re-render of the Settings App `build()` lifecycle.

### Side Service → Internet (fetch)

The watchface's Side Service uses `fetch()` from `@zos/app-side/network` to call
external APIs (Dexcom, OpenWeatherMap, ipgeolocation.io, ip-api.com).

The companion's Side Service does **not** make network calls — it only reads
`settingsStorage` and relays values over BLE.

---

## Settings Keys

All stored in the **companion app's** `settingsStorage` (Zepp phone app persistent
storage). The watchface's own `settingsStorage` is empty — it receives settings
via the hmFS file written by the companion page.

| Key | UI Component | Default | Description |
|---|---|---|---|
| `dexcom_username` | TextInput | `''` | Dexcom Share login email/phone |
| `dexcom_password` | TextInput | `''` | Dexcom Share password |
| `dexcom_region` | Select | `'ous'` | Dexcom server: `'us'` or `'ous'` (outside US) |
| `bg_units` | Select | `'mgdl'` | Blood glucose units: `'mgdl'` or `'mmol'` |
| `owm_api_key` | TextInput | `''` | OpenWeatherMap API key |
| `weather_units` | Select | `'metric'` | Weather units: `'metric'` or `'imperial'` |
| `ipgeo_api_key` | TextInput | `''` | ipgeolocation.io API key |
| `garbage_organic` | TextInput | `''` | Organic bag days CSV (0=Mon…6=Sun) |
| `garbage_grey` | TextInput | `''` | Grey bag days CSV |
| `garbage_black` | TextInput | `''` | Black bag days CSV |
| `garbage_hour` | TextInput | `'9'` | Hour after which next-day bag shown |

**Latitude/longitude** are auto-detected from IP (ip-api.com / ipapi.co) by the
watchface's Side Service — not stored in settings.

### Settings Normalisation

The companion Side Service normalises `settingsStorage` values before sending:

| UI Component | Raw storage format | Normalised output |
|---|---|---|
| TextInput | JSON-quoted: `"\"hello\""` | `"hello"` |
| Select | JSON object: `"{\"name\":\"US\",\"value\":\"us\"}"` | `"us"` |
| Plain text (garbage CSVs) | `"0,2,4"` | `"0,2,4"` |

---

## Watchface Layout (336×384 portrait)

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

## API 1.0 Constraints

The GTS 4 Mini firmware runs API 1.0. Critical rules for watch-side code
(`watchface/index.js` and `companion_app/page/index.js`):

1. **NO `import` statements** — the zeus bundler compiles them to `__$$RQR$$__()` calls
   which do not exist at runtime → immediate crash.
2. **Use only API 1.0 globals**: `hmUI`, `hmSensor`, `hmBle`, `hmFS`, `hmApp`,
   `WatchFace`, `Page`, `timer`
3. **Sensor access is via direct properties**, not methods:
   ```js
   const _time = hmSensor.createSensor(hmSensor.id.TIME)
   _time.hour  _time.minute  _time.day  _time.month  _time.year  _time.week
   ```
4. **Widget pattern**:
   ```js
   const w = hmUI.createWidget(hmUI.widget.TEXT, { x, y, w, h, color, text_size, text })
   w.setProperty(hmUI.prop.TEXT, 'new value')
   w.setProperty(hmUI.prop.MORE, { color: 0xFF0000 })
   ```

**Phone-side code** runs in the Zepp app's JS runtime (Electron/WebWorker):
- `app-side/index.js` (watchface): uses `import` from `@zos/utils`, `@zos/app`, etc.
- `companion_app/app-side/index.js`: uses `import` from `@zeppos/zml/base-side`
  (bundled by rollup at build time — no runtime `__$$RQR$$__` calls)
- `AppSideService` is a **global function** in the worker context — never imported.

### @zeppos/zml Pattern (Companion Side Service)

The companion Side Service uses `@zeppos/zml` v0.0.9 (official Zepp OS library):

```js
import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onInit() { },
  onRequest(req, res) { res(null, { settings }) },
  onSettingsChange({ key }) { },
}))
```

`BaseSideService` wraps the config object, internally:
- Calls `messaging.peerSocket.addListener('message', ...)` to listen for BLE
- Calls `settings.settingsStorage` global for settings access
- Handles shake/response protocol automatically
- Wraps `res(null, data)` as `{ result: data }` in the BLE JSON payload

This avoids importing `@zos/app-side/settings` which crashes the Side Service
worker (`__$$RQR$$__("@zos/app-side/settings")` is not a valid runtime module).

---

## Cross-App File Transfer

The companion page writes `rat_scout_settings.json` to **two locations**:

1. **Own data directory** (`hmFS.open('rat_scout_settings.json', ...)`) — always succeeds
2. **Watchface data directory** (`hmFS.open('../1000089/rat_scout_settings.json', ...)`) —
   may succeed depending on firmware sandbox policy

The watchface reads from:
1. Its own data directory (succeeds if cross-app write worked)
2. `../1000090/rat_scout_settings.json` (fallback — reads from companion's directory)

---

## Origin: rat_scout (Pebble)

This project is a port of [mollyjester/rat_scout](https://github.com/mollyjester/rat_scout),
a Pebble watchface using C (watch side) and PebbleKit JS + Clay (phone side).

### Settings mapping (Pebble Clay → Zepp OS settingsStorage)

| Pebble Clay messageKey | Zepp OS key | Notes |
|---|---|---|
| `DEX_LOGIN` | `dexcom_username` | |
| `DEX_PASSWORD` | `dexcom_password` | |
| `DEX_REGION` | `dexcom_region` | Pebble has `'jp'` option too |
| `BG_UNITS` | `bg_units` | Pebble uses `'mg/dL'`/`'mmol/L'`, we use `'mgdl'`/`'mmol'` |
| `OWM_API_KEY` | `owm_api_key` | |
| `WEATHER_UNITS` | `weather_units` | |
| `ASTRO_API_KEY` | `ipgeo_api_key` | |
| `GARBAGE_PICKUP_TIME` | `garbage_hour` | |
| `GARBAGE_ORGANIC_DAYS` | `garbage_organic` | Pebble: bool array → bitmask; Zepp: CSV of day nums |
| `GARBAGE_GREY_DAYS` | `garbage_grey` | |
| `GARBAGE_BLACK_DAYS` | `garbage_black` | |

Pebble uses `navigator.geolocation` for coordinates. Zepp OS Side Service has no
`navigator.geolocation`, and the Geolocation sensor requires API 2.1+ (GTS 4 Mini
only has 1.0). Instead, coordinates are auto-detected via IP geolocation
(ip-api.com / ipapi.co) transparently — no user input required. The detected
values are cached internally but not exposed in the Settings UI.
