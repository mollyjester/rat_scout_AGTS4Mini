# Rat Scout — Architecture Reference (Amazfit GTS 4 Mini)

## App Identity

| Key | Value |
|---|---|
| App ID | 1000089 |
| App Type | watchface |
| Target Device | Amazfit GTS 4 Mini (336×384 px, square, corner radius 80) |
| Device Source | 246 (CN), 247 (global) |
| Zepp OS API | 1.0 (the only version this device supports) |
| Toolchain | zeus-cli v1.8.2 (`~/.nvm/versions/node/v24.13.1/bin/zeus`) |
| Build | `zeus build` |
| Preview | `zeus preview` (simulator at `http://127.0.0.1:7650`) |
| Compiled output | `~/.config/simulator/apps/rat_scout_AGTS4Mini1000089/` |

---

## Three-Part Architecture (Zepp OS)

```
┌─────────────────────────────────────────────────────────┐
│                    Zepp Phone App                       │
│                                                         │
│  ┌─────────────────┐    settingsStorage    ┌──────────┐ │
│  │  Settings App   │◄════════════════════►│ Side     │ │
│  │  setting/index  │   (shared k/v store)  │ Service  │ │
│  │  (AppSettings   │                       │ app-side │ │
│  │   Page UI)      │                       │ /index   │ │
│  └─────────────────┘                       └────┬─────┘ │
│                                                  │      │
│                      fetch() to internet APIs    │      │
│                      ┌───────────────────────────┘      │
│                      │  • Dexcom Share API               │
│                      │  • OpenWeatherMap API             │
│                      │  • ipgeolocation.io API           │
│                      │  • ip-api.com (geolocation)       │
└──────────────────────┼──────────────────────────────────┘
                       │ BLE (hmBle / messageBuilder)
                       │
┌──────────────────────┼──────────────────────────────────┐
│  Amazfit GTS 4 Mini  │                                  │
│                      ▼                                  │
│  ┌──────────────────────────────────────────────────┐   │
│  │  watchface/index.js                               │   │
│  │  WatchFace({ onInit, build, onDestroy })         │   │
│  │  API 1.0 globals: hmUI, hmSensor, hmBle, hmApp   │   │
│  │  NO imports — bundler __$$RQR$$__ crashes on 1.0  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### app.json Module Declaration

```json
"module": {
  "watchface": { "path": "watchface/index" },
  "app-side":  { "path": "app-side/index" },
  "setting":   { "path": "setting/index" }
}
```

---

## File Map

```
app.js                  — App({ globalData, onCreate, onDestroy })
app.json                — Manifest: appId, targets, module paths, permissions
ARCHITECTURE.md         — This file

watchface/index.js      — Watch-side UI (API 1.0 globals only, ~485 lines)
                          WatchFace({ onInit, build, onDestroy })
                          Manual hmBle framing (MessageBuilder-compatible)

app-side/index.js       — Phone-side service (~356 lines)
                          AppSideService({ onInit, onRun, onDestroy })
                          Imports: @zos/app, @zos/utils, @zos/app-side/network,
                                   @zos/app-side/settings
                          Fetches: Dexcom, OpenWeatherMap, ipgeolocation.io
                          Communicates with watch via messageBuilder

setting/index.js        — Settings App (phone-side UI in Zepp App)
                          AppSettingsPage({ build(props) })
                          Uses props.settingsStorage for read/write
                          UI components: Section, TextInput, Select, Toggle, Button, View, Text

assets/gts4mini/images/ — All PNG icons for the watchface
```

---

## Communication Protocols

### Watch ↔ Phone (BLE)

The watch side cannot use `@zos/utils` `messageBuilder` (import crashes API 1.0).
Instead, `watchface/index.js` implements inline `hmBle` framing compatible with
the MessageBuilder binary protocol:

1. Watch sends **shake packet** (`outerType=0x01`) to initiate
2. Phone replies with shake response; watch learns `_blePort` from reply's `port2`
3. Watch sends JSON request `{ action: 'fetchAll' }` wrapped in:
   - 16-byte outer header (version, outerType, port, appId)
   - 66-byte inner header (traceId, spanId, seqId, lengths, payloadType, timestamps)
4. Phone responds with data; watch parses and calls `applyAll(msg.data)`

Phone side uses standard `messageBuilder` from `@zos/utils`.

### Settings App ↔ Side Service (settingsStorage)

Both the Settings App and Side Service share `settingsStorage` — a persistent
key-value store in the Zepp phone app. No BLE involved.

- **Settings App → Side Service**: User changes a field → `settingsStorage.setItem(key, value)`.
  Side Service can listen via `settingsStorage.addListener('change', callback)`.
- **Side Service → Settings App**: `settingsStorage.setItem()` in Side Service triggers
  automatic re-render of the Settings App `build()` lifecycle.

### Side Service → Internet (fetch)

Side Service uses `fetch()` from `@zos/app-side/network` to call external APIs.

---

## Settings Keys

All stored in `settingsStorage` (Zepp phone app persistent storage).

| Key | Type | Default | Description |
|---|---|---|---|
| `dexcom_username` | string | `''` | Dexcom Share login email |
| `dexcom_password` | string | `''` | Dexcom Share password |
| `dexcom_region` | `'us'`/`'ous'` | `'ous'` | Dexcom server region |
| `bg_units` | `'mgdl'`/`'mmol'` | `'mgdl'` | Blood glucose display units |
| `owm_api_key` | string | `''` | OpenWeatherMap API key |
| `weather_units` | `'metric'`/`'imperial'` | `'metric'` | Weather display units |
| `ipgeo_api_key` | string | `''` | ipgeolocation.io API key |
| `latitude` | string (decimal) | `''` | Auto-detected from IP (internal, not shown in Settings UI) |
| `longitude` | string (decimal) | `''` | Auto-detected from IP (internal, not shown in Settings UI) |
| `garbage_organic` | string (CSV) | `''` | Organic bag days (0=Mon…6=Sun) |
| `garbage_grey` | string (CSV) | `''` | Grey bag days |
| `garbage_black` | string (CSV) | `''` | Black bag days |
| `garbage_hour` | string (number) | `'9'` | Hour after which next-day bag shown |

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

The GTS 4 Mini firmware runs API 1.0. Critical rules for `watchface/index.js`:

1. **NO `import` statements** — the zeus bundler compiles them to `__$$RQR$$__()` calls
   which do not exist at runtime → immediate crash on watchface open.
2. **Use only API 1.0 globals**: `hmUI`, `hmSensor`, `hmBle`, `WatchFace`, `hmApp`, `timer`
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

`app-side/index.js` and `setting/index.js` run on the phone (Zepp app / JS runtime),
so `import` from `@zos/*` is fine there.

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
values are cached in settingsStorage but not exposed in the Settings UI.
