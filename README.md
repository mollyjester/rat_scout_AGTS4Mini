# Rat Scout — Zepp OS Watchface for Amazfit GTS 4 Mini

A reimplementation of the [Pebble Rat Scout watchface](https://github.com/mollyjester/rat_scout) for the **Amazfit GTS 4 Mini** running **Zepp OS**.

---

## What it looks like

```
┌──────────────────────────────────────┐
│ WED            ████████ 87%          │  ← Status bar: weekday + battery
│                                      │
│              13:42                   │  ← Large time (HH:MM)
│                                      │
│   142         +4                     │  ← Glucose (mg/dL) + delta
│               3m                     │  ← Minutes since last CGM reading
├──────────────────────────────────────┤
│   21.02       W08                    │  ← Date + ISO week number
├──────────────────────────────────────┤
│ ↑☀  07:14   🌡 -2°                   │  ← Sunrise + Temperature
│ 🌔  22:33   👟 8.3k                  │  ← Moonrise/phase + Steps
└──────────────────────────────────────┘
```

### Data displayed

| Field | Source |
|-------|--------|
| Time (HH:MM, 24-hour) | `@zos/sensor` `Time` |
| Weekday (MON/TUE…) | `@zos/sensor` `Time` |
| Date (DD.MM) | `@zos/sensor` `Time` |
| ISO week number (W##) | `@zos/sensor` `Time` |
| Battery % + colour bar | `@zos/sensor` `Battery` |
| Step count | `@zos/sensor` `Pedometer` |
| Glucose reading | Dexcom Share API (via app-side) |
| Glucose delta (±) | Dexcom Share API (via app-side) |
| Minutes since reading | Dexcom Share API (via app-side) |
| Sunrise / sunset | ipgeolocation.io (via app-side) |
| Moonrise / moonset | ipgeolocation.io (via app-side) |
| Moon phase icon | ipgeolocation.io (via app-side) |
| Temperature | OpenWeatherMap (via app-side) |

---

## Requirements

- **Amazfit GTS 4 Mini** running Zepp OS 2.x or later
- **Zepp app** on your phone (Android or iOS)
- A **Dexcom Share** account (optional — watchface still works without it)
- Optional API keys:
  - [OpenWeatherMap](https://openweathermap.org/api) (free tier is sufficient)
  - [ipgeolocation.io](https://ipgeolocation.io/) (free tier is sufficient)

---

## Building and Installing

### Prerequisites

```bash
npm install -g @zeppos/zeus-cli
```

### Build

```bash
zeus build
```

### Install to device

Make sure your device is connected via Bluetooth to the Zepp app, then:

```bash
zeus preview
```

Or transfer the `.zab` package produced in `dist/` to the device through the Zepp app developer mode.

---

## Configuration

Open the **Zepp app** → find Rat Scout under watchfaces → tap the settings icon.

### Dexcom (CGM glucose data)

| Setting | Description |
|---------|-------------|
| `dexcom_username` | Your Dexcom Share email/username |
| `dexcom_password` | Your Dexcom Share password |
| `dexcom_region` | `us` (default), `ous` (outside US), `jp` (Japan) |
| `bg_units` | `mgdl` (default) or `mmol` |

> **Note:** Credentials are stored on-device only and are never sent anywhere other than the official Dexcom Share server.

### Weather

| Setting | Description |
|---------|-------------|
| `owm_api_key` | OpenWeatherMap API key |
| `weather_units` | `metric` (°C, m/s) or `imperial` (°F, mph) |

### Astronomy

| Setting | Description |
|---------|-------------|
| `ipgeo_api_key` | ipgeolocation.io API key |

### Location

| Setting | Description |
|---------|-------------|
| `latitude` | Your latitude (e.g. `52.52`) |
| `longitude` | Your longitude (e.g. `13.40`) |

Weather and astronomy features require a location. If not set, those fields will show `--`.

---

## Project Structure

```
/
├── app.json              ← App manifest (GTS 4 Mini target, permissions)
├── watchface/
│   └── index.js          ← Watchface UI and sensor logic
├── app-side/
│   └── index.js          ← Phone-side service (API calls + messaging)
├── assets/
│   └── images/           ← Icon assets
└── README.md
```

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
| ⬜ Grey | No data |

### Battery bar colour coding

| Colour | Level |
|--------|-------|
| 🟢 Green | > 50% |
| 🟡 Yellow | 20–50% |
| 🔴 Red | < 20% |

---

## Disclaimer

This is an unofficial, community-maintained project, not affiliated with or endorsed by Dexcom, Inc., Amazfit, or Zepp Health. Always verify glucose readings with an official Dexcom receiver or app before making any medical decisions. This watchface is a convenience tool only.
