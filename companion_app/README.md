# Rat Scout Settings — Companion App

A standalone Zepp OS mini-app (`appType: "app"`) that provides a settings UI and
phone-side data fetching service for the **Rat Scout** watchface. Required because
the Zepp phone app does not expose a settings page for `appType: "watchface"` — only
for apps. The Side Service handles all external API calls (Dexcom Share, OpenWeatherMap)
and responds to the watchface (`fetchAll`) via BLE.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ PHONE (Zepp App)                                                │
│                                                                 │
│  ┌──────────────────┐     settingsStorage     ┌──────────────┐ │
│  │  Settings App UI  │ ◄─────────────────────► │ Side Service │ │
│  │  setting/index.js │                         │ app-side/    │ │
│  │  (AppSettingsPage)│                         │ index.js     │ │
│  └──────────────────┘                         │ (settings +  │ │
│                                                │  data fetch) │ │
│                                                └──────┬───────┘ │
│                                                       │ BLE     │
├───────────────────────────────────────────────────────┼─────────┤
│ WATCH                                                 │         │
│                                                       ▼         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Device App Page  (page/index.js)                        │   │
│  │  Stub — displays informational message only              │   │
│  │  (Settings are managed in the Zepp phone app)            │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Watchface  (../watchface/index.js — appId 1000089)      │   │
│  │  Sends fetchAll via BLE to companion Side Service (1000090)│  │
│  │  Receives pre-computed display data; renders widgets      │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. User opens **Zepp App → Profile → [watch] → App List → Rat Scout Settings → ⚙️**
2. Configures Dexcom, weather, garbage schedule
3. Settings saved to companion app's `settingsStorage`
4. Watchface sends `{ action: 'fetchAll' }` via BLE to this Side Service (appId 1000090)
5. Side Service reads settings from `settingsStorage` directly, fetches external APIs
6. Side Service responds with pre-computed display data (glucose, weather, garbage, weekday)

> **Note:** The companion page on the watch is a stub — it displays an
> informational message only. Settings are configured entirely through the
> Zepp phone app and read by the Side Service directly.

## Project Structure

```
companion_app/
├── app.json             App manifest (appId: 1000090, appType: "app")
├── app.js               Minimal App({}) entry (API 1.0 globals)
├── package.json         NPM deps: @zeppos/zml ^0.0.9
├── page/
│   └── index.js         Watch-side page (API 1.0 globals)
│                         Stub — displays informational message only
├── app-side/
│   └── index.js         Phone-side service (settings + data fetching)
│                         Uses @zeppos/zml BaseSideService + settingsLib
│                         Handles fetchAll (watchface) requests
│                         Fetches: Dexcom, OpenWeatherMap
│                         AppSideService is a GLOBAL (not imported)
├── setting/
│   └── index.js         Settings App UI
│                         AppSettingsPage with Section, TextInput, Select
└── assets/
    └── gts4mini/
        └── icon.png     App icon (62×62)
```

## Settings Keys

| Key | Component | Description | Example |
|-----|-----------|-------------|---------|
| `dexcom_username` | TextInput | Dexcom Share login | `user@email.com` |
| `dexcom_password` | TextInput | Dexcom Share password | `secret123` |
| `dexcom_region` | Select | `ous` (Outside US), `us`, or `jp` (Japan) | `ous` |
| `bg_units` | Select | `mgdl` or `mmol` | `mgdl` |
| `owm_api_key` | TextInput | OpenWeatherMap API key | `abc123def456` |
| `weather_units` | Select | `metric` or `imperial` | `metric` |
| `weather_interval` | Select | Weather cache interval (minutes): `30`/`60`/`120`/`180` | `60` |
| `garbage_hour` | TextInput | Hour after which next-day bag shows | `9` |
| `garbage_organic` | TextInput | CSV of Mon-based day numbers | `0,2,4` |
| `garbage_grey` | TextInput | CSV of Mon-based day numbers | `3` |
| `garbage_black` | TextInput | CSV of Mon-based day numbers | `1,5` |
| `weather_interval` | Select | Weather cache interval (minutes): `30`/`60`/`120`/`180` | `60` |

## How to Build & Install

### Prerequisites
- Zeus CLI: `~/.nvm/versions/node/v24.13.1/bin/zeus`
- Zepp App on phone with Developer Mode enabled
- Watch paired and connected

### Build

```bash
cd companion_app
npm install          # first time only — installs @zeppos/zml
zeus build
```

### Install to Watch

**Option A — via Bridge mode (recommended for development):**

1. In the Zepp phone app, enable Developer Mode (Profile → Settings → About → tap Zepp icon 7 times)
2. In Developer Mode, tap the **Bridge** button to enable it
3. Run:
   ```bash
   cd companion_app
   zeus bridge
   ```
4. Select `connect` → choose your device → `install`
5. The app appears in the watch's app list

**Option B — via Preview QR code:**

1. Run:
   ```bash
   cd companion_app
   zeus preview
   ```
2. Scan the QR code with the Zepp App's Developer Mode scanner

### After Installation

1. **Configure settings on your phone:**
   - Open Zepp App
   - Go to **Profile → [your watch name] → App List** (or "Installed Apps")
   - Find **"Rat Scout Settings"**
   - Tap the **⚙️ Settings gear icon** next to it
   - Fill in your Dexcom credentials, API keys, and garbage schedule
   
2. **Sync settings to the watch:**
   - On the watch, go to the app list
   - Open **"Rat Scout Settings"**
   - Wait for "Settings saved! (N keys)" message (takes a few seconds)
   - Press back to return to the watchface

3. **The watchface now uses your settings automatically.**
   Settings persist on the watch — you only need to re-sync after changing them.

## Updating Settings

Whenever you change settings in the Zepp App:
1. Open the Rat Scout Settings app on the watch
2. Wait for the sync confirmation
3. Return to the watchface

The watchface reads the settings file on every init (screen wake / watchface load).

## Technical Details

### API 1.0 Compatibility
- `app.js` and `page/index.js` use **API 1.0 globals only** — absolutely no `import`
  statements (the zeus bundler compiles them to `__$$RQR$$__()` calls which crash
  on the GTS 4 Mini)
- `app-side/index.js` uses `import` from `@zeppos/zml/base-side` — these are
  resolved by rollup at build time and bundled inline (no runtime `__$$RQR$$__` calls)
- `setting/index.js` uses `AppSettingsPage` global (Settings App runtime)

### @zeppos/zml Pattern

The Side Service uses `@zeppos/zml` v0.0.9 (official Zepp OS library) to avoid
importing `@zos/app-side/settings` which is not a valid runtime module in the
Side Service worker context:

```js
import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onRequest(req, res) { res(null, { settings: getAllSettings() }) },
}))
```

`BaseSideService`:
- Wraps the config object and calls `AppSideService()` (a global)
- Sets up `messaging.peerSocket` BLE listener internally
- Accesses `settings.settingsStorage` global for settings I/O
- Wraps `res(null, data)` as `{ result: data }` in the BLE JSON payload

### BLE Protocol
The Device App page uses the same MessageBuilder-compatible binary framing as
the watchface:

| Layer | Size | Contents |
|-------|------|----------|
| Outer header | 16 bytes | flag, version, outerType, port1, port2, appId, extra |
| Inner header | 66 bytes | traceId, spanId, seqId, totalLength, payloadLength, payloadType, opCode, timestamps, contentType, dataType |
| Payload | variable | UTF-8 JSON bytes |

Key offsets (from start of BLE packet):
- `arr[2..3]` — outerType (0x01=shake, 0x04=data)
- `arr[16..19]` — traceId
- `arr[36..39]` — payloadLength
- `arr[40]` — payloadType (0x01=request, 0x02=response)
- `arr[82..]` — JSON payload start

### Cross-App File Access
The companion page no longer writes settings files. The watchface sends
`{ action: 'fetchAll' }` via BLE directly to this companion's Side Service,
which reads settings from `settingsStorage` on the phone.

### Settings Normalisation
The companion Side Service normalises `settingsStorage` values before sending:

| UI Component | Raw storage format | Normalised output |
|---|---|---|
| TextInput | JSON-quoted: `"\"hello\""` | `"hello"` |
| Select | JSON object: `"{"name":"OUS","value":"ous"}"` | `"ous"` |
| Plain text (garbage CSVs) | `"0,2,4"` | `"0,2,4"` |

The companion Side Service normalises raw `settingsStorage` values for API use.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Settings page not visible in Zepp App | Make sure you installed the **companion app** (appId 1000090), not just the watchface. Look in Profile → [watch] → App List. |
| Watchface shows no data | The watchface fetches data via BLE every 5 minutes. Raise your wrist to trigger a refresh. |
| Settings lost after watch reboot | Settings file persists in hmFS across reboots. If lost, just re-open the companion app to re-sync. |
| Side Service crash in bridge logs | Check for `TypeError ... onInit` — likely an import issue. The Side Service must use `@zeppos/zml` pattern, not raw `@zos/app-side/settings` imports. |
