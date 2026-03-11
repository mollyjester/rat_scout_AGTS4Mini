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
│  └──────────────────┘                         │ index.js     │ │
│                                                └──────┬───────┘ │
│                                                       │ BLE     │
├───────────────────────────────────────────────────────┼─────────┤
│ WATCH                                                 │         │
│                                                       ▼         │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Device App Page  (page/index.js)                        │   │
│  │  1. Requests settings via BLE                            │   │
│  │  2. Writes rat_scout_settings.json to hmFS               │   │
│  └──────────────────────────────────────────────────────────┘   │
│                            │                                    │
│                      hmFS file                                  │
│                            ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Watchface  (watchface/index.js)                         │   │
│  │  Reads settings file on init → sends to Side Service     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Data flow:**
1. User opens **Zepp App → Profile → [watch] → App List → Rat Scout Settings → Settings gear**
2. Configures Dexcom, weather, astronomy, garbage schedule
3. Settings saved to companion app's `settingsStorage`
4. User opens the **Rat Scout Settings** app on the watch
5. App connects via BLE, requests settings from Side Service
6. Side Service normalises values (unwraps JSON encoding from UI components)
7. Settings JSON written to watch filesystem (`rat_scout_settings.json`)
8. Cross-app write attempted to watchface's data directory
9. User returns to the **Rat Scout** watchface
10. Watchface reads settings file from hmFS on init
11. Watchface includes settings in BLE `fetchAll` request to its own Side Service
12. Side Service uses the override settings for all API calls

## Project Structure

```
companion_app/
├── app.json            App manifest (appId: 1000090, appType: "app")
├── app.js              Minimal App({}) entry (API 1.0 globals)
├── page/
│   └── index.js        Watch-side page: BLE + hmFS (API 1.0 globals)
├── app-side/
│   └── index.js        Phone-side service: reads settingsStorage, serves via BLE
├── setting/
│   └── index.js        Settings UI: AppSettingsPage with all config sections
└── assets/
    └── gts4mini/
        └── icon.png    App icon (copied from watchface)
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
| `garbage_organic` | Day toggles | CSV of Mon-based day numbers | `0,3` |
| `garbage_grey` | Day toggles | CSV of Mon-based day numbers | `1,4` |
| `garbage_black` | Day toggles | CSV of Mon-based day numbers | `2,5` |

## How to Build & Install

### Prerequisites
- Zeus CLI: `~/.nvm/versions/node/v24.13.1/bin/zeus`
- Zepp App on phone with Developer Mode enabled
- Watch paired and connected

### Build

```bash
cd companion_app
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
   - Tap the **Settings gear icon** next to it
   - Fill in your Dexcom credentials, API keys, and garbage schedule
   
2. **Sync settings to the watch:**
   - On the watch, go to the app list
   - Open **"Rat Scout Settings"**
   - Wait for "Settings saved!" message (takes a few seconds)
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
- `app.js` and `page/index.js` use **API 1.0 globals only** (no `import` statements)
- `app-side/index.js` uses `@zos/*` imports (phone-side, webpack-resolved)
- `setting/index.js` uses `AppSettingsPage` global (Settings App runtime)

### BLE Protocol
The Device App page uses the same MessageBuilder-compatible binary framing as
the watchface. The outer packet format (16-byte header) and inner payload format
(66-byte header + JSON data) are identical.

### Cross-App File Access
The companion app writes `rat_scout_settings.json` to **two** locations:
1. Its own data directory (always succeeds)
2. `../1000089/rat_scout_settings.json` — the watchface's data directory (may
   succeed depending on firmware)

The watchface tries to read from:
1. Its own data directory (succeeds if cross-app write worked)
2. `../1000090/rat_scout_settings.json` — the companion's directory (fallback)

### Settings Normalisation
The companion Side Service normalises settingsStorage values before sending:
- **TextInput** stores JSON-quoted strings (`"\"hello\""`) → unwrapped to `"hello"`
- **Select** stores JSON objects (`"{"name":"US","value":"us"}"`) → extracted to `"us"`
- **Plain strings** (garbage day CSVs) → passed through as-is

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
