/**
 * Rat Scout Settings — Settings App UI (runs inside Zepp phone app)
 *
 * Mirrors the Pebble Clay config from mollyjester/rat_scout.
 * This is the companion app's settings page — accessible via
 * Zepp App → Profile → [watch] → App List → Rat Scout Settings → Settings
 *
 * Sections:
 *   1. Dexcom Account — login, password, region
 *   2. Blood Glucose  — units
 *   3. Weather        — OWM API key, units
 *   4. Astronomy      — ipgeolocation.io API key
 *   5. Garbage Collection — pickup hour, day checkboxes per bag type
 */

AppSettingsPage({
  state: {},

  build(props) {
    // ── Helpers ────────────────────────────────────────────────────────────
    var storage = props.settingsStorage

    function get(key) {
      try {
        var v = storage.getItem(key)
        return v !== null && v !== undefined ? v : ''
      } catch (e) {
        return ''
      }
    }

    function set(key, value) {
      try { storage.setItem(key, value) } catch (e) {}
    }

    // Unwrap a value from settingsStorage (TextInput stores JSON-quoted strings)
    function getPlain(key) {
      var raw = get(key)
      if (!raw) return ''
      try {
        var parsed = JSON.parse(raw)
        if (typeof parsed === 'string') return parsed
        if (typeof parsed === 'number') return String(parsed)
        return raw
      } catch (e) {
        return raw
      }
    }

    // Unwrap a Select value from storage (stored as JSON {name, value} object)
    function getSelectValue(key) {
      var raw = get(key)
      if (!raw) return undefined
      try {
        var parsed = JSON.parse(raw)
        if (typeof parsed === 'object' && parsed !== null && parsed.value !== undefined) {
          return parsed.value
        }
        return raw
      } catch (e) {
        return raw
      }
    }

    // Helper: parse garbage day CSV into boolean array [Mon..Sun]
    function parseDaysCsv(csv) {
      var flags = [false, false, false, false, false, false, false]
      if (!csv) return flags
      csv.split(',').forEach(function (s) {
        var n = parseInt(s.trim(), 10)
        if (n >= 0 && n <= 6) flags[n] = true
      })
      return flags
    }

    // Helper: convert boolean array [Mon..Sun] to CSV of day numbers
    function daysToCsv(flags) {
      var nums = []
      for (var i = 0; i < flags.length; i++) {
        if (flags[i]) nums.push(String(i))
      }
      return nums.join(',')
    }

    var checkboxRowStyle = {
      display: 'inline-block',
      marginRight: '6px',
      marginBottom: '4px',
      padding: '6px 10px',
      borderRadius: '4px',
      fontSize: '0.85rem',
      cursor: 'pointer',
    }

    var DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    // ── Day checkbox builder ──────────────────────────────────────────────
    function buildDayToggles(settingsKey, label) {
      var current = parseDaysCsv(get(settingsKey))

      var dayViews = DAY_LABELS.map(function (dayName, idx) {
        var isOn = current[idx]
        return View(
          {
            style: Object.assign({}, checkboxRowStyle, {
              backgroundColor: isOn ? '#FF8C00' : '#333',
              color: isOn ? '#000' : '#aaa',
            }),
            onClick: function () {
              var updated = parseDaysCsv(get(settingsKey))
              updated[idx] = !updated[idx]
              set(settingsKey, daysToCsv(updated))
            },
          },
          [Text({}, dayName)]
        )
      })

      return View({ style: { marginBottom: '10px' } }, [
        Text({ style: { display: 'block', fontSize: '0.9rem', color: '#ccc', marginBottom: '4px' } }, label),
        View({ style: { display: 'flex', flexWrap: 'wrap' } }, dayViews),
      ])
    }

    // ════════════════════════════════════════════════════════════════════════
    // Main layout — uses Section for form groupings (required for TextInput
    // and Select to render interactively in the Zepp Settings webview)
    // ════════════════════════════════════════════════════════════════════════

    return View({}, [
      // ── Header ──────────────────────────────────────────────────────────
      Section({
        title: 'Rat Scout Settings',
        description: 'Configure your watchface. After saving, open the ' +
          'Rat Scout Settings app on the watch to sync.',
      }, []),

      // ── 1. Dexcom Account ───────────────────────────────────────────────
      Section({ title: 'Dexcom Account' }, [
        TextInput({
          label: 'Login (email or username)',
          settingsKey: 'dexcom_username',
          placeholder: 'Dexcom Share login',
        }),
        TextInput({
          label: 'Password',
          settingsKey: 'dexcom_password',
          placeholder: 'Dexcom Share password',
        }),
        Select({
          label: 'Region',
          options: [
            { name: 'Outside US', value: 'ous' },
            { name: 'US', value: 'us' },
          ],
          value: getSelectValue('dexcom_region'),
          onChange: function (val) {
            set('dexcom_region', JSON.stringify(val))
          },
        }),
      ]),

      // ── 2. Blood Glucose ────────────────────────────────────────────────
      Section({ title: 'Blood Glucose' }, [
        Select({
          label: 'Units',
          options: [
            { name: 'mg/dL', value: 'mgdl' },
            { name: 'mmol/L', value: 'mmol' },
          ],
          value: getSelectValue('bg_units'),
          onChange: function (val) {
            set('bg_units', JSON.stringify(val))
          },
        }),
      ]),

      // ── 3. Weather ──────────────────────────────────────────────────────
      Section({
        title: 'Weather',
        description: 'Enter your OpenWeatherMap API key to display temperature ' +
          'and wind. Get a free key at openweathermap.org/api',
      }, [
        TextInput({
          label: 'OpenWeatherMap API Key',
          settingsKey: 'owm_api_key',
          placeholder: 'Your OWM API key',
        }),
        Select({
          label: 'Units',
          options: [
            { name: 'Metric (°C, m/s)', value: 'metric' },
            { name: 'Imperial (°F, mph)', value: 'imperial' },
          ],
          value: getSelectValue('weather_units'),
          onChange: function (val) {
            set('weather_units', JSON.stringify(val))
          },
        }),
      ]),

      // ── 4. Astronomy ───────────────────────────────────────────────────
      Section({
        title: 'Astronomy',
        description: 'Enter your ipgeolocation.io API key to display sunrise/' +
          'sunset and moonrise/moonset. Get a free key at ipgeolocation.io',
      }, [
        TextInput({
          label: 'ipgeolocation.io API Key',
          settingsKey: 'ipgeo_api_key',
          placeholder: 'Your ipgeolocation API key',
        }),
      ]),

      // ── 5. Garbage Collection ───────────────────────────────────────────
      Section({ title: 'Garbage Collection' }, [
        TextInput({
          label: 'Pickup Hour (0-23, bags roll over after this hour)',
          settingsKey: 'garbage_hour',
          placeholder: '9',
        }),
        buildDayToggles('garbage_organic', 'Organic (green bag) days'),
        buildDayToggles('garbage_grey', 'Grey bag days'),
        buildDayToggles('garbage_black', 'Black bag days'),
      ]),
    ])
  },
})
