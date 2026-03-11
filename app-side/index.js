/**
 * Rat Scout — Watchface App-side Service (stub)
 *
 * The actual data fetching is handled by the companion app's side service
 * (appId 1000090). The watchface sends its BLE shake with the companion's
 * appId, so this file is never loaded at runtime.
 *
 * It's kept as a minimal stub so that `zeus build` doesn't break —
 * app.json still declares an app-side module.
 */

AppSideService({
  onInit() {},
  onRun() {},
  onDestroy() {},
})
