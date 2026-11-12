// Runs the DoseTuner analysis on ONE csv file, headless, and returns/prints one row per head.
// Usage: node scripts/run-app.js my_history.csv > output.csv
const fs = require('fs'), path = require('path'), C = require('../src/core.js');
const r = (v, d) => (v == null || !isFinite(v)) ? '' : (+v).toFixed(d);
const COLS = ['head', 'unit', 'status', 'mode', 'action', 'n_rows_head', 'n_weighed_after_cleaning', 'n_outliers_removed',
  'target_g', 'T1_g', 'T2_g',
  'raw40_mean_g', 'raw40_sd_g',
  'raw150_mean_g', 'raw150_sd_g', 'raw150_Cp', 'raw150_Cpk', 'raw150_ppm_outside_T1', 'raw150_pct_outside_T1',
  'closing_now', 'closing_proposed', 'closing_delta', 'step_was_clamped',
  'replay_now_mean_g', 'replay_now_sd_g', 'replay_now_Cpk',
  'replay_proposed_mean_g', 'replay_proposed_sd_g', 'replay_proposed_Cp', 'replay_proposed_Cpk', 'replay_proposed_ppm_outside_T1',
  'drivers_selected', 'driver_effects_g', 'data_sufficient', 'drift_flag'];

function runCsv(text) {
  const p = C.parseCSV(text), map = C.guessMapping(p.header);
  const b = C.buildRecords(p, map, { unit: 'auto' }), res = C.analyzeAll(b.records, C.DEFAULTS), pct = b.info.unit === 'pct';
  const rows = res.map(h => {
    const s = h.stats || {}, B = h.before || {}, A = h.after || {}, ex = (h.explain && h.explain.items) || [];
    const W = (h.series || []).map(x => x.w).filter(isFinite), m = W.reduce((a, x) => a + x, 0) / (W.length || 1), sd = Math.sqrt(W.reduce((a, x) => a + (x - m) * (x - m), 0) / (W.length || 1));
    const T = s.target, T1 = s.t1, cp = 2 * T1 / (6 * sd), cpk = Math.min(T + T1 - m, m - (T - T1)) / (3 * sd), d = m - T;
    const ppm = 1e6 * (C.Phi(-(T1 - d) / sd) + C.Phi(-(T1 + d) / sd)), out1 = W.filter(x => Math.abs(x - T) > T1).length / (W.length || 1);
    const now = pct ? h.cNow : h.aNow, nw = pct ? h.cNew : h.aNew, dl = pct ? h.dC : h.delta;
    return [h.head, b.info.unit, h.status, h.mode, h.action, s.n, h.nLab, h.nOutliers, s.target, s.t1, s.t2,
      r(s.mean, 4), r(s.sd, 4), r(m, 4), r(sd, 4), r(cp, 4), r(cpk, 4), r(ppm, 0), r(100 * out1, 2),
      r(now, 3), r(nw, 3), r(dl, 3), h.clamped ? 'yes' : 'no',
      r(B.mean, 4), r(B.sd, 4), r(B.cpk, 4),
      r(A.mean, 4), r(A.sd, 4), r(A.cp, 4), r(A.cpk, 4), r(A.ppm, 0),
      (h.model && h.model.lasso || []).join('|'), ex.filter(i => i.delta).map(i => i.name + ':' + r(i.delta, 3)).join('|'),
      h.sufficiency && h.sufficiency.ok ? 'yes' : 'no', h.drift && h.drift.flag ? 'yes' : 'no'];
  });
  return [COLS.join(',')].concat(rows.map(x => x.join(','))).join('\n') + '\n';
}
module.exports = { runCsv, COLS };
if (require.main === module) process.stdout.write(runCsv(fs.readFileSync(process.argv[2], 'utf8')));
