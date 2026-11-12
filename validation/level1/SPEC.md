# What the app computes (specification to verify against)

All numbers below were reproduced independently in Python (pandas-free, stdlib only) and match the app to 4 decimals on both example files. Anything you cannot reproduce from this spec is a finding.

## Input
One row per bottle: `time, head, closing point, flow, density, temp, pressure, target, T1, T2, net weight`.
- `% format`: `close_at_pct` = closing point as % of the setpoint. `ms format`: `anticipation_ms` + `dose_time_ms`.
- Rows are in time order. Each net weight is already aligned to the row of the fill that produced it (the PLC does this).
- Empty weight = bottle not weighed (kept as a row, not used for statistics).

## Per head
1. Window = last 1500 rows of the head.
2. **Outlier removal of weights:** `med` = median of weighed bottles; `mad` = median(|w − med|); a weight is removed if `|w − med| > max(6·1.4826·mad, 3·T2)`. Count = `n_outliers_removed`.
3. `n_weighed_after_cleaning` = weighed bottles that survive step 2 (and have all model drivers present).
4. `raw40_*` = mean and **population** standard deviation (divide by N, not N−1) of the last 40 cleaned weights.
5. `raw150_*` = same on the last 150 cleaned weights. With spec limits LSL = target − T1, USL = target + T1:
   - `Cp = (USL − LSL) / (6·sd)`
   - `Cpk = min(USL − mean, mean − LSL) / (3·sd)` (floored at 0, capped at 9.99; Cp capped at 9.99)
   - `ppm_outside_T1 = 1e6 · [Φ(−(T1 − d)/sd) + Φ(−(T1 + d)/sd)]`, `d = mean − target` (normal tails beyond ±T1)
   - `pct_outside_T1` = observed share of the 150 weights with |w − target| > T1.
6. `closing_now` = median of the last 10 applied closing points (% mode) or the last applied value (ms mode).

## What is NOT plain arithmetic (judge these against ground truth, Level 1 / Test B)
- `closing_proposed`, `closing_delta`: learned correction (Lasso picks drivers → Ridge/RLS fit → bounded step: max 0.15 % of setpoint per round in % mode, 5 ms in ms mode; `step_was_clamped=yes` when the bound was hit).
- `replay_now_*`: the last 150 bottles re-expressed at today's closing point using the learned effect of the closing point (so it differs slightly from `raw150_*`).
- `replay_proposed_*`: the same bottles re-expressed at the proposed setting plus the live law for flow, temperature, pressure and density. This is a **model projection**, not a measurement.
- `drivers_selected` / `driver_effects_g`: which factors the model says move the weight and by how many grams across their typical swing.
- Fewer than 40 usable bottles → `data_sufficient=no` and the head falls back to cautious feedback (example head 10 has only 25 rows on purpose).

## How to run the app headless
```
node scripts/run-app.js my_history.csv > my_output.csv      # same columns as expected_output/
```
