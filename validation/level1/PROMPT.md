# Prompt for the independent verifier (Level 1)

Paste everything between the lines into a fresh chat that can run code (Python and, ideally, Node.js), and attach the zip `DoseTuner-validation-level1.zip`.

---

You are an independent verifier of an open-source tool called DoseTuner (self-calibrating closing-point recommendations for a multi-head filling machine). You did not write it. Your job is to try to prove it wrong. Be sceptical, quantitative and concise. Do not fix the tool; report evidence.

The zip contains: `validation/SPEC.md` (what the tool is supposed to compute), `input/` (two example PLC histories, % and ms formats, simulated), `expected_output/` (what the tool outputs for them, one row per head), `src/core.js` (the tool's algorithm) and `scripts/run-app.js` (runs it headless: `node scripts/run-app.js file.csv > out.csv`).

Work in four tests. Show tables, not essays.

**TEST A – arithmetic (no trust in the tool).**
Using only pandas/numpy and the rules in SPEC.md, recompute for every head of both input files: n_outliers_removed, n_weighed_after_cleaning, raw40_mean/sd, raw150_mean/sd/Cp/Cpk/ppm/pct_outside_T1. Compare with `expected_output/`. Tolerances: means and sd 0.0005 g, Cp/Cpk 0.005, ppm 0.2 % relative. Report every mismatch. Also check that the SPEC rules are statistically sensible (e.g. population vs sample sd, normal-tail ppm for a non-normal sample) and say which choices you would change.

**TEST B – blind recovery with hidden ground truth.**
Write YOUR OWN synthetic generator (not the one in core.js). Plant model per head h and bottle i:
`weight_error = offset_h + b_flow·(flow − flow_ref) + b_press·(pressure − p_ref) + b_temp·(temp − t_ref) + b_rho·(rho − rho_ref) + g·(closing_point − c_ref) + noise`
with realistic 10-head, ~250 bottles/head, target 250 g, T1 = 4 g, T2 = 8 g, flow ~60 ml/s, pressure ~1.2 bar, temp ~23 °C, density ~1.05, slow random walks in the conditions, noise sd ≈ 0.5 g. Pick signs and sizes yourself and keep them secret in `answer_key.json` (true optimal base closing point per head = the value that zeroes the expected error at reference conditions, true driver effects). Write the CSVs in the app's % format with header:
`time,head,close_at_pct,flow_ml_s,density_g_ml,temp_C,pressure_bar,target_g,T1_g,T2_g,net_weight_g`
Generate these 8 scenarios (a CSV each): (1) null: no condition effects, offset 0; (2) offset only; (3) flow-dependent; (4) flow and pressure strongly collinear (corr > 0.9); (5) slow drift in offset; (6) only 30 bottles/head; (7) dirty data: NaN cells, 1 % gross outliers, ';' separator and ',' decimal; (8) scenario 3 re-exported in ms format (anticipation_ms = (100 − close%) · dose_time_ms / 100, dose_time_ms = target / (rho·flow) · 1000).
Run each through `node scripts/run-app.js` and fill a table: scenario | head | true optimum | closing_proposed | error | drivers_selected vs true drivers | pass/fail.
Pass criteria: |closing_proposed − true optimum| < 0.05 % of setpoint when ≥ 200 bottles/head (note the tool moves at most 0.15 % per round, so also report whether the *direction* is right and how many rounds it would need); (1) proposes ≈ 0 change and selects no or negligible drivers; (6) reports data_sufficient=no and does not make an aggressive change; (7) does not crash and reports outliers; (8) agrees with (3) within normal noise; (4) predicts weight well even if the split between collinear drivers is ambiguous.

**TEST C – closed-loop check on your plant.**
Extend your generator into a small plant simulator that accepts a closing point per head and returns weights. For each of scenarios 2, 3, 5: run 4 rounds of "generate 250 bottles/head → run the tool → apply `closing_proposed` → repeat". Report per round: mean error, sd, Cpk and % outside T1, per head and overall. Pass: Cpk improves or holds within 5 % for ≥ 90 % of heads, never moves more than 0.15 % per round, and does not oscillate (sign of the step does not flip two rounds in a row once |error| < 0.3 g). Compare against a naive baseline: "subtract the mean error each round, no model". State clearly when the naive baseline is as good or better.

**TEST D – replicate and break.**
(1) Run the same CSV twice, and once with the heads' rows interleaved differently (same per-head time order) — results must be identical. (2) Multiply all weights, targets and T1/T2 by 1000 (g → mg) and check scale invariance of closing_proposed. (3) Add one head with a constant closing point and no variation. (4) Remove temperature and pressure columns. (5) Give a file with two heads swapped in numbering. Report any crash, NaN, nonsensical output, or silent wrong answer.

**Final report (max 1 page):**
1. A verdict per test: PASS / FAIL / INCONCLUSIVE with the numbers that decide it.
2. The 3 most serious problems found, each with a minimal reproducing CSV and the exact command.
3. Any place where the tool's *explanation* (drivers, signs, grams) contradicts your ground truth.
4. What you could not test and why.
Do not soften findings. Do not assume the tool is right because its own tests pass.

---
