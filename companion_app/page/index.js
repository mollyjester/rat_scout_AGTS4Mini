/**
 * Rat Scout Settings — Device App Page (runs on the watch)
 *
 * API 1.0 globals only (no imports).
 * Globals: hmUI, Page
 *
 * This page is a stub. The watchface fetches all data (including
 * settings-driven API results) directly from the companion Side
 * Service via BLE. There is no need to transfer settings files.
 */

var W = 336
var H = 384

Page({
  build() {
    hmUI.createWidget(hmUI.widget.FILL_RECT, {
      x: 0, y: 0, w: W, h: H, color: 0x000000,
    })

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 8, y: 24, w: W - 16, h: 48,
      color: 0xFF8C00,
      text_size: 28,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Rat Scout Settings',
    })

    hmUI.createWidget(hmUI.widget.TEXT, {
      x: 16, y: 100, w: W - 32, h: 180,
      color: 0x888888,
      text_size: 20,
      align_h: hmUI.align.CENTER_H,
      align_v: hmUI.align.CENTER_V,
      text: 'Settings are managed in the\n'
          + 'Zepp phone app.\n\n'
          + 'No action needed here.\n'
          + 'You can go back.',
    })
  },

  onDestroy() {},
})
