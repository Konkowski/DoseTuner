# How DoseTuner decides

All maths is in `src/core.js` (`DoseCore`), UMD, no dependencies. Heads are analysed independently.

## 1. Model
The weight error of a bottle is modelled as
`error = offset + Σ βᵢ · xᵢ + noise`, with drivers `xᵢ` = density, flow, temperature, pressure (and the closing point itself).
Internally the closing point is the **shortfall** `a = 100 − closing point (%)`; the weight gained per unit of `a` is `target / (100·K₀)` in % mode (ρ·Q in ms mode). This is the **physics prior**.

## 2. Learning
1. **Lasso** picks which drivers matter for this head (sparse support).
2. **Ridge** fits their coefficients on that support (stable under collinearity).
3. **Recursive least squares** with forgetting (λ = 0.995) tracks slow change.
4. **Drift detection** compares recent residuals with the long window and widens uncertainty or holds when they diverge.

## 3. Proposal
- **Base**: moves the mean towards the target (plus optional aim offset), by a bounded step per round (default 0.15 % of setpoint).
- **Live law**: adds a term per significant driver so the closing point follows flow, pressure, temperature and density (bounded, default ±0.6 %).
- Values are rounded to 0.01 %.

## 4. Safety layer
- **Data sufficiency (PAC-style)**: enough bottles for the required accuracy, otherwise the head is flagged and gets cautious feedback only.
- **Bounded steps** and absolute min/max for the closing point.
- **Dead band**: no change when the expected gain is tiny.
- **Fallback to feedback** (proportional on recent mean error) when the model is not trusted.
- The PLC keeps authority; a human enters the values.

## 5. What you see
- **Replay / counterfactual** of the last 150 bottles: *before*, *after* (proposed), *after with fixed closing point*, *goal*.
- **Capability**: Cp, Cpk, ppm outside T1/T2, giveaway.
- **Variance decomposition**: offset², conditions, noise, so you see what the algorithm can and cannot remove.
- **Explanation**: each factor with sign and size, in plain language.

## Assumptions and limits
See README → *Honest limits*. In short: validated on a simulator; collinear drivers make attribution approximate; assumes the valve closes as a fraction of the commanded dose.

## Changing the algorithm
Add a check to `test/test.js` (the simulator `Plant` provides paired experiments) and report before/after Cpk in your PR.
