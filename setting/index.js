/**
 * Rat Scout — Settings App (stub)
 *
 * The Zepp phone app does NOT expose a settings page for appType "watchface".
 * This file is a required stub (declared in app.json) but is never rendered.
 *
 * All settings are managed by the companion app (appId 1000090):
 *   companion_app/setting/index.js — Settings UI
 *   companion_app/app-side/index.js — Settings relay
 */

AppSettingsPage({
  build(props) {
    return View({}, [
      Text(
        { style: { color: '#888', textAlign: 'center', margin: '24px 0' } },
        'Settings are managed by the Rat Scout Settings companion app.'
      ),
    ])
  },
})
