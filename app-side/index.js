/**
 * Rat Scout — Watchface Side Service (stub)
 *
 * The Zepp phone framework does NOT register side services for
 * appType "watchface" packages, so this file never actually runs.
 * All data fetching is handled by the companion app's side service
 * (appId 1000090) instead.
 *
 * This file exists because app.json declares a side service entry.
 */

import { BaseSideService } from '@zeppos/zml/base-side'

AppSideService(BaseSideService({
  onInit() {},
  onRun() {},
  onDestroy() {},
}))
