const C = require('../src/core.js'); let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok   ' + m + (extra ? '  ' + extra : '')); } else { fail++; console.log('  FAIL ' + m + (extra ? '  ' + extra : '')); } };
const T0 = Date.now();
console.log('1. Math primitives');
ok(Math.abs(C.Phi(1.96) - 0.975) < 1e-3, 'Phi(1.96)=0.975'); ok(Math.abs(C.probit(0.975) - 1.96) < 1e-3, 'probit(0.975)=1.96');
{ // Lasso/Ridge recover sparse truth
  const R = C.rng(5), N = C.makeNormal(R), n = 400, rows = [];
  for (let i = 0; i < n; i++) rows.push({ x1: N(), x2: N(), x3: N(), x4: N() });
  const Z = ['x1', 'x2', 'x3', 'x4'].map(k => { const col = rows.map(r => r[k]), m = C.mean(col), s = C.sdev(col); return col.map(v => (v - m) / s); });
  const y = rows.map((r, i) => 2 * Z[0][i] - 1 * Z[2][i] + 0.5 * N()); const ym = C.mean(y), yc = y.map(v => v - ym);
  const sup = C.lassoSelect(Z, yc); ok(JSON.stringify(sup) === '[0,2]', 'Lasso selects the true variables {0,2}', JSON.stringify(sup));
  const rf = C.ridgeFit(sup.map(j => Z[j]), yc); ok(Math.abs(rf.beta[0] - 2) < 0.1 && Math.abs(rf.beta[1] + 1) < 0.1, 'Ridge coefficients ~ (2,-1)', rf.beta.map(b => b.toFixed(2)).join(','));
}
{ // RLS tracks a step change
  const R = C.rng(9), N = C.makeNormal(R); const mod = { c: 0, S: { aSign: 1 }, sfeat: [{ key: 'x', name: 'x', get: r => r.x, mu: 0, sd: 1 }] };
  // c=0 so prediction is pure RLS on w: patch mOf via rho*Q*(t-a)=0
  const st = C.rlsNew(mod, { lambdaF: 0.98 }); const mk = (x, b) => ({ x, rho: 1, Q: 1, t: 0, a: 0, w: b * x + 5 + 0.1 * N() });
  for (let i = 0; i < 300; i++) C.rlsUpdate(st, mod, mk(N(), 2)); const b1 = st.th[1];
  for (let i = 0; i < 300; i++) C.rlsUpdate(st, mod, mk(N(), -1)); const b2 = st.th[1];
  ok(Math.abs(b1 - 2) < 0.1 && Math.abs(b2 + 1) < 0.1, 'RLS forgets & tracks coefficient 2 -> -1', b1.toFixed(2) + ' -> ' + b2.toFixed(2));
}
console.log('2. CSV parsing, mapping, delay');
const p = C.simulateHistory({ seed: 3, nCycles: 300 });
for (const [sep, dec] of [[',', '.'], [';', ','], ['\t', '.']]) {
  const csv = p.toCSV({ sep, dec }); const parsed = C.parseCSV(csv); const map = C.guessMapping(parsed.header);
  ok(parsed.delimiter === sep && C.missingRequired(map).length === 0, 'delimiter ' + JSON.stringify(sep) + ' decimal ' + dec + ': parsed, all required columns auto-mapped', 'rows=' + parsed.rows.length);
}
{ const alt = p.toCSV({ header: ['Timestamp', 'Testina', 'Anticipo [ms]', 'Tempo dosaggio [ms]', 'Portata', 'Densita', 'Temperatura', 'Pressione', 'Stato', 'Peso target', 'T1', 'T2', 'Peso netto'] });
  const parsed = C.parseCSV(alt), map = C.guessMapping(parsed.header); ok(C.missingRequired(map).length === 0, 'Italian-style headers auto-mapped', JSON.stringify(map)); }
for (const d of [14, 9, 20, 0]) {
  const pp = C.simulateHistory({ seed: 4 + d, nCycles: 300, delay: d }); const parsed = C.parseCSV(pp.toCSV({ delay: d })), map = C.guessMapping(parsed.header);
  const est = C.estimateDelay(parsed, map); ok(est.lag === d && est.confident, 'delay ' + d + ' detected', 'got ' + est.lag + ' corr=' + est.corr.toFixed(2) + ' 2nd=' + est.second.toFixed(2));
}
{ // alignment correctness: record weight must equal the true weight of that fill
  const parsed = C.parseCSV(p.toCSV({})), map = C.guessMapping(parsed.header); const { records } = C.buildRecords(parsed, map, { delay: 14 });
  let bad = 0, n = 0; records.forEach(r => { if (isFinite(r.w)) { n++; if (Math.abs(r.w - p.fills[r.idx].trueW) > 0.006) bad++; } });
  ok(bad === 0 && n > 2000, 'weights re-attached to the right bottle (delay 14)', 'checked ' + n + ', mismatches ' + bad); }

console.log('3. Per-head analysis on the demo scenario');
const parsed = C.parseCSV(p.toCSV({})), map = C.guessMapping(parsed.header);
const { records, info } = C.buildRecords(parsed, map, { delay: 14, state: 'RUN' });
const t1 = Date.now(); const res = C.analyzeAll(records, {}); console.log('  analysis time for 10 heads x ' + Math.round(records.length / 10) + ' bottles: ' + (Date.now() - t1) + ' ms');
res.forEach(r => console.log('  H' + String(r.head).padStart(2) + ' ' + r.status.padEnd(6) + r.mode.padEnd(9) + (r.model ? r.model.name.padEnd(6) : '      ') + ' | ' + r.headline + (r.drift && r.drift.flag ? '  [drift@' + r.drift.at + ']' : '') + '  vars=' + r.vars.map(v => v.key).join('+')));
ok(res.length === 10, '10 heads analysed');
const h = i => res[i - 1];
ok(Math.abs(h(4).delta) <= 5, 'step bounded to maxStep');
ok(h(7).status === 'check', 'head 7 (noisy valve): flagged "check the head", spread problem', h(7).headline);
ok(h(10).status === 'wait', 'head 10 (25 bottles): waits for data, no recommendation', h(10).headline);
ok(h(10).delta === 0 && h(10).aNew === h(10).aNow, 'head 10: setpoint untouched');
ok(res.every(r => r.mode === 'none' || r.mode === 'learned' || r.mode === 'feedback'), 'every head has a defined mode/fallback');

console.log('4. Safety behaviours');
{ // drift scenario: head 2 step at 70%
  const pd = C.simulateHistory({ seed: 11, nCycles: 500, scenario: 'drift' }); const pr = C.parseCSV(pd.toCSV({})), mp = C.guessMapping(pr.header);
  const rec = C.buildRecords(pr, mp, { delay: 14, state: 'RUN' }).records; const rs = C.analyzeAll(rec, {});
  const d2 = rs[1]; ok(d2.drift && d2.drift.flag, 'head 2: process change (seal wear) detected', d2.headline + ' | drift@' + (d2.drift && d2.drift.at));
  const fa = rs.filter((r, i) => i !== 1 && r.drift && r.drift.flag).map(r => r.head); ok(fa.length <= 1, 'false drift alarms on other heads: ' + JSON.stringify(fa) + ' (<=1 of 9 allowed)'); }
{ // out-of-envelope: push last bottles of head 1 far outside seen pressure
  const by = C.groupByHead(records); const h1 = by[1].map(r => Object.assign({}, r)); for (let i = h1.length - 12; i < h1.length; i++) { h1[i].P += 3; h1[i].Q *= 1.5; }
  const r = C.analyzeHead(h1, {}); ok(r.mode !== 'learned', 'conditions far outside seen range -> does not use learned model', r.mode + ' | ' + (r.outOfRange || []).join(',')); }
{ // garbage columns: weight unrelated -> must not crash and must not recommend wildly
  const by = C.groupByHead(records); const g = by[3].map((r, i) => Object.assign({}, r, { w: 250 + 3 * Math.sin(i * 7.7) }));
  const r = C.analyzeHead(g, {}); ok(Math.abs(r.delta) <= 5, 'unrelated weights: step stays bounded', r.headline); }
{ // oracle check: recommended step vs the simulator's ground truth ideal step
  function oracle(pl, head) { const H = pl.h[head - 1], fs = pl.fills.filter(f => f.head === head && f.state === 'RUN').slice(-60);
    return C.mean(fs.map(f => { const tauE = H.tau + H.tauAdd + 60 * (f.P - 1.2) + 2 * (f.T - 20); const w = f.rho * f.Q * (f.t - H.a + tauE) / 1000; return (w - 250) / (f.rho * f.Q / 1000); })); }
  let agree = 0, tot = 0, keepOK = 0, keepTot = 0, wErr = [];
  for (const seed of [31, 32, 33, 34, 35, 36]) { const pl = C.simulateHistory({ seed, nCycles: 200 }); const pr = C.parseCSV(pl.toCSV({})); const rc = C.buildRecords(pr, C.guessMapping(pr.header), { delay: 14, state: 'RUN' }).records;
    C.analyzeAll(rc, {}).forEach(r => { if (r.status === 'wait' || r.status === 'check') return; const o = oracle(pl, r.head), gErr = o * 0.063; wErr.push(Math.abs(r.wNow - (250 + gErr)));
      if (Math.abs(gErr) > 1.2) { tot++; if (Math.sign(o) === Math.sign(r.delta)) agree++; } else if (Math.abs(gErr) < 0.5) { keepTot++; if (r.delta === 0) keepOK++; } }); }
  ok(agree / tot >= 0.95, 'step direction matches the true ideal when the error is > 1.2 g: ' + agree + '/' + tot);
  ok(keepOK / keepTot >= 0.8, 'leaves the setpoint alone when the true error is < 0.5 g: ' + keepOK + '/' + keepTot);
  ok(C.mean(wErr) < 0.5, 'predicted mean weight at today\'s conditions vs truth: mean abs error ' + C.mean(wErr).toFixed(2) + ' g'); }
{ // aSign=-1 must flip the direction of the recommendation
  const rec4 = records.filter(r => r.head === 1); const a = C.analyzeHead(rec4, { aSign: 1 }), b = C.analyzeHead(rec4, { aSign: -1 });
  ok(a.delta === 0 || b.delta === 0 || Math.sign(a.delta) !== Math.sign(b.delta) || b.mode !== 'learned', 'aSign=-1 does not repeat the same direction blindly', a.delta + ' vs ' + b.delta); }
{ // empty / tiny input
  const r = C.analyzeHead(records.filter(r => r.head === 5).slice(0, 5), {}); ok(r.status === 'wait', 'tiny input -> wait, no crash'); }

console.log('5. Closed loop (simulation only): existing feedback vs tool recommendations, same random numbers');
function runLoop(scenario, seed, useTool) {
  const q = new C.Plant({ seed, scenario, nCycles: 700, delay: 14 }); const post = [];
  for (let c = 0; c < 700; c++) {
    const fl = q.cycle(); if (c >= 450) fl.forEach(f => post.push(f));
    if (!useTool || c < 300) q.legacyLoop();
    else if (c % 40 === 0) { const rec = q.records('RUN'); const rs = C.analyzeAll(rec.filter(r => isFinite(r.t)), {}); rs.forEach(r => { if (r.action !== 'keep' && r.status !== 'wait') q.h[r.head - 1].a = r.aNew; }); }
    
  }
  // metrics on later production, RUN state, real weights (exclude outliers: 0 / 2x)
  const rows = post.filter(f => f.state === 'RUN' && Math.abs(f.trueW - 250) < 30);
  const by = {}; rows.forEach(f => (by[f.head] = by[f.head] || []).push(f.trueW));
  let out = { mae: 0, sd: 0, o1: 0, o2: 0, n: 0, perHead: {} };
  for (const k in by) { const w = by[k], m = C.mean(w); out.perHead[k] = { bias: m - 250, sd: C.sdev(w) }; w.forEach(x => { out.mae += Math.abs(x - 250); out.n++; if (Math.abs(x - 250) > 4) out.o1++; if (Math.abs(x - 250) > 8) out.o2++; }); }
  out.mae /= out.n; out.o1 /= out.n; out.o2 /= out.n; return out;
}
for (const sc of ['demo', 'clean', 'slow']) { let A = [], B = [];
  for (const seed of [21, 22, 23]) { A.push(runLoop(sc, seed, false)); B.push(runLoop(sc, seed, true)); }
  const f = (arr, k) => C.mean(arr.map(x => x[k]));
  console.log('  scenario ' + sc + ' (3 seeds, cycles 450-700):');
  console.log('   existing loop : mean|err| ' + f(A, 'mae').toFixed(2) + ' g | outside T1 ' + (100 * f(A, 'o1')).toFixed(1) + '% | outside T2 ' + (100 * f(A, 'o2')).toFixed(2) + '%');
  console.log('   with tool     : mean|err| ' + f(B, 'mae').toFixed(2) + ' g | outside T1 ' + (100 * f(B, 'o1')).toFixed(1) + '% | outside T2 ' + (100 * f(B, 'o2')).toFixed(2) + '%');
  const b4a = C.mean(A.map(x => Math.abs(x.perHead[4].bias))), b4b = C.mean(B.map(x => Math.abs(x.perHead[4].bias)));
  console.log('   head 4 |bias|: ' + b4a.toFixed(2) + ' g -> ' + b4b.toFixed(2) + ' g');
  ok(f(B, 'mae') <= f(A, 'mae') * 1.02, 'tool is not worse than the existing loop (' + sc + ')'); }

console.log('6. Projected gain vs what actually happens next (paired simulation, recommendation applied once)');
{ let P1 = [], P2 = [], M1 = [], M2 = [], G = [];
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const hist = C.simulateHistory({ seed, nCycles: 300, scenario: 'slow' }); const pr = C.parseCSV(hist.toCSV({})); const rc = C.buildRecords(pr, C.guessMapping(pr.header), { delay: 14, state: 'RUN' }).records;
    const res = C.analyzeAll(rc, {}), sm = C.summarize(res); P1.push(sm.before.pOutT1); P2.push(sm.afterFixed.pOutT1); G.push([sm.before.giveaway, sm.afterFixed.giveaway]);
    // what really happens: same plant, run 140 more cycles without / with the recommended change; measure the last 100 cycles (true weights)
    const run = apply => { const q = new C.Plant({ seed, scenario: 'slow', nCycles: 300 }); for (let c = 0; c < 300; c++) { q.cycle(); q.legacyLoop(); }
      if (apply) res.forEach(r => { if (r.action !== 'keep' && r.status !== 'wait') q.h[r.head - 1].a = r.aNew; });
      const f = []; for (let c = 300; c < 440; c++) { const fl = q.cycle(); if (c >= 340) fl.forEach(x => f.push(x)); }
      const ok_ = f.filter(x => x.state === 'RUN' && Math.abs(x.trueW - 250) < 30 && x.head !== 10); return f.length ? ok_.filter(x => Math.abs(x.trueW - 250) > 4).length / ok_.length : 0; };
    M1.push(run(false)); M2.push(run(true)); }
  const m = a => C.mean(a);
  console.log('  projected outside-T1: ' + (100 * m(P1)).toFixed(1) + '% -> ' + (100 * m(P2)).toFixed(1) + '%   |   actually measured next: ' + (100 * m(M1)).toFixed(1) + '% (no change) -> ' + (100 * m(M2)).toFixed(1) + '% (change applied)');
  console.log('  projected giveaway kg/1000: ' + m(G.map(g => g[0])).toFixed(2) + ' -> ' + m(G.map(g => g[1])).toFixed(2));
  ok(m(M2) < m(M1) * 0.85, 'applying one proposal step really reduces out-of-T1 bottles (measured in simulation)');
  ok(Math.abs((m(P1) - m(P2)) - (m(M1) - m(M2))) < 0.02, 'projected GAIN (pts outside T1) is within 2 points of the measured gain', 'projected gain ' + (100 * (m(P1) - m(P2))).toFixed(1) + ' pp vs measured ' + (100 * (m(M1) - m(M2))).toFixed(1) + ' pp; level offset ' + (100 * (m(P1) - m(M1))).toFixed(1) + ' pp (the existing feedback keeps improving on its own, so the projection is conservative)'); }
console.log('7. Dynamic anticipation (follows flow, density, temperature, pressure): projected vs measured, closed loop');
{ const seeds = [5, 7, 9, 11], M = { none: [], fix: [], dyn: [] }, PJ = { before: [], fix: [], after: [] }, CP = { none: [], dyn: [] };
  for (const seed of seeds) {
    const O = { seed, nCycles: 300, scenario: 'dynamic', swing: 1.5, saw: 0.7 };
    const hist = C.simulateHistory(O), pr = C.parseCSV(hist.toCSV({ plcAligned: true })), mp = C.guessMapping(pr.header);
    ok(seed !== seeds[0] || (mp.state == null && C.missingRequired(mp).length === 0), 'PLC-aligned CSV (no state column, weight on the fill row) is recognised with no delay/state handling');
    const res = C.analyzeAll(C.buildRecords(pr, mp, { delay: 0 }).records, {}), sm = C.summarize(res);
    const use = res.filter(r => r.head !== 10 && r.head !== 7 && r.mode === 'learned' && r.comp);
    PJ.before.push(C.mean(use.map(r => r.before.sd))); PJ.fix.push(C.mean(use.map(r => r.afterFixed.sd))); PJ.after.push(C.mean(use.map(r => r.after.sd)));
    const run = pol => { const q = new C.Plant(O); for (let c = 0; c < 300; c++) { q.cycle(); q.legacyLoop(); }
      const dyn = {}; res.forEach(r => { if (r.status === 'wait' || r.action === 'none') return; if (pol !== 'none') q.h[r.head - 1].a = r.aNew; if (pol === 'dyn' && r.comp && r.comp.on) dyn[r.head - 1] = r.comp; });
      const ctl = pol === 'dyn' ? { dyn: (k, m) => { const cp = dyn[k]; if (!cp) return q.h[k].a; let d = 0; cp.terms.forEach(t => { d += t.k * (Math.min(t.hi, Math.max(t.lo, m[t.key])) - t.ref); }); return q.h[k].a + Math.min(cp.dynMax, Math.max(-cp.dynMax, d)); } } : null;
      const per = {}; for (let c = 300; c < 440; c++) { const fl = q.cycle(ctl); if (c >= 330) fl.forEach(x => { if (x.state === 'RUN' && x.head !== 10 && x.head !== 7 && Math.abs(x.trueW - 250) < 30) (per[x.head] = per[x.head] || []).push(x.trueW); }); }
      const sds = [], cpks = [], o1 = []; use.forEach(r => { const w = per[r.head]; if (!w) return; sds.push(C.sdev(w)); o1.push(w.filter(v => Math.abs(v - 250) > 4).length / w.length); cpks.push(C.capability(C.mean(w), C.sdev(w), 250, 4).cpk); });
      return { sd: C.mean(sds), o1: C.mean(o1), cpk: C.mean(cpks) }; };
    M.none.push(run('none')); M.fix.push(run('fix')); M.dyn.push(run('dyn')); }
  const m = a => C.mean(a), pick = (A, k) => m(A.map(x => x[k]));
  console.log('  spread σ (g), mean over learned heads:  projected now ' + m(PJ.before).toFixed(2) + ' | fixed value ' + m(PJ.fix).toFixed(2) + ' | with compensation ' + m(PJ.after).toFixed(2));
  console.log('                                          measured  now ' + pick(M.none, 'sd').toFixed(2) + ' | fixed value ' + pick(M.fix, 'sd').toFixed(2) + ' | with compensation ' + pick(M.dyn, 'sd').toFixed(2));
  console.log('  outside T1 measured: now ' + (100 * pick(M.none, 'o1')).toFixed(1) + '% | fixed ' + (100 * pick(M.fix, 'o1')).toFixed(1) + '% | compensated ' + (100 * pick(M.dyn, 'o1')).toFixed(1) + '%   Cpk measured: ' + pick(M.none, 'cpk').toFixed(2) + ' -> ' + pick(M.fix, 'cpk').toFixed(2) + ' -> ' + pick(M.dyn, 'cpk').toFixed(2));
  ok(pick(M.dyn, 'sd') < 0.8 * pick(M.fix, 'sd'), 'compensation really cuts the weight spread (measured σ at least 20% lower than with a fixed value)');
  ok(pick(M.dyn, 'o1') <= pick(M.fix, 'o1') && pick(M.dyn, 'cpk') > pick(M.fix, 'cpk'), 'compensation improves measured Cpk and bottles outside T1');
  ok(Math.abs(m(PJ.after) - pick(M.dyn, 'sd')) < 0.25 * pick(M.dyn, 'sd') + 0.1, 'projected σ with compensation is within ~25% of the measured σ', 'projected ' + m(PJ.after).toFixed(2) + ' vs measured ' + pick(M.dyn, 'sd').toFixed(2));
  ok(Math.abs(m(PJ.before) - pick(M.none, 'sd')) < 0.3 * pick(M.none, 'sd') + 0.1, 'projected "now" σ matches the measured σ without change', 'projected ' + m(PJ.before).toFixed(2) + ' vs measured ' + pick(M.none, 'sd').toFixed(2)); }
console.log('8. Tolerance override and capability maths');
{ const hist = C.simulateHistory({ seed: 5, nCycles: 200, scenario: 'dynamic', swing: 1.5, saw: 0.7 }), pr = C.parseCSV(hist.toCSV({ plcAligned: true })), mp = C.guessMapping(pr.header);
  const a = C.buildRecords(pr, mp, { delay: 0 }).records, b = C.buildRecords(pr, mp, { delay: 0, t1Abs: 2.5, t2Abs: 6 }).records;
  ok(a[0].t1 === 4 && b.every(r => r.t1 === 2.5 && r.t2 === 6), 'dragged T1/T2 override the file values');
  const ra = C.analyzeAll(a, {}), rb = C.analyzeAll(b, {}); ok(rb[0].before.pOutT1 >= ra[0].before.pOutT1 && rb[0].stats.t1 === 2.5, 'tighter tolerance gives more bottles outside T1');
  const cp = C.capability(250, 1, 250, 3); ok(Math.abs(cp.cp - 1) < 1e-9 && Math.abs(cp.cpk - 1) < 1e-9 && Math.abs(cp.ppm - 2700) < 30, 'Cp = Cpk = 1 for a centred ±3σ limit (≈2,700 ppm)', JSON.stringify(cp));
  const cp2 = C.capability(251.5, 1, 250, 3); ok(Math.abs(cp2.cpk - 0.5) < 1e-9 && cp2.cp === 1, 'Cpk drops when the average is off centre', JSON.stringify(cp2)); }
console.log('9. Closing point as % of setpoint (no time unit): detection, learning, closed loop');
{ const O = { seed: 5, nCycles: 300, scenario: 'dynamic', swing: 1.5, saw: 0.7, closeUnit: 'pct' }, hist = C.simulateHistory(O), csv = hist.toCSV({ plcAligned: true }), pr = C.parseCSV(csv), mp = C.guessMapping(pr.header);
  ok(/close_at_pct/.test(csv.split('\n')[0]) && !/dose_time/.test(csv.split('\n')[0]), 'percent file has a % closing column and no dose-time column');
  ok(C.detectUnit(pr, mp) === 'pct' && C.missingRequired(mp, 'pct').length === 0, 'file is recognised as % with every required column present');
  const msf = C.parseCSV(C.simulateHistory({ seed: 5, nCycles: 60, scenario: 'dynamic' }).toCSV({ plcAligned: true }));
  ok(C.detectUnit(msf, C.guessMapping(msf.header)) === 'ms', 'a file with anticipation in ms is still recognised as ms');
  const hdrless = { header: ['head', 'x', 'q', 'rho', 'w', 'target'], rows: [[1, 99.2, 60, 1, 250, 250], [1, 99.4, 60, 1, 250, 250], [1, 99.0, 60, 1, 250, 250]] };
  ok(C.detectUnit(hdrless, { head: 0, a: 1 }) === 'pct', 'values between 50 and 100 are taken as %');
  const res = C.analyzeAll(C.buildRecords(pr, mp, { delay: 0 }).records, {}), sm = C.summarize(res), use = res.filter(r => r.head !== 10 && r.head !== 7 && r.mode === 'learned' && r.comp);
  ok(use.length >= 6 && use.every(r => r.unit === 'pct' && isFinite(r.cNew) && Math.abs(r.dC) <= 0.1501), 'heads learn in % and every base step stays within the ±0.15 % limit');
  ok(use.every(r => r.cNew > 90 && r.cNew <= 100), 'proposed closing points are plausible (between 90 and 100 % of setpoint)');
  ok(use.every(r => r.comp.dynMax === 0.6 && r.comp.terms.every(t => isFinite(t.kc))), 'compensation law is expressed in % per unit with a ±0.6 % limit');
  ok(use.filter(r => r.hasComp).length >= 5, 'the law that follows the conditions is proposed for most heads');
  const A = { none: [], fix: [], dyn: [], pj: [] };
  for (const seed of [5, 7, 9, 11]) { const O2 = Object.assign({}, O, { seed }), pr2 = C.parseCSV(C.simulateHistory(O2).toCSV({ plcAligned: true })), mp2 = C.guessMapping(pr2.header), rs2 = C.analyzeAll(C.buildRecords(pr2, mp2, { delay: 0 }).records, {}), use2 = rs2.filter(r => r.head !== 10 && r.head !== 7 && r.mode === 'learned' && r.comp);
    const run = pol => { const q = new C.Plant(O2); for (let c = 0; c < 300; c++) { q.cycle(); q.legacyLoop(); }
      const dyn = {}; rs2.forEach(r => { if (r.status === 'wait' || r.action === 'none') return; if (pol !== 'none') q.h[r.head - 1].c = r.cNew; if (pol === 'dyn' && r.comp && r.comp.on) dyn[r.head - 1] = r.comp; });
      const ctl = pol === 'dyn' ? { dyn: (k, m) => { const cp = dyn[k]; if (!cp) return q.h[k].c; let d = 0; cp.terms.forEach(t => { d += t.kc * (Math.min(t.hi, Math.max(t.lo, m[t.key])) - t.ref); }); return cp.cBase + Math.min(cp.dynMax, Math.max(-cp.dynMax, d)); } } : null;
      const per = {}; for (let c = 300; c < 440; c++) { const fl = q.cycle(ctl); if (c >= 330) fl.forEach(x => { if (x.state === 'RUN' && x.head !== 10 && x.head !== 7 && Math.abs(x.trueW - 250) < 30) (per[x.head] = per[x.head] || []).push(x.trueW); }); }
      const sds = [], cpks = [], o1 = []; use2.forEach(r => { const w = per[r.head]; if (!w) return; sds.push(C.sdev(w)); o1.push(w.filter(v => Math.abs(v - 250) > 4).length / w.length); cpks.push(C.capability(C.mean(w), C.sdev(w), 250, 4).cpk); });
      return { sd: C.mean(sds), o1: C.mean(o1), cpk: C.mean(cpks) }; };
    A.none.push(run('none')); A.fix.push(run('fix')); A.dyn.push(run('dyn')); A.pj.push(C.mean(use2.map(r => r.after.sd))); }
  const pk = (L, k) => C.mean(L.map(x => x[k])), none = { sd: pk(A.none, 'sd'), o1: pk(A.none, 'o1'), cpk: pk(A.none, 'cpk') }, fix = { sd: pk(A.fix, 'sd'), o1: pk(A.fix, 'o1'), cpk: pk(A.fix, 'cpk') }, dyn = { sd: pk(A.dyn, 'sd'), o1: pk(A.dyn, 'o1'), cpk: pk(A.dyn, 'cpk') }, pj = C.mean(A.pj);
  console.log('  (4 seeds) measured σ: now ' + none.sd.toFixed(2) + ' | base only ' + fix.sd.toFixed(2) + ' | base + law ' + dyn.sd.toFixed(2) + ' g   projected with law ' + pj.toFixed(2) + ' g');
  console.log('  Cpk measured: ' + none.cpk.toFixed(2) + ' -> ' + fix.cpk.toFixed(2) + ' -> ' + dyn.cpk.toFixed(2) + '   outside T1: ' + (100 * none.o1).toFixed(1) + '% -> ' + (100 * fix.o1).toFixed(1) + '% -> ' + (100 * dyn.o1).toFixed(1) + '%');
  ok(dyn.sd < 0.8 * fix.sd, 'in % the law really cuts the measured spread (≥20% lower than a fixed closing point)');
  ok(dyn.cpk > fix.cpk && dyn.o1 <= fix.o1, 'in % the law improves measured Cpk and bottles outside T1');
  ok(Math.abs(pj - dyn.sd) < 0.25 * dyn.sd + 0.1, 'projected σ with the law is within ~25% of the measured σ', 'projected ' + pj.toFixed(2) + ' vs measured ' + dyn.sd.toFixed(2)); }
console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + ((Date.now() - T0) / 1000).toFixed(1) + ' s)'); process.exit(fail ? 1 : 0);
