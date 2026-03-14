# Rat Scout — Zepp OS Watchface for Amazfit GTS 4 Mini

A reimplementation of the [Pebble Rat Scout watchface](https://github.com/mollyjester/rat_scout) for the **Amazfit GTS 4 Mini** running **Zepp OS**.

---

## What it looks like

```
┌──────────────────────────────────────┐
│ WED      [bag]   ████████ 87%        │  ← Status bar: weekday + bag + battery
│                                      │
│              13:42                   │  ← Large time (HH:MM)
│                                      │
│   142         +4                     │  ← Glucose (mg/dL) + delta
│               3m                     │  ← Minutes since last CGM reading
├──────────────────────────────────────┤
│   21.02       W08                    │  ← Date + ISO week number
├──────────────────────────────────────┤
│ ↑☀  07:14   🌡 -2°                   │  ← Sunrise + Temperature
│ 🌔  22:33   💨 12                    │  ← Moonrise/phase + Wind
│              👟 8.3k                  │  ← Steps
└──────────────────────────────────────┘
```

### Data displayed

| Field | Source |
|-------|--------|
| Time (HH:MM, 24-hour) | `hmSensor` TIME |
| Weekday (MON/TUE…) | `hmSensor` TIME |
| Date (DD.MM) | `hmSensor` TIME |
| ISO week number (W##) | `hmSensor` TIME |
| Battery % + colour bar | `hmSensor` BATTERY |
| Step count | `hmSensor` STEP |
| Glucose reading | Dexcom Share API (via app-side) |
| Glucose delta (±) | Dexcom Share API (via app-side) |
| Minutes since reading | Dexcom Share API (via app-side) |
| Sunrise / sunset | ipgeolocation.io (via app-side) |
| Moonrise / moonset | ipgeolocation.io (via app-side) |
| Moon phase icon | ipgeolocation.io (via app-side) |
| Temperature | OpenWeatherMap (via app-side) |
| Wind speed | OpenWeatherMap (via app-side) |
| Garbage bag icon | Computed from schedule (via app-side) |

---

## Requirements

- **Amazfit GTS 4 Mini** running Zepp OS
- **Zepp app** on your phone (Android or iOS)
- A **Dexcom Share** account (optional — watchface still works without it)
- Optional API keys:
  - [OpenWeatherMap](https://openweathermap.org/api) (free tier is sufficient)
  - [ipgeolocation.io](https://ipgeolocation.io/) (free tier is sufficient)

---

## Project Structure

This project consists of **two Zepp OS packages**:

```
/                              ← Watchface (appId 1000089)
├── app.json
├── app.js
├── package.json               ← @zeppos/zml dependency
├── watchface/index.js         ← Watch UI (API 1.0 globals)
├── app-side/index.js          ← Phone service: data fetching (Dexcom, weather, etc.)
├── setting/index.js           ← (stub — watchfaces can't show settings)
├── assets/gts4mini/images/    ← 16 PNG icons
├── ARCHITECTURE.md            ← Detailed architecture docs
│
└── companion_app/             ← Settings companion (appId 1000090)
    ├── app.json
    ├── app.js
    ├── package.json           ← @zeppos/zml dependency
    ├── page/index.js          ← Watch page: BLE + hmFS
    ├── app-side/index.js      ← Phone service: settings relay only
    ├── setting/index.js       ← Settings UI
    └── assets/gts4mini/icon.png
```

**Why two packages?** The Zepp phone app does not expose a settings page for
`appType: "watchface"`. The companion app (`appType: "app"`) provides the settings
UI, and its Side Service handles all external API calls (Dexcom, weather, astronomy).
The watchface sends `fetchAll` requests via BLE to the companion's Side Service
(appId 1000090), which reads settings directly from `settingsStorage`.

See [ARCHITECTURE.md](ARCHITECTURE.md) for full technical details.

### Data refresh

The watchface refreshes data every 5 minutes using two triggers:

- **`WIDGET_DELEGATE` `resume_call`** — fires on wrist raise / screen-on.
  Primary trigger because `MINUTEEND` does not fire when the screen is off.
- **`MINUTEEND` event** — fires each minute while the screen stays on.

Both check elapsed time before fetching to avoid redundant requests.

---

## Building and Installing

### Prerequisites

```bash
npm install -g @zeppos/zeus-cli
```

### Build the watchface

```bash
cd /path/to/rat_scout_AGTS4Mini
npm install        # first time only — installs @zeppos/zml
zeus build
```

### Build the companion app

```bash
cd companion_app
npm install        # first time only — installs @zeppos/zml
zeus build
```

### Install to device (Bridge mode — recommended)

1. Enable Developer Mode in Zepp phone app (Profile → Settings → About → tap icon 7×)
2. Enable Bridge in Developer Mode settings

```bash
# Install watchface
cd /path/to/rat_scout_AGTS4Mini
zeus bridge
# > connect → install

# Install companion app
cd companion_app
zeus bridge
# > connect → install
```

### Install via Preview QR

```bash
zeus preview
```
Scan the QR code with the Zepp App developer scanner.

### Run in the Zepp OS Simulator

The [Zepp OS Simulator](https://docs.zepp.com/docs/guides/tools/simulator/) is an
Electron app with a QEMU-based device emulator. It allows previewing watchfaces and
apps without a physical device.

#### One-time setup (Linux)

Install the required system libraries:

```bash
cd /opt/simulator/resources/firmware/ && sudo ./setup_for_linux.sh
```

Ensure the simulator directory has the correct permissions:

```bash
sudo chmod -R 777 /opt/simulator
```

#### Launch the simulator

```bash
cd /opt/simulator/ && ./simulator
```

This opens the simulator GUI. Inside it:

1. **Download the Device Simulator** for GTS 4 Mini using the download manager
   (top bar, button 7)
2. **Select the GTS 4 Mini** model from the dropdown (top bar, button 6)
3. **Click the "Device Simulator" open button** (top bar, button 2) to launch
   the QEMU-based watch emulator window

See the [official setup guide](https://docs.zepp.com/docs/guides/tools/simulator/setup/)
for platform-specific instructions (Windows/macOS/Linux).

#### Preview the watchface

With the simulator running and the Device Simulator open, use `zeus dev`:

```bash
cd /path/to/rat_scout_AGTS4Mini
zeus dev
```

`zeus dev` connects to the running simulator, compiles the project, pushes it to
the emulated device, and watches for file changes with auto-refresh.

> **Note:** `zeus dev` is for the simulator. `zeus preview` is for real devices
> (generates a QR code). `zeus bridge` is for sideloading via the Zepp phone app.

#### Simulator limitations

- **BLE is not available** — the companion app's Side Service (Dexcom, weather,
  astronomy) requires a real phone connection. Only locally-computed data (time,
  date, battery, steps, ISO week) will render; glucose, weather, and astronomy
  zones will show loading/default states.
- **Sensor values can be mocked** in the simulator's Sensors panel (battery level,
  step count, etc.).

---

## Configuration

Zepp OS does **not** show settings for watchfaces. Instead, use the **Rat Scout Settings** companion app:

### Initial setup

1. **Install both packages** (watchface + companion app) to your watch
2. **Configure settings on your phone:**
   - Open Zepp App → **Profile → [your watch] → App List**
   - Find **"Rat Scout Settings"** → tap the **⚙️ Settings gear**
   - Fill in your Dexcom credentials, API keys, garbage schedule
3. **Sync settings to the watch:**
   - Open **"Rat Scout Settings"** on the watch (from the app list)
   - Wait for "Settings saved! (N keys)" message
   - Press back to return to the watchface
4. **The watchface now uses your settings.** They persist across reboots.

### Updating settings

After changing any setting in the Zepp App:
1. Open the Rat Scout Settings app on the watch
2. Wait for sync confirmation
3. Return to the watchface (settings are read on every watchface init)

### Settings reference

| Setting | Description |
|---------|-------------|
| `dexcom_username` | Dexcom Share email/phone |
| `dexcom_password` | Dexcom Share password |
| `dexcom_region` | `us` or `ous` (outside US) |
| `bg_units` | `mgdl` or `mmol` |
| `owm_api_key` | OpenWeatherMap API key |
| `weather_units` | `metric` (°C, m/s) or `imperial` (°F, mph) |
| `ipgeo_api_key` | ipgeolocation.io API key |
| `garbage_organic` | Organic bin days — CSV of 0=Mon…6=Sun (e.g. `0,2,4`) |
| `garbage_grey` | Grey bin days |
| `garbage_black` | Black bin days |
| `garbage_hour` | Hour after which tomorrow's bag is shown (default: `9`) |

> **Location** is auto-detected from IP — no manual entry needed.

> **Credentials** are stored on-device only and are never sent anywhere other than the official Dexcom Share server.

---

## Design Notes

### Layout (336 × 384 px)

The layout is scaled from the original 144 × 168 px Pebble screen (~2.33×).
A black AMOLED background is used for power efficiency.

### Glucose colour coding

| Colour | Meaning |
|--------|---------|
| 🟢 Green | In range (70–180 mg/dL) |
| 🟠 Orange | High (> 180 mg/dL) |
| 🔴 Red | Low (< 70 mg/dL) |
| ⬜ Grey | No data / stale |

### Battery bar colour coding

| Colour | Level |
|--------|-------|
| 🟢 Green | > 50% |
| 🟡 Yellow | 20–50% |
| 🔴 Red | < 20% |

### Garbage bag icon

Shows the coloured bag icon (organic/grey/black) for today's or tomorrow's
pickup based on the configured schedule and cutoff hour.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No settings gear visible in Zepp App | Install the **companion app** (not just the watchface). Look in Profile → [watch] → App List for "Rat Scout Settings". |
| Watch app stuck on "Connecting..." | Ensure phone is paired, BLE active, Zepp App in foreground. |
| "No settings configured yet" | Go to Zepp App and configure settings first (see Configuration above). |
| Watchface shows `--` for all data | Open the companion app on watch to sync settings, then reload the watchface. |
| Settings lost after watch reboot | Settings persist in hmFS. If lost, re-open the companion app to re-sync. |

---

## Disclaimer

This is an unofficial, community-maintained project, not affiliated with or endorsed by Dexcom, Inc., Amazfit, or Zepp Health. Always verify glucose readings with an official Dexcom receiver or app before making any medical decisions. This watchface is a convenience tool only.
