/**
 * Rat Scout Settings — Companion App Side Service
 *
 * Runs on the phone inside the Zepp App.
 * Reads settings from settingsStorage (written by the Settings App UI)
 * and serves them to the Device App page via BLE when requested.
 *
 * Uses @zeppos/zml BaseSideService pattern (official Zepp OS sample pattern).
 * AppSideService is a GLOBAL function — NOT imported from @zos/app.
 */

import { BaseSideService } from '@zeppos/zml/base-side'
import { settingsLib }      from '@zeppos/zml/base-side'

// All setting keys that the watchface needs
const SETTINGS_KEYS = [
  'dexcom_username',
  'dexcom_password',
  'dexcom_region',
  'bg_units',
  'owm_api_key',
  'weather_units',
  'ipgeo_api_key',
  'garbage_organic',
  'garbage_grey',
  'garbage_black',
  'garbage_hour',
]

// Fields stored by Select components (value is a JSON-encoded {name, value} object)
const SELECT_FIELDS = new Set(['dexcom_region', 'bg_units', 'weather_units'])

/**
 * Read all settings from settingsLib, normalising the values:
 * - TextInput stores JSON-quoted strings: "\"hello\"" → "hello"
 * - Select stores JSON objects: "{\"name\":\"US\",\"value\":\"us\"}" → "us"
 * - Garbage day CSVs are plain strings: "0,3" → "0,3"
 */
function getAllSettings() {
  const result = {}
  for (const key of SETTINGS_KEYS) {
    try {
      const raw = settingsLib.getItem(key)
      if (raw === null || raw === undefined || raw === '') continue

      try {
        const parsed = JSON.parse(raw)
        if (SELECT_FIELDS.has(key) && typeof parsed === 'object' && parsed !== null) {
          // Select component: extract .value
          result[key] = parsed.value !== undefined ? String(parsed.value) : raw
        } else if (typeof parsed === 'string') {
          // TextInput: unwrap JSON quoting
          result[key] = parsed
        } else if (typeof parsed === 'number') {
          result[key] = String(parsed)
        } else {
          result[key] = raw
        }
      } catch (_e) {
        // Not valid JSON — use raw value as-is
        result[key] = raw
      }
    } catch (_e) {}
  }
  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// AppSideService is a GLOBAL in the worker context — do NOT import it.
// BaseSideService wraps our config and sets up messageBuilder + settings
// listener internally.
// ─────────────────────────────────────────────────────────────────────────────

AppSideService(BaseSideService({
  onInit() {
    console.log('[RatScoutSettings] Side Service initialized')
  },

  onRequest(req, res) {
    try {
      const action = req && req.action

      if (action === 'getSettings') {
        const settings = getAllSettings()
        const count    = Object.keys(settings).length
        console.log('[RatScoutSettings] Sending ' + count + ' settings to watch')
        res(null, { settings })
      } else {
        res(null, { error: 'unknown action: ' + action })
      }
    } catch (e) {
      try { res(null, { error: 'internal: ' + e.message }) } catch (_e2) {}
    }
  },

  onSettingsChange({ key, newValue, oldValue }) {
    console.log('[RatScoutSettings] Setting changed: ' + key)
  },

  onRun() {},

  onDestroy() {},
}))
