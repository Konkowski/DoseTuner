# Changelog

## 1.0.0 – 2026-11-12
- First public release as **DoseTuner**.
- Closing point expressed as a percentage of the setpoint, with a live law that follows flow, pressure, temperature and density. Milliseconds still supported for old files (auto-detected).
- Per-head Ridge/Lasso/RLS learning on a physics prior, safety layer, drift detection, fallback to feedback.
- Now-vs-proposed replay, Cp/Cpk/ppm, giveaway, candlestick and line charts, draggable tolerance histogram.
- Offline-capable PWA, single-file build, 57 numerical checks plus UI and PWA tests.
