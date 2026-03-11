/**
 * Rat Scout — Settings App (runs inside Zepp phone app)
 *
 * Mirrors the Pebble Clay config from mollyjester/rat_scout:
 *   src/pkjs/config.json
 *
 * Sections (matching rat_scout order):
 *   1. Dexcom Account — login, password, region
 *   2. Blood Glucose  — units
 *   3. Weather        — OWM API key, units
 *   4. Astronomy      — ipgeolocation.io API key
 *   5. Location       — auto-detected via IP; manual override available
 *   6. Garbage Collection — pickup hour, day checkboxes per bag type
 */

AppSettingsPage({
  state: {
    locationStatus: '',
  },

  build(props) {
    // ── Helpers ────────────────────────────────────────────────────────────
    const storage = props.settingsStorage

    function get(key) {
      try {
        const v = storage.getItem(key)
        return v !== null && v !== undefined ? v : ''
      } catch (e) {
        return ''
      }
    }

    function set(key, value) {
      try { storage.setItem(key, value) } catch (e) {}
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

    // ── Inline styles ─────────────────────────────────────────────────────
    var sectionStyle = {
      marginBottom: '16px',
      borderBottom: '1px solid #333',
      paddingBottom: '12px',
    }

    var headingStyle = {
      fontSize: '1.2rem',
      color: '#FF8C00',
      marginBottom: '8px',
    }

    var descStyle = {
      fontSize: '0.85rem',
      color: '#888',
      marginBottom: '12px',
    }

    var fieldStyle = {
      marginBottom: '10px',
    }

    var labelStyle = {
      display: 'block',
      fontSize: '0.9rem',
      color: '#ccc',
      marginBottom: '4px',
    }

    var inputStyle = {
      display: 'block',
      width: '100%',
      padding: '8px',
      fontSize: '1rem',
      borderRadius: '6px',
      border: '1px solid #555',
      backgroundColor: '#1a1a1a',
      color: '#fff',
    }

    var selectStyle = {
      display: 'block',
      width: '100%',
      padding: '8px',
      fontSize: '1rem',
      borderRadius: '6px',
      border: '1px solid #555',
      backgroundColor: '#1a1a1a',
      color: '#fff',
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
    // Uses View + Text with onClick to toggle days, storing as CSV
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

      return View({ style: fieldStyle }, [
        Text({ style: labelStyle }, label),
        View({ style: { display: 'flex', flexWrap: 'wrap' } }, dayViews),
      ])
    }

    // ════════════════════════════════════════════════════════════════════════
    // Main layout — mirrors rat_scout config.json section order
    // ════════════════════════════════════════════════════════════════════════

    return View({}, [
      // ── Header ──────────────────────────────────────────────────────────
      Text(
        { style: { fontSize: '1.5rem', color: '#fff', textAlign: 'center', margin: '12px 0' } },
        'Rat Scout Settings'
      ),
      Text(
        { style: Object.assign({}, descStyle, { textAlign: 'center' }) },
        'Configure your Dexcom account, weather, astronomy and garbage schedule.'
      ),

      // ── 1. Dexcom Account ───────────────────────────────────────────────
      View({ style: sectionStyle }, [
        Text({ style: headingStyle }, 'Dexcom Account'),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Login (email or username)'),
          TextInput({
            settingsKey: 'dexcom_username',
            placeholder: 'Dexcom Share login',
          }),
        ]),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Password'),
          TextInput({
            settingsKey: 'dexcom_password',
            subStyle: { color: '#fff' },
            placeholder: 'Dexcom Share password',
          }),
        ]),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Region'),
          Select({
            settingsKey: 'dexcom_region',
            options: [
              { name: 'Outside US', value: 'ous' },
              { name: 'US', value: 'us' },
            ],
          }),
        ]),
      ]),

      // ── 2. Blood Glucose ────────────────────────────────────────────────
      View({ style: sectionStyle }, [
        Text({ style: headingStyle }, 'Blood Glucose'),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Units'),
          Select({
            settingsKey: 'bg_units',
            options: [
              { name: 'mg/dL', value: 'mgdl' },
              { name: 'mmol/L', value: 'mmol' },
            ],
          }),
        ]),
      ]),

      // ── 3. Weather ──────────────────────────────────────────────────────
      View({ style: sectionStyle }, [
        Text({ style: headingStyle }, 'Weather'),
        Text({ style: descStyle },
          'Enter your OpenWeatherMap API key to display temperature and wind. ' +
          'Get a free key at openweathermap.org/api'
        ),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'OpenWeatherMap API Key'),
          TextInput({
            settingsKey: 'owm_api_key',
            placeholder: 'Your OWM API key',
          }),
        ]),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Units'),
          Select({
            settingsKey: 'weather_units',
            options: [
              { name: 'Metric (°C, m/s)', value: 'metric' },
              { name: 'Imperial (°F, mph)', value: 'imperial' },
            ],
          }),
        ]),
      ]),

      // ── 4. Astronomy ───────────────────────────────────────────────────
      View({ style: sectionStyle }, [
        Text({ style: headingStyle }, 'Astronomy'),
        Text({ style: descStyle },
          'Enter your ipgeolocation.io API key to display sunrise/sunset and ' +
          'moonrise/moonset. Get a free key at ipgeolocation.io'
        ),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'ipgeolocation.io API Key'),
          TextInput({
            settingsKey: 'ipgeo_api_key',
            placeholder: 'Your ipgeolocation API key',
          }),
        ]),
      ]),

      // ── 5. Garbage Collection ───────────────────────────────────────────
      View({ style: sectionStyle }, [
        Text({ style: headingStyle }, 'Garbage Collection'),
        View({ style: fieldStyle }, [
          Text({ style: labelStyle }, 'Pickup Hour (0-23, bags roll over after this hour)'),
          TextInput({
            settingsKey: 'garbage_hour',
            placeholder: '9',
          }),
        ]),
        buildDayToggles('garbage_organic', 'Organic (green bag) days'),
        buildDayToggles('garbage_grey', 'Grey bag days'),
        buildDayToggles('garbage_black', 'Black bag days'),
      ]),
    ])
  },
})
