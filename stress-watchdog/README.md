# Electron Stress Watchdog

This module is separate from `electron-demo/watchdog`.

- `watchdog/` keeps the existing business recovery behavior.
- `stress-watchdog/` records stress-test-specific events and renderer heartbeats.

It does not own `WebContentsView` lifecycle and does not trigger renderer recovery.
