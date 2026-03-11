# Rat Scout Settings — Companion App

A standalone Zepp OS mini-app (`appType: "app"`) that provides a settings UI for
the **Rat Scout** watchface. Required because the Zepp phone app does not expose
a settings page for `appType: "watchface"` — only for apps.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ PHONE (Zepp App)                                                │
│                                                                 │
│  ┌──────────────────┐     settingsStorage     ┌──────────────┐ │
│  │  Settings App UI  │ ◄─────────────────────► │ Side Service │ │
│  │  setting/index.js │                         │ app-side/    │ │
│  │  (AppSettingsPage)│                         │ index.js     │ │
│  └──────────────────┘                         │ (@zeppos/zml)│ │
│                                                └──────┬───────┘ │
│                                                       │ BLE     │
├───────────────────────────────────────────────────────┼─────────┤
│ WATCH                                                 │         │
│                                                       ▼         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Device App Page  (page/index.js)                        │   │
│  │  1. Sends BLE shake + {action: 'getSettings'}            │   │
│  │  2. Receives {result: {settings: {...}}} via BLE         │   │
│  │  3. Writes rat_scout_settings.json to hmFS               │   │
│  │  4. Attempts cross-app write to ../1000089/              │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                      hmFS file                                  │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Watchface  (../watchface/index.js — appId 1000089)      │   │
│  │  Reads settings file on init → sends to own Side Service │   │
│  │  → Side Service uses settings for Dexcom/weather/astro   │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. User opens **Zepp App → Profile → [watch] → App List → Rat Scout Settings → ⚙️**
2. Configures Dexcom, weather, astronomy, garbage schedule
3. Settings saved to companion app's `settingsStorage`
4. User opens the **Rat Scout Settings** app on the watch
5. App sends BLE shake + `{ action: 'getSettings' }` to Side Service
6. Side Service reads `settingsStorage`, normalises values (unwraps JSON encoding)
7. Responds with `{ settings: {...} }` (wrapped as `{ result: { settings: {...} } }` by ZML)
8. Page writes `rat_scout_settings.json` to hmFS (own dir + cross-app `../1000089/`)
9. User returns to the **Rat Scout** watchface
10. Watchface reads settings file on init, includes in `fetchAll` BLE request to own Side Service
11. Side Service uses values as `_overrideSettings` for all API calls

## Project Structure

```
companion_app/
├── app.json             App manifest (appId: 1000090, appType: "app")
├── app.js               Minimal App({}) entry (API 1.0 globals)
├── package.json         NPM deps: @zeppos/zml ^0.0.9
├── page/
│   └── index.js         Watch-side page (~314 lines, API 1.0 globals)
│                         Manual hmBle binary framing + hmFS file write
├── app-side/
│   └── index.js         Phone-side service (~103 lines)
│                         Uses @zeppos/zml BaseSideService + settingsLib
│                         AppSideService is a GLOBAL (not imported)
├── setting/
│   └── index.js         Settings App UI (~228 lines)
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
| `dexcom_region` | Select | `ous` (Outside US) or `us` | `ous` |
| `bg_units` | Select | `mgdl` or `mmol` | `mgdl` |
| `owm_api_key` | TextInput | OpenWeatherMap API key | `abc123def456` |
| `weather_units` | Select | `metric` or `imperial` | `metric` |
| `ipgeo_api_key` | TextInput | ipgeolocation.io API key | `xyz789` |
| `garbage_hour` | TextInput | Hour after which next-day bag shows | `9` |
| `garbage_organic` | TextInput | CSV of Mon-based day numbers | `0,2,4` |
| `garbage_grey` | TextInput | CSV of Mon-based day numbers | `3` |
| `garbage_black` | TextInput | CSV of Mon-based day numbers | `1,5` |

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
The companion app writes `rat_scout_settings.json` to **two** locations:
1. Its own data directory (always succeeds)
2. `../1000089/rat_scout_settings.json` — the watchface's data directory (may
   succeed depending on firmware sandbox policy)

The watchface tries to read from:
1. Its own data directory (succeeds if cross-app write worked)
2. `../1000090/rat_scout_settings.json` — the companion's directory (fallback)

### Settings Normalisation
The companion Side Service normalises `settingsStorage` values before sending:

| UI Component | Raw storage format | Normalised output |
|---|---|---|
| TextInput | JSON-quoted: `"\"hello\""` | `"hello"` |
| Select | JSON object: `"{"name":"OUS","value":"ous"}"` | `"ous"` |
| Plain text (garbage CSVs) | `"0,2,4"` | `"0,2,4"` |

The watchface's Side Service receives clean key-value pairs and uses them
directly via `_overrideSettings`, falling back to its own (empty) settingsStorage.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Settings page not visible in Zepp App | Make sure you installed the **companion app** (appId 1000090), not just the watchface. Look in Profile → [watch] → App List. |
| "Connecting to phone..." stays forever | Ensure phone is paired, BLE is active, and the Zepp App is open in foreground. |
| "No settings configured yet" | You haven't configured settings yet. Follow the steps in "Configure settings on your phone" above. |
| Watchface shows no data after sync | The watchface reads settings on init. Try switching away from and back to the watchface to trigger a reload. |
| Settings lost after watch reboot | Settings file persists in hmFS across reboots. If lost, just re-open the companion app to re-sync. |
| Side Service crash in bridge logs | Check for `TypeError ... onInit` — likely an import issue. The Side Service must use `@zeppos/zml` pattern, not raw `@zos/app-side/settings` imports. |
