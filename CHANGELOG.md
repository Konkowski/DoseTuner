# Changelog

## 1.1.0 – 2026-11-12
- New: physical machine view (tank, valves, bottles per head) on Result and Heads.
- New: per-head “What the valve does” – bottle and closing-point bar, now vs proposed.
- New: “Anatomy of the fit” – Y = β₀ + β·(X − X̄) + ε with highlight chips, real bottles and a movable line.
- New: “What changes to get a better result” – Now → Fix the base → Follow the conditions → After more rounds, for the fleet and per head.
- Existing charts unchanged.

## 1.0.0 – 2026-11-12
- First public release as **DoseTuner**.
- Closing point expressed as a percentage of the setpoint, with a live law that follows flow, pressure, temperature and density. Milliseconds still supported for old files (auto-detected).
- Per-head Ridge/Lasso/RLS learning on a physics prior, safety layer, drift detection, fallback to feedback.
- Now-vs-proposed replay, Cp/Cpk/ppm, giveaway, candlestick and line charts, draggable tolerance histogram.
- Offline-capable PWA, single-file build, 57 numerical checks plus UI and PWA tests.
