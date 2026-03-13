# Rat Scout — Architecture Reference (Amazfit GTS 4 Mini)

## App Identity

This project consists of **two Zepp OS packages** that work together:

| | Watchface | Companion App |
|---|---|---|
| **App ID** | 1000089 | 1000090 |
| **App Type** | `watchface` | `app` |
| **Purpose** | Display UI on watch (BLE to companion for data) | Settings UI + data fetching Side Service |
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

**Data fetching** (Dexcom, weather, astronomy) is handled by the **companion app's
Side Service** (appId 1000090). Zepp OS firmware does **not** register/launch side
services for `appType: "watchface"` packages — the phone framework's file lookup
for the side service `app.json` fails with "file does not exist". Therefore the
watchface routes all BLE requests to the companion's side service (appId 1000090),
which is properly registered because it has `appType: "app"`.

```
┌─────────────────────────────────────────────────────────────────────┐
│ PHONE (Zepp App)                                                    │
│                                                                     │
│  Companion App (1000090)                                            │
│  ┌────────────────┐  settingsStorage  ┌──────────────────────────┐ │
│  │ Settings App UI │◄════════════════►│ Side Service             │ │
│  │ setting/index   │                  │ app-side/index           │ │
│  └────────────────┘                  │                          │ │
│                                       │ Handles:                 │ │
│                                       │  • getSettings (→ page)  │ │
│                                       │  • fetchAll (→ watchface)│ │
│                                       │ fetch():                 │ │
│                                       │  • Dexcom Share API      │ │
│                                       │  • OpenWeatherMap API    │ │
│                                       │  • ipgeolocation.io API  │ │
│                                       │  • ip-api.com (geoloc)   │ │
│                                       └────────────┬─────────────┘ │
│                                                     │ BLE           │
│                                                     │ (BaseSideService│
│                                                     │  via @zeppos/zml)│
├─────────────────────────────────────────────────────┼───────────────┤
│ WATCH (Amazfit GTS 4 Mini)                          │               │
│                                                     ▼               │
│  ┌──────────────────┐              ┌──────────────────────────┐  │
│  │ Companion Page    │              │                          │  │
│  │ page/index.js     │              │ Watchface                │  │
│  │                   │              │ watchface/index.js       │  │
│  │ Writes settings   │              │                          │  │
│  │ to hmFS (local)   │              │ Sends fetchAll via BLE   │  │
│  └──────────────────┘              │ to companion (1000090)   │  │
│                                     └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### End-to-End Settings Flow

1. User opens **Zepp App → Profile → [watch] → App List → Rat Scout Settings → ⚙️**
2. Configures Dexcom, weather, astronomy, garbage schedule in the Settings App UI
3. Values stored in companion app's `settingsStorage` (phone-side k/v store)
4. Watchface sends `{ action: 'fetchAll' }` via BLE to **companion** Side Service (appId 1000090)
5. Companion Side Service reads settings directly from `settingsLib` / `settingsStorage`
6. Companion Side Service uses those settings for all API calls (Dexcom, OWM, ipgeo, garbage)
7. Companion Side Service responds with data; watchface renders it

The watchface does **not** read or store settings — all settings live in the
companion app's `settingsStorage` and are read server-side (phone) on every fetch.

### Periodic Data Refresh (Reconnect-Before-Fetch)

After the initial fetch, the watchface sets up a repeating timer (`FETCH_INTERVAL`,
default 5 minutes). On each tick it **resets the BLE connection** (`_bleConnected = false`,
`_blePort = 0`) and re-initiates the shake handshake. When the shake reply arrives the
handler calls `_sendFetchAll()` with fresh connection state. This reconnect-before-fetch
pattern is necessary because the BLE link to the companion's Side Service (appId 1000090)
goes stale between fetches.

---

## File Map

### Watchface (root — appId 1000089)

```
app.js                  — App({ globalData, onCreate, onDestroy })
app.json                — Manifest: appId 1000089, appType "watchface"
package.json            — NPM deps: @zeppos/zml ^0.0.9
ARCHITECTURE.md         — This file

watchface/index.js      — Watch-side UI (API 1.0 globals only)
                          WatchFace({ onInit, build, onDestroy })
                          Manual hmBle framing (MessageBuilder-compatible)
                          Only computes: time, date (DD.MM), ISO week, battery, steps
                          All other values pre-computed by companion
                          Sends { action: 'fetchAll' } to companion
                          Side Service (appId 1000090) via BLE
                          Reconnects (re-shakes) before each periodic fetch

app-side/index.js       — Phone-side service (STUB — never runs)
                          Zepp firmware does not launch side services for
                          appType "watchface" packages

setting/index.js        — Settings App stub (unreachable — Zepp App doesn't
                          expose settings for watchfaces)

assets/gts4mini/
  icon.png              — App icon
  images/               — PNG icons (16 files):
                          Moon phases (8), garbage bags (3), weather (4),
                          steps, umbrella
```

### Companion App (`companion_app/` — appId 1000090)

```
companion_app/
├── app.json            — Manifest: appId 1000090, appType "app"
├── app.js              — Minimal App({}) entry (API 1.0 globals)
├── package.json        — NPM deps: @zeppos/zml ^0.0.9
├── page/
│   └── index.js        — Watch-side page (API 1.0 globals)
│                         Manual hmBle framing, hmFS write
├── app-side/
│   └── index.js        — Phone-side service (settings + data fetching)
│                         Uses @zeppos/zml BaseSideService + settingsLib
│                         Handles getSettings (companion page) and
│                         fetchAll (watchface) requests
│                         Computes: weekday, glucose color, timeDelta suffix,
│                         garbage bag, weather, astronomy, glucose
│                         Fetches: Dexcom, OpenWeatherMap, ipgeolocation.io
│                         AppSideService is a GLOBAL (not imported)
├── setting/
│   └── index.js        — Settings App UI
│                         AppSettingsPage, Section, TextInput, Select
└── assets/
    └── gts4mini/
        └── icon.png    — App icon (62×62)
```

---

## Communication Protocols

### Watchface ↔ Companion Side Service (BLE)

The watch side cannot use `@zos/utils` `messageBuilder` (import crashes API 1.0).
Instead, `watchface/index.js` implements inline `hmBle` framing compatible with
the MessageBuilder binary protocol:

1. Watch sends **shake packet** (`outerType=0x01`) to initiate — using **companion appId** (1000090)
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll' }` wrapped in:
   - 16-byte outer header (flag, version, outerType, port1, port2, appId, extra)
   - 66-byte inner header (traceId, spanId, seqId, lengths, payloadType, timestamps)
4. Phone responds with data; watch parses and calls `applyAll(msg.result)`

The watchface uses the **companion appId** (1000090) for BLE routing because
Zepp firmware does not register side services for `appType: "watchface"` packages.
The companion's Side Service uses `@zeppos/zml` `BaseSideService` and dispatches
incoming requests to `onRequest(req, res)`, handling both `getSettings` (from the
companion page) and `fetchAll` (from the watchface).

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
| 26 | 32 | timestamps (8 × u32: first is ms-of-10M, rest zero) |
| 58 | 8 | reserved (2 × u32 zero) |
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

The companion's Side Service uses `fetch()` (resolved via `require('@zos/app-side/network')`
or `BaseSideService`'s `this.fetch`) to call external APIs: Dexcom, OpenWeatherMap,
ipgeolocation.io, ip-api.com.

The watchface's own Side Service (`app-side/index.js`) is a **stub** — it never runs
because Zepp firmware does not launch side services for watchface packages.

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
- `app-side/index.js` (watchface): uses `import` from `@zeppos/zml/base-side`
  (bundled by rollup at build time — no runtime `__$$RQR$$__` calls)
- `companion_app/app-side/index.js`: uses `import` from `@zeppos/zml/base-side`
  (bundled by rollup at build time — no runtime `__$$RQR$$__` calls)
- `AppSideService` is a **global function** in the worker context — never imported.

### @zeppos/zml Pattern (Both Side Services)

Both the watchface's and companion's Side Services use `@zeppos/zml` v0.0.9
(official Zepp OS library):

**Watchface Side Service** (`app-side/index.js`) — **STUB** (never runs):
```js
import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onInit() {},
  onRun() {},
  onDestroy() {},
}))
```

**Companion Side Service** (`companion_app/app-side/index.js`) — handles ALL requests:
```js
import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onInit() { },
  onRequest(req, res) {
    if (req.action === 'getSettings') {
      res(null, { settings: getAllSettings() })
    } else if (req.action === 'fetchAll') {
      // Settings read directly from settingsLib (settingsStorage)
      const data = await fetchAll()
      res(null, data)
    }
  },
  onSettingsChange({ key }) { },
}))
```

`BaseSideService` wraps the config object, internally:
- Calls `messaging.peerSocket.addListener('message', ...)` to listen for BLE
- Calls `settings.settingsStorage` global for settings access (only companion needs this)
- Handles shake/response protocol automatically
- Wraps `res(null, data)` as `{ result: data }` in the BLE JSON payload
- Provides `this.fetch` as a fallback for network requests

This avoids importing `@zos/app-side/settings` which crashes the Side Service
worker (`__$$RQR$$__("@zos/app-side/settings")` is not a valid runtime module).

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
