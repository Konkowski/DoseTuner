/* DoseCore - self-calibrating dosing setpoints. Pure JS, no dependencies, runs on any phone browser.
   Per head: physics prior + Ridge/Lasso/RLS residual model + safety layer. Recommends, never commands. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DoseCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ------------------------------ small math ------------------------------ */
const mean = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : NaN; };
const sdev = a => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) * (a[i] - m); return a.length ? Math.sqrt(s / a.length) : NaN; };
const median = a => { if (!a.length) return NaN; const b = a.slice().sort((x, y) => x - y), n = b.length; return n % 2 ? b[(n - 1) / 2] : (b[n / 2 - 1] + b[n / 2]) / 2; };
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
function erf(x) { const s = x < 0 ? -1 : 1; x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
const Phi = x => 0.5 * (1 + erf(x / Math.SQRT2));
function probit(p) { // Acklam approximation
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, r;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  if (p > 1 - pl) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
  q = p - 0.5; r = q * q;
  return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5]) * q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
function solve(A, b) { // Gaussian elimination, partial pivoting
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    const tmp = M[c]; M[c] = M[p]; M[p] = tmp;
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = M[i][n]; for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k]; x[i] = s / M[i][i]; }
  return x;
}
function inv(A) { const n = A.length, cols = []; for (let j = 0; j < n; j++) { const e = new Array(n).fill(0); e[j] = 1; const x = solve(A, e); if (!x) return null; cols.push(x); }
  return A.map((_, i) => cols.map(c => c[i])); }

/* seeded RNG */
function rng(seed) { let s = seed >>> 0; return function () { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function makeNormal(r) { return () => { let u = 0; while (u === 0) u = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r()); }; }

/* ------------------------------ CSV ------------------------------ */
function splitLine(line, d) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) { const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === d) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out;
}
function parseCSV(text) {
  text = String(text).replace(/^﻿/, '');
  let lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
  if (lines.length && /^sep=/i.test(lines[0])) lines.shift();
  if (lines.length < 2) return { header: [], rows: [], delimiter: ',' };
  let best = ',', bestScore = -1;
  for (const d of [';', '\t', ',', '|']) {
    const counts = lines.slice(0, 12).map(l => splitLine(l, d).length);
    const ok = counts.every(c => c === counts[0]) && counts[0] > 1;
    const score = ok ? counts[0] : 0;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  const header = splitLine(lines[0], best).map(s => s.trim());
  const rows = []; for (let i = 1; i < lines.length; i++) rows.push(splitLine(lines[i], best));
  return { header, rows, delimiter: best };
}
function num(s) {
  if (s == null) return NaN; s = String(s).trim();
  if (s === '' || /^(nan|null|n\/a|na|-|--|none)$/i.test(s)) return NaN;
  if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.indexOf(',') >= 0) s = s.replace(',', '.');
  let v = Number(s); if (!isFinite(v)) v = parseFloat(s);
  return isFinite(v) ? v : NaN;
}

const FIELDS = [
  { key: 'head', req: true, label: 'Head number', alias: ['head', 'headno', 'headnumber', 'headnr', 'nozzle', 'valve', 'station', 'filler', 'fillhead', 'dosinghead', 'testina', 'ugello', 'hd'] },
  { key: 'a', req: true, label: 'Closing point applied (% of setpoint)', alias: ['closingpoint', 'closepoint', 'closeat', 'closingat', 'closingthreshold', 'closethreshold', 'threshold', 'closepct', 'closingpct', 'closingpercent', 'closepercent', 'percentclose', 'cutoff', 'cutoffpct', 'setpointpct', 'anticipation', 'closinganticipation', 'anticipationms', 'anticipo', 'closeanticipation', 'antic', 'anticip', 'preclose', 'earlyclose', 'closingadvance', 'closingearly'] },
  { key: 't', req: false, label: 'Commanded dose time (only needed if the closing value is in ms)', alias: ['dosetime', 'dosingtime', 'commandeddosetime', 'filltime', 'tempodosaggio', 'tdose', 'opentime', 'dosetimems', 'doset'] },
  { key: 'Q', req: true, label: 'Flow', alias: ['flow', 'flowrate', 'massflow', 'portata', 'q', 'flowmeter'] },
  { key: 'rho', req: true, label: 'Product density', alias: ['density', 'densita', 'rho', 'productdensity'] },
  { key: 'w', req: true, label: 'Net weight (checkweigher)', alias: ['weight', 'netweight', 'netbottleweight', 'peso', 'pesonetto', 'checkweigher', 'cw', 'measuredweight', 'actualweight', 'netwt'] },
  { key: 'target', req: true, label: 'Target weight', alias: ['target', 'targetweight', 'nominalweight', 'nominal', 'tw', 'pesotarget', 'setpointweight'] },
  { key: 'T', req: false, label: 'Product temperature', alias: ['temp', 'temperature', 'producttemp', 'producttemperature', 'temperatura', 'tprod'] },
  { key: 'P', req: false, label: 'Tank pressure', alias: ['pressure', 'tankpressure', 'pressione', 'ptank', 'p'] },
  { key: 'state', req: false, hidden: true, label: 'Machine state', alias: ['state', 'machinestate', 'status', 'stato'] },
  { key: 't1', req: false, label: 'Tolerance T1', alias: ['t1', 'tolt1', 'tolerancet1', 'tol1'] },
  { key: 't2', req: false, label: 'Tolerance T2', alias: ['t2', 'tolt2', 'tolerancet2', 'tol2'] },
  { key: 'time', req: false, label: 'Time / timestamp', alias: ['time', 'timestamp', 'datetime', 'date', 'ts'] }
];
function guessMapping(header) {
  const UNITS = new Set(['g', 'kg', 'mg', 'ms', 's', 'sec', 'ml', 'l', 'mls', 'gml', 'c', 'degc', 'bar', 'mbar', 'pa', 'kpa', 'psi', 'mm', 'lmin', 'mlmin', 'pct']);
  const norm = header.map(h => { const tok = h.toLowerCase().replace(/\[.*?\]|\(.*?\)/g, '').replace(/units?/g, '').split(/[\s_\-.\/]+/).filter(Boolean);
    while (tok.length > 1 && UNITS.has(tok[tok.length - 1])) tok.pop(); return tok.join('').replace(/[^a-z0-9]/g, ''); });
  const map = {}, used = new Set();
  for (const f of FIELDS) { const i = norm.findIndex((h, k) => !used.has(k) && f.alias.includes(h)); if (i >= 0) { map[f.key] = i; used.add(i); } }
  for (const f of FIELDS) { if (map[f.key] != null) continue;
    const i = norm.findIndex((h, k) => !used.has(k) && f.alias.some(al => al.length >= 4 && h.includes(al)));
    if (i >= 0) { map[f.key] = i; used.add(i); } }
  return map;
}
/* 'pct' = the closing value is a percentage of the setpoint (e.g. 99.3); 'ms' = a time before the end of the dose. */
function detectUnit(parsed, map) {
  if (map.a == null) return 'pct';
  const h = String(parsed.header[map.a] || '').toLowerCase();
  if (/%|pct|percent|perc|threshold|closeat|closingat|closepoint|closingpoint/.test(h)) return 'pct';
  if (/(^|[^a-z])ms([^a-z]|$)|millisec|antic/.test(h)) return 'ms';
  const v = parsed.rows.slice(0, 3000).map(r => num(r[map.a])).filter(isFinite).sort((x, y) => x - y);
  if (!v.length) return 'pct';
  const md = v[Math.floor(v.length / 2)], mx = v[v.length - 1];
  return (md >= 50 && md <= 100.0001 && mx <= 100.5) ? 'pct' : 'ms';
}
function missingRequired(map, unit) { return FIELDS.filter(f => (f.req || (f.key === 't' && unit === 'ms')) && map[f.key] == null).map(f => f.label); }

/* Build per-bottle fill records. delay = number of bottles (rows) between a fill and its weight in the file. */
function buildRecords(parsed, map, opts) {
  opts = Object.assign({ delay: 0, state: null, t1Frac: 0.015, t2Mult: 2, t1Abs: null, t2Abs: null, unit: 'auto' }, opts || {});
  const unit = opts.unit === 'auto' ? detectUnit(parsed, map) : opts.unit, PCT = unit === 'pct';
  const rows = parsed.rows, n = rows.length, g = (r, k) => map[k] == null ? NaN : num(r[map[k]]);
  const fills = [], info = { rows: n, dropped: 0, wrongState: 0, unlabelled: 0, unit };
  const states = {};
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const st = map.state == null ? '' : String(r[map.state] || '').trim();
    states[st] = (states[st] || 0) + 1;
    const f = { idx: i, time: map.time != null ? r[map.time] : '', head: g(r, 'head'), a: g(r, 'a'), t: g(r, 't'), Q: g(r, 'Q'), rho: g(r, 'rho'),
      T: g(r, 'T'), P: g(r, 'P'), state: st, target: g(r, 'target'), t1: g(r, 't1'), t2: g(r, 't2'), w: NaN };
    if (PCT) { const c = f.a; f.c = c; f.a = isFinite(c) && c > 0 && c <= 100.5 ? 100 - c : NaN; f.t = NaN; f.pct = true; }
    const j = i + opts.delay; f.w = j < n ? g(rows[j], 'w') : NaN;
    fills.push(f);
  }
  info.states = states;
  const out = [];
  for (const f of fills) {
    if (![f.head, f.a, PCT ? 0 : f.t, f.Q, f.rho, f.target].every(isFinite) || f.Q <= 0 || f.rho <= 0) { info.dropped++; continue; }
    if (opts.state != null && f.state !== opts.state) { info.wrongState++; continue; }
    if (opts.t1Abs != null) { f.t1 = opts.t1Abs; f.t2 = opts.t2Abs != null ? opts.t2Abs : opts.t1Abs * opts.t2Mult; }
    if (!isFinite(f.t1)) f.t1 = f.target * opts.t1Frac;
    if (!isFinite(f.t2)) f.t2 = f.t1 * opts.t2Mult;
    if (!isFinite(f.w)) info.unlabelled++;
    out.push(f);
  }
  info.kept = out.length;
  return { records: out, info };
}
/* Most common machine state (for default filter). */
function dominantState(states) { let b = null, c = -1; for (const k in states) if (states[k] > c) { c = states[k]; b = k; } return b; }

/* ---- delay estimation: correlate fast per-bottle physics variation with the later weight ---- */
function detrendByGroup(vals, groups, k) {
  const out = new Array(vals.length).fill(NaN), by = {};
  groups.forEach((g, i) => { (by[g] = by[g] || []).push(i); });
  for (const g in by) { const ix = by[g];
    for (let p = 0; p < ix.length; p++) { let s = 0, c = 0;
      for (let q = Math.max(0, p - k); q <= Math.min(ix.length - 1, p + k); q++) if (q !== p && isFinite(vals[ix[q]])) { s += vals[ix[q]]; c++; }
      if (c && isFinite(vals[ix[p]])) out[ix[p]] = vals[ix[p]] - s / c; } }
  return out;
}
function estimateDelay(parsed, map, maxLag) {
  maxLag = maxLag || 40;
  const { records } = buildRecords(parsed, map, { delay: 0 });
  // use ALL rows (not state-filtered) in file order; weights col aligned to rows
  const rows = parsed.rows, n = rows.length, g = (r, k) => num(r[map[k]]);
  const heads = [], prior = [], wcol = [];
  for (let i = 0; i < n; i++) { const r = rows[i]; heads.push(g(r, 'head')); prior.push(g(r, 'rho') * g(r, 'Q') * (g(r, 't') - g(r, 'a'))); wcol.push(g(r, 'w')); }
  const xd = detrendByGroup(prior, heads, 3);
  const scores = [];
  for (let L = 0; L <= maxLag; L++) {
    const y = new Array(n).fill(NaN); for (let i = 0; i + L < n; i++) y[i] = wcol[i + L];
    const yd = detrendByGroup(y, heads, 3);
    const xs = [], ys = []; for (let i = 0; i < n; i++) if (isFinite(xd[i]) && isFinite(yd[i])) { xs.push(xd[i]); ys.push(yd[i]); }
    // robust: drop gross weight outliers
    const med = median(ys), mad = median(ys.map(v => Math.abs(v - med))) || 1e-9; const X = [], Y = [];
    for (let i = 0; i < ys.length; i++) if (Math.abs(ys[i] - med) < 8 * 1.4826 * mad + 1e-12) { X.push(xs[i]); Y.push(ys[i]); }
    const mx = mean(X), my = mean(Y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < X.length; i++) { sxy += (X[i] - mx) * (Y[i] - my); sxx += (X[i] - mx) ** 2; syy += (Y[i] - my) ** 2; }
    scores.push(sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0);
  }
  let best = 0; scores.forEach((s, i) => { if (s > scores[best]) best = i; });
  let second = -1; scores.forEach((s, i) => { if (Math.abs(i - best) > 1 && s > second) second = s; });
  const confident = scores[best] > 0.3 && scores[best] - Math.max(second, 0) >= 0.1;
  return { lag: best, corr: scores[best], second, scores, confident };
}

/* ------------------------------ learning ------------------------------ */
const DEFAULTS = { maxStep: 5, aimOffset: 0, lambdaF: 0.995, delta: 0.05, epsFrac: 0.25, minN: 40, window: 1500, deadbandFrac: 0.2,
  nowWindow: 60, serN: 150, dynMax: 25, maxStepPct: 0.15, dynMaxPct: 0.6, holdFrac: 0.3, aMin: null, aMax: null, trustMargin: 0.95, recentN: 40, fbGain: 0.5, aSign: 1, spreadFrac: 0.6 };
const FEATS = [['rho', 'product density', r => r.rho], ['Q', 'flow', r => r.Q], ['T', 'product temperature', r => r.T],
  ['P', 'tank pressure', r => r.P], ['t', 'commanded dose time', r => r.t], ['a', 'closing anticipation (own effect)', r => r.a]];
/* Internal control variable: 'a' = how early the valve closes. In ms mode it is a time; in % mode it is the shortfall 100 - closing point (% of setpoint). */
const K0 = 1e-3;
const uS = r => r.pct ? r.target / (100 * K0) : r.rho * r.Q;     /* weight per unit of 'a' is c0 * uS */
const mOf = (r, S) => r.pct ? r.target * (100 - S.aSign * r.a) / (100 * K0) : r.rho * r.Q * (r.t - S.aSign * r.a);
const RD = (x, pct) => pct ? Math.round(x * 100) / 100 : Math.round(x * 10) / 10;

function lassoFit(Z, y, lam, beta, n) {
  const p = Z.length; const r = y.slice(); for (let j = 0; j < p; j++) if (beta[j]) for (let i = 0; i < n; i++) r[i] -= Z[j][i] * beta[j];
  for (let it = 0; it < 300; it++) { let mc = 0;
    for (let j = 0; j < p; j++) { const z = Z[j]; let rho = 0; for (let i = 0; i < n; i++) rho += z[i] * r[i]; rho = rho / n + beta[j];
      const nb = rho > lam ? rho - lam : rho < -lam ? rho + lam : 0; const d = nb - beta[j];
      if (d !== 0) { for (let i = 0; i < n; i++) r[i] -= z[i] * d; beta[j] = nb; if (Math.abs(d) > mc) mc = Math.abs(d); } }
    if (mc < 1e-7) break; }
  return beta;
}
function lassoSelect(Z, yc) {
  const n = yc.length, p = Z.length; if (!p) return [];
  let lmax = 0; for (let j = 0; j < p; j++) lmax = Math.max(lmax, Math.abs(dot(Z[j], yc)) / n);
  if (lmax < 1e-12) return [];
  const grid = []; for (let i = 0; i < 20; i++) grid.push(lmax * Math.pow(10, -3 * i / 19));
  const K = 5, fold = Math.floor(n / K), mse = grid.map(() => []);
  for (let f = 0; f < K; f++) { const lo = f * fold, hi = f === K - 1 ? n : lo + fold;
    const tr = [], te = []; for (let i = 0; i < n; i++) (i >= lo && i < hi ? te : tr).push(i);
    const Zt = Z.map(z => tr.map(i => z[i])), mu = mean(tr.map(i => yc[i])), yt = tr.map(i => yc[i] - mu); let beta = new Array(p).fill(0);
    grid.forEach((lam, gi) => { beta = lassoFit(Zt, yt, lam, beta, tr.length); let s = 0;
      for (const i of te) { let pr = mu; for (let j = 0; j < p; j++) pr += Z[j][i] * beta[j]; s += (yc[i] - pr) ** 2; } mse[gi].push(s / te.length); }); }
  const m = mse.map(mean), se = mse.map(v => sdev(v) / Math.sqrt(K));
  let bi = 0; m.forEach((v, i) => { if (v < m[bi]) bi = i; });
  let ci = bi; for (let i = 0; i <= bi; i++) if (m[i] <= m[bi] + se[bi]) { ci = i; break; }
  let beta = new Array(p).fill(0); for (let i = 0; i <= ci; i++) beta = lassoFit(Z, yc, grid[i], beta, n);
  const sup = []; beta.forEach((b, j) => { if (Math.abs(b) > 1e-9) sup.push(j); }); return sup;
}
function ridgeFit(Zs, yc) {
  const n = yc.length, q = Zs.length;
  if (!q) return { beta: [], loo: Math.sqrt(mean(yc.map(v => v * v)) * n / Math.max(1, n - 1)), lam: 0 };
  const XtX = []; for (let a = 0; a < q; a++) { XtX.push([]); for (let b = 0; b < q; b++) XtX[a].push(dot(Zs[a], Zs[b])); }
  const Xty = Zs.map(z => dot(z, yc)); let best = null;
  for (const g of [1e-4, 1e-3, 1e-2, 1e-1, 1]) { const lam = g * n;
    const A = XtX.map((row, i) => row.map((v, j) => v + (i === j ? lam : 0))), Ai = inv(A); if (!Ai) continue;
    const beta = Ai.map(row => dot(row, Xty)); let s = 0;
    for (let i = 0; i < n; i++) { const x = Zs.map(z => z[i]); let pr = 0, h = 1 / n; for (let a = 0; a < q; a++) { pr += x[a] * beta[a]; for (let b = 0; b < q; b++) h += x[a] * Ai[a][b] * x[b]; }
      s += ((yc[i] - pr) / (1 - h)) ** 2; }
    const loo = Math.sqrt(s / n); if (!best || loo < best.loo) best = { beta, loo, lam }; }
  return best || { beta: new Array(q).fill(0), loo: sdev(yc), lam: 0 };
}
function fitBatch(rows, feats, S) {
  const n = rows.length, m = rows.map(r => mOf(r, S)); let smw = 0, smm = 0;
  for (let i = 0; i < n; i++) { smw += m[i] * rows[i].w; smm += m[i] * m[i]; }
  const c = smw / smm, y = rows.map((r, i) => r.w - c * m[i]), ybar = mean(y), yc = y.map(v => v - ybar);
  const kept = [];
  feats.forEach(f => { const col = rows.map(f[2]), mj = mean(col), sj = sdev(col); if (sj > 1e-7 * Math.max(1, Math.abs(mj))) kept.push({ key: f[0], name: f[1], get: f[2], mu: mj, sd: sj }); });
  const Z = kept.map(k => rows.map(r => (k.get(r) - k.mu) / k.sd));
  const sup = lassoSelect(Z, yc), rf = ridgeFit(sup.map(j => Z[j]), yc);
  return { c, ybar, sfeat: sup.map(j => kept[j]), beta: rf.beta, loo: rf.loo, lam: rf.lam, nKept: kept.length, S };
}
const zvec = (mod, r) => mod.sfeat.map(k => (k.get(r) - k.mu) / k.sd);
function predBatch(mod, r) { const z = zvec(mod, r); let p = mod.c * mOf(r, mod.S) + mod.ybar; for (let j = 0; j < z.length; j++) p += mod.beta[j] * z[j]; return p; }
function rlsNew(mod, S) { const q = mod.sfeat.length + 1; const P = []; for (let i = 0; i < q; i++) { P.push(new Array(q).fill(0)); P[i][i] = 100; } return { th: new Array(q).fill(0), P, q, lam: S.lambdaF }; }
function rlsPred(st, mod, r) { const x = [1].concat(zvec(mod, r)); return mod.c * mOf(r, mod.S) + dot(st.th, x); }
function rlsUpdate(st, mod, r) {
  const x = [1].concat(zvec(mod, r)), q = st.q, y = r.w - mod.c * mOf(r, mod.S);
  const Px = st.P.map(row => dot(row, x)), den = st.lam + dot(x, Px), k = Px.map(v => v / den), e = y - dot(st.th, x);
  for (let i = 0; i < q; i++) st.th[i] += k[i] * e;
  const xP = x.map((_, j) => { let s = 0; for (let i = 0; i < q; i++) s += x[i] * st.P[i][j]; return s; });
  let tr = 0; for (let i = 0; i < q; i++) for (let j = 0; j < q; j++) st.P[i][j] = (st.P[i][j] - k[i] * xP[j]) / st.lam;
  for (let i = 0; i < q; i++) tr += st.P[i][i]; const lim = 1000 * q; if (tr > lim) for (let i = 0; i < q; i++) for (let j = 0; j < q; j++) st.P[i][j] *= lim / tr;
}
function cusum(z, k, h) { let sp = 0, sn = 0, start = 0, startN = 0;
  for (let i = 0; i < z.length; i++) {
    if (sp === 0) start = i; if (sn === 0) startN = i;
    sp = Math.max(0, sp + z[i] - k); sn = Math.max(0, sn - z[i] - k);
    if (sp > h) return { at: i, start, dir: 1 }; if (sn > h) return { at: i, start: startN, dir: -1 }; }
  return null; }
/* fb estimate: weight each past bottle would have had at today's anticipation, using physics slope: w + (-aSign*c*rhoQ)*(aNow - a_j) */
function fbEstimate(lab, aNow, c, S) { const w = lab.slice(-20); return mean(w.map(r => r.w - S.aSign * c * uS(r) * (aNow - r.a))); }
const pOut = (sd, band, mu) => { if (!(sd > 0)) return 0; return 1 - (Phi((band - mu) / sd) - Phi((-band - mu) / sd)); };
const r1 = x => Math.round(x * 10) / 10;

function analyzeHead(recsAll, Sin, depth) {
  const S = Object.assign({}, DEFAULTS, Sin || {}); depth = depth || 0;
  const recs0 = recsAll.slice(-S.window), last = recs0[recs0.length - 1];
  const res = { head: last.head, status: 'wait', mode: 'none', action: 'none', checks: [], vars: [], reasons: [], depth };
  const target = last.target, t1 = last.t1, t2 = last.t2, PCT = !!last.pct;
  if (PCT) { S.maxStep = S.maxStepPct; S.dynMax = S.dynMaxPct; }
  const aNow = PCT ? median(recs0.slice(-10).map(r => r.a)) : last.a; res.unit = PCT ? 'pct' : 'ms';
  res.aNow = aNow; res.aNew = aNow; res.delta = 0; res.n = recs0.length;
  // outlier cleaning of labels
  const lab0 = recs0.filter(r => isFinite(r.w)), med = median(lab0.map(r => r.w)), mad = median(lab0.map(r => Math.abs(r.w - med)));
  const thr = Math.max(6 * 1.4826 * mad, 3 * t2); let nOut = 0;
  const recs = recs0.map(r => { if (isFinite(r.w) && Math.abs(r.w - med) > thr) { nOut++; return Object.assign({}, r, { w: NaN }); } return r; });
  res.nOutliers = nOut;
  let feats = FEATS.filter(f => { const k = recs.filter(r => isFinite(r.w)); return k.length && k.filter(r => isFinite(f[2](r))).length >= 0.98 * k.length; });
  const need = r => feats.every(f => isFinite(f[2](r)));
  const lab = recs.filter(r => isFinite(r.w) && need(r));
  const N = lab.length; res.nLab = N;
  const recent = lab.slice(-S.recentN), rw = recent.map(r => r.w);
  const st = { target, t1, t2, n: recs0.length, nLab: N, mean: mean(rw), sd: sdev(rw), recentN: rw.length };
  st.err = st.mean - target; st.pOutT1 = rw.filter(w => Math.abs(w - target) > t1).length / (rw.length || 1); st.pOutT2 = rw.filter(w => Math.abs(w - target) > t2).length / (rw.length || 1);
  res.stats = st;
  res.series = lab.slice(-S.serN).map(r => ({ k: r.idx, w: r.w, a: r.a, Q: r.Q, rho: r.rho, T: r.T, P: r.P }));
  res.recentW = lab.slice(-100).map(r => r.w);
  res.conditions = {};
  if (N < Math.max(S.minN, 16) || recs.length < 12) {
    res.reasons.push('only ' + N + ' bottles with a weight so far (need at least ' + Math.max(S.minN, 16) + ')');
    res.sufficiency = { have: N, need: S.minN, ok: false };
    res.checks.push({ ok: false, label: 'Enough weighed bottles', detail: N + ' of ' + S.minN + ' minimum' });
    if (depth > 0 && N >= 8) { /* handled below via feedback path */ } else return finishWait(res, S);
  }
  // ---- physics prior scale & sanity
  const c0 = (() => { let a = 0, b = 0; lab.forEach(r => { const m = mOf(r, S); a += m * r.w; b += m * m; }); return a / b; })();
  if (!(c0 > 0)) { res.reasons.push(PCT ? 'weights do not follow the closing point (check the column mapping: the closing value must be a % of the setpoint)' : 'weights do not follow density × flow × time (check the column mapping and units)'); return finishWait(res, S); }
  const nowRecs = recs.slice(-S.nowWindow);
  const meanRQ = mean(nowRecs.map(uS));
  const sPrior = -S.aSign * c0 * meanRQ;
  res.sPrior = sPrior;
  // 'before' = recent bottles expressed at the setpoint in use NOW (physics slope), so older setpoints do not blur the picture
  res.recentW = lab.slice(-100).map(r => r.w - S.aSign * c0 * uS(r) * (aNow - r.a));
  const aim = target + S.aimOffset;

  // ---- validation split (time ordered): train on older, test on newer
  let learned = null, fb = null;
  const nHold = Math.max(12, Math.round(N * S.holdFrac)), nTrain = N - nHold;
  let drift = { flag: false };
  if (N >= Math.max(S.minN, 16) && nTrain >= 20) {
    const tr = lab.slice(0, nTrain), ho = lab.slice(nTrain);
    const modTr = fitBatch(tr, feats, S);
    const rls = rlsNew(modTr, S); const rlsP = [];
    lab.forEach((r, i) => { if (i >= nTrain) rlsP.push(rlsPred(rls, modTr, r)); rlsUpdate(rls, modTr, r); });
    const pRidge = ho.map(r => predBatch(modTr, r)), pPhys = ho.map(r => modTr.c * mOf(r, S) + modTr.ybar);
    const pFb = ho.map((r, k) => { const past = lab.slice(Math.max(0, nTrain + k - 20), nTrain + k); return fbEstimate(past, r.a, modTr.c, S); });
    const mse = p => mean(ho.map((r, i) => (r.w - p[i]) ** 2));
    const m = { ridge: mse(pRidge), rls: mse(rlsP), phys: mse(pPhys), fb: mse(pFb) };
    const bestKind = m.rls < m.ridge ? 'RLS' : 'Ridge'; const mLearn = Math.min(m.ridge, m.rls);
    learned = { kind: bestKind, mse: mLearn, rmse: Math.sqrt(mLearn) }; fb = { mse: m.fb };
    res.validation = { mseFeedback: m.fb, mseRidge: m.ridge, mseRLS: m.rls, msePhysics: m.phys, nHold: ho.length, nTrain };
    // drift: CUSUM on residuals of fixed model trained on older data
    if (depth === 0) { const sig0 = 1.25 * Math.max(modTr.loo, 1e-6), e = ho.map((r, i) => r.w - pRidge[i]), cu = cusum(e.map(v => v / sig0), 1.0, 10);
      if (cu) { const seg = e.slice(cu.start, cu.at + 1), shift = mean(seg);
        // alarm only if the shift is also practically meaningful (>= 25% of T1)
        if (Math.abs(shift) >= 0.25 * t1) drift = { flag: true, at: ho[Math.min(cu.at, ho.length - 1)].idx, startRow: nTrain + cu.start, dir: cu.dir, shift }; } }
  }
  res.drift = drift;
  if (drift.flag && depth === 0) {
    // re-learn from the newer data only
    const cut = Math.max(0, drift.startRow - 3); const firstIdx = lab[Math.min(cut, lab.length - 1)].idx;
    const sub = recsAll.filter(r => r.idx >= firstIdx);
    const r2 = analyzeHead(sub, Sin, 1); r2.drift = drift; r2.driftNote = 'A change was detected around bottle ' + drift.at + '. Learning from newer bottles only.';
    r2.reasons.unshift('change detected around bottle ' + drift.at); return r2;
  }

  // ---- final fit on all usable data
  let mode = 'feedback', kind = 'Feedback', mod = null, rlsF = null;
  const checks = [];
  let suff = { have: N, need: S.minN, ok: N >= S.minN };
  let beats = false, inRange = true, slopeOK = true;
  if (learned && N >= S.minN) {
    mod = fitBatch(lab, feats, S); rlsF = rlsNew(mod, S); lab.forEach(r => rlsUpdate(rlsF, mod, r));
    const p = 2 + mod.sfeat.length, sig = Math.max(learned.rmse, 1e-6), eps = Math.max(S.epsFrac * t1, 1e-6), z = probit(1 - S.delta / 2);
    const needN = Math.max(S.minN, Math.ceil(z * z * sig * sig * p / (eps * eps)));
    const haveN = learned.kind === 'RLS' ? Math.min(N, Math.round(1 / (1 - S.lambdaF))) : N;
    suff = { have: haveN, need: needN, ok: haveN >= needN, p, sigma: sig, eps, z };
    beats = learned.mse < S.trustMargin * fb.mse;
    // envelope check on the conditions "now"
    const bad = [];
    [['rho', 'density'], ['Q', 'flow'], ['T', 'temperature'], ['P', 'tank pressure'], ['t', 'dose time']].forEach(([k, nm]) => {
      const f = FEATS.find(x => x[0] === k); if (!feats.includes(f)) return;
      const col = lab.map(f[2]), lo = Math.min(...col), hi = Math.max(...col), R = hi - lo, v = mean(nowRecs.map(f[2]).filter(isFinite));
      const tol = 0.1 * R + 1e-9 * Math.max(1, Math.abs(hi), Math.abs(lo)); if (v < lo - tol || v > hi + tol) bad.push(nm); });
    inRange = bad.length === 0; res.outOfRange = bad;
    mode = (suff.ok && beats && inRange) ? 'learned' : 'feedback'; kind = mode === 'learned' ? learned.kind : 'Feedback';
    res.model = { name: learned.kind, c: mod.c, lasso: mod.sfeat.map(k => k.name), loo: mod.loo };
    res.vars = mod.sfeat.map((k, j) => ({ key: k.key, name: k.name, effect: mod.beta[j], sd: k.sd }));
  }
  checks.push({ ok: suff.ok, label: 'Enough data to trust a model', detail: suff.have + ' usable bottles, ' + suff.need + ' needed' + (suff.sigma ? ' (to estimate the average within ±' + suff.eps.toFixed(2) + ' g at ' + Math.round((1 - S.delta) * 100) + '% confidence)' : '') });
  checks.push({ ok: beats, label: 'Model beats simple weight feedback on newer bottles', detail: learned ? 'error ' + Math.sqrt(learned.mse).toFixed(2) + ' g vs ' + Math.sqrt(fb.mse).toFixed(2) + ' g' : 'not enough data to test' });
  checks.push({ ok: inRange, label: 'Today’s conditions are within the range seen', detail: inRange ? 'yes' : 'outside: ' + (res.outOfRange || []).join(', ') });
  checks.push({ ok: !drift.flag, label: 'No unexplained change in the process', detail: drift.flag ? 'change near bottle ' + drift.at : 'none detected' });

  // ---- estimate current mean weight and slope
  let wNow, slope, predf = null;
  if (mode === 'learned') {
    const rows = nowRecs.map(r => Object.assign({}, r, { a: aNow })).filter(need);
    predf = learned.kind === 'RLS' ? (r => rlsPred(rlsF, mod, r)) : (r => predBatch(mod, r));
    wNow = mean(rows.map(predf));
    const ja = mod.sfeat.findIndex(k => k.key === 'a');
    const bA = ja < 0 ? 0 : (learned.kind === 'RLS' ? rlsF.th[ja + 1] : mod.beta[ja]);
    slope = sPrior + (ja >= 0 ? bA / mod.sfeat[ja].sd : 0);
    if (!(S.aSign * slope < 0) || Math.abs(slope) < 0.4 * Math.abs(sPrior) || Math.abs(slope) > 2.5 * Math.abs(sPrior)) { slope = sPrior; res.reasons.push('anticipation effect taken from physics (data did not confirm it)'); }
  } else {
    wNow = fbEstimate(lab, aNow, c0, S); slope = sPrior;
    if (learned) { const why = []; if (!suff.ok) why.push('not enough data for a model'); if (!beats) why.push('the model did not beat simple weight feedback'); if (!inRange) why.push('conditions are outside the range seen');
      res.reasons.push('using simple feedback because ' + why.join(' and ')); }
  }
  res.wNow = wNow; res.slope = slope; res.mode = mode;
  if (mode === 'learned') {
    const typ = {}, nowv = {}; FEATS.forEach(f => { const col = lab.map(f[2]).filter(isFinite); typ[f[0]] = col.length ? mean(col) : NaN; const cn = nowRecs.map(f[2]).filter(isFinite); nowv[f[0]] = cn.length ? mean(cn) : typ[f[0]]; });
    const mk = over => Object.assign({}, typ, { a: aNow, pct: last.pct, target }, over || {}), base = predf(mk());
    const items = feats.filter(f => f[0] !== 'a').map(f => { const k = f[0], sdv = sdev(lab.map(f[2]).filter(isFinite));
      const eff = (predf(mk({ [k]: typ[k] + sdv })) - predf(mk({ [k]: typ[k] - sdv }))) / 2;
      return { key: k, name: f[1], delta: predf(mk({ [k]: nowv[k] })) - base, typical: typ[k], now: nowv[k], swing: sdv, perSwing: eff, learned: mod.sfeat.some(x => x.key === k) }; });
    const other = wNow - base - items.reduce((a, b) => a + b.delta, 0);
    res.explain = { base, items, other, typ, nowv };
  } else res.explain = null;
  checks.push({ ok: true, label: 'Step limited to ±' + (PCT ? S.maxStep.toFixed(2) + ' %' : S.maxStep + ' ms') + ', PLC keeps authority', detail: 'recommendation only' });
  res.checks = checks; res.sufficiency = suff; res.validation = res.validation || null;

  // ---- recommendation
  const e = wNow - aim, gain = mode === 'learned' ? 1 : S.fbGain, dead = Math.max(S.deadbandFrac * t1, 1e-6);
  let delta = 0, clamped = false; res.rawDelta = gain * (aim - wNow) / slope; res.gain = gain; res.inDead = Math.abs(e) < dead; res.dead = dead;
  if (Math.abs(e) >= dead) { delta = gain * (aim - wNow) / slope; if (Math.abs(delta) > S.maxStep) { delta = Math.sign(delta) * S.maxStep; clamped = true; } }
  let aNew = aNow + delta; if (S.aMin != null) aNew = Math.max(S.aMin, aNew); if (S.aMax != null) aNew = Math.min(S.aMax, aNew);
  aNew = RD(aNew, PCT); delta = RD(aNew - aNow, PCT);
  res.aNew = aNew; res.delta = delta; res.clamped = clamped; res.err = e; res.action = delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'keep';
  st.expPOutT1 = pOut(st.sd, t1, 0);
  res.shift = (delta === 0) ? 0 : slope * delta;
  const RC = { lab, nowRecs, predf, mod, learned, feats, S, aim, aNow, aNew, slope, wNow, target, t1, t2, c0, Sn: S.serN, Sw: S.nowWindow };
  if (mode === 'learned') replayLearned(res, RC); else replayFeedback(res, RC);
  res.spreadBad = (res.after ? res.after.sd : st.sd) > S.spreadFrac * t1;
  res.status = res.spreadBad ? 'check' : ((res.action === 'keep' && !res.hasComp) ? 'ok' : 'adjust');
  describe(res, S); buildTrace(res, S); addPct(res); return res;
}

/* % mode: expose the closing point itself (100 - shortfall) and the law as 'threshold change per unit' */
function addPct(res) {
  if (res.unit !== 'pct') return;
  res.cNow = +(100 - res.aNow).toFixed(2); res.cNew = +(100 - res.aNew).toFixed(2); res.dC = +(res.cNew - res.cNow).toFixed(2);
  if (res.comp) { res.comp.cBase = res.cNew; res.comp.cGoal = +(100 - res.comp.aGoal).toFixed(2); res.comp.terms.forEach(t => { t.kc = -t.k; }); res.comp.all.forEach(t => { t.kc = -t.k; }); }
  if (res.series) res.series.forEach(p => { p.c = 100 - p.a; p.cDyn = 100 - p.aDyn; });
}
/* Replay: the same recent bottles (same flow, density, temperature, pressure and the same random noise) with
   (a) today's fixed anticipation, (b) the proposed base only, (c) the proposed base + compensation law, (d) the goal after all rounds. */
function replayLearned(res, c) {
  const { lab, nowRecs, predf, feats, S, aim, aNow, aNew, slope, wNow, target, t1, t2, Sn } = c;
  const W = lab.slice(-S.serN), last = a => a.slice(-Sn);
  const aClamp = a => { if (S.aMin != null) a = Math.max(S.aMin, a); if (S.aMax != null) a = Math.min(S.aMax, a); return Math.max(0, a); };
  const ph = W.map(predf), e = W.map((r, i) => r.w - ph[i]);
  const ref = {}, sdv = {}, lo = {}, hi = {};
  FEATS.forEach(f => { const k = f[0], all = lab.map(f[2]).filter(isFinite).sort((x, y) => x - y), v = nowRecs.map(f[2]).filter(isFinite);
    ref[k] = v.length ? mean(v) : (all.length ? mean(all) : NaN); sdv[k] = all.length ? sdev(all) : 0;
    lo[k] = all.length ? all[Math.floor(0.01 * (all.length - 1))] : NaN; hi[k] = all.length ? all[Math.ceil(0.99 * (all.length - 1))] : NaN; });
  ref.a = aNow;
  ref.pct = lab[0].pct; ref.target = target;
  const mkRow = over => Object.assign({}, ref, over || {});
  const terms = [];
  ['Q', 'rho', 'T', 'P'].forEach(k => { const f = FEATS.find(x => x[0] === k); if (!feats.includes(f) || !(sdv[k] > 0)) return;
    const h = 0.5 * sdv[k], g = (predf(mkRow({ [k]: ref[k] + h })) - predf(mkRow({ [k]: ref[k] - h }))) / (2 * h), kk = -g / slope;
    terms.push({ key: k, name: f[1], ref: ref[k], k: kk, g, sd: sdv[k], impactG: Math.abs(g) * sdv[k], impactMs: Math.abs(kk) * sdv[k], lo: lo[k], hi: hi[k] }); });
  const keep = terms.filter(tm => tm.impactG >= Math.max(0.05, 0.02 * t1));
  const dynOf = r => { let d = 0; keep.forEach(tm => { d += tm.k * (clamp(r[tm.key], tm.lo, tm.hi) - tm.ref); }); return clamp(d, -S.dynMax, S.dynMax); };
  const aGoal = aClamp(aNow + (aim - wNow) / slope);
  // replay: each bottle's measured weight, moved by the physical effect of the anticipation that would have been used instead (slope scaled by that bottle's density x flow)
  const mrq = mean(nowRecs.map(uS)) || 1, slI = r => slope * uS(r) / mrq;
  const pAt = (base, dyn) => W.map(r => r.w + slI(r) * (aClamp(base + (dyn ? dynOf(r) : 0)) - r.a));
  const bef = W.map(r => r.w + slI(r) * (aNow - r.a));
  const aft = pAt(aNew, true), fix = pAt(aNew, false), gl = pAt(aGoal, true), aDyn = W.map(r => aClamp(aNew + dynOf(r)));
  const PS = arr => projectStats(last(arr), target, t1, t2, 0);
  res.before = PS(bef); res.after = PS(aft); res.afterFixed = PS(fix); res.goal = PS(gl);
  res.distNow = last(bef); res.distAfter = last(aft); res.distFixed = last(fix); res.distGoal = last(gl);
  res.hasComp = keep.length > 0 && res.after.sd <= 0.9 * res.afterFixed.sd;
  const ve = Math.pow(sdev(last(e)), 2), v = arr => Math.pow(sdev(last(arr)), 2), bi = arr => Math.pow(mean(last(arr)) - aim, 2);
  res.decomp = { before: { bias2: bi(bef), cond: Math.max(0, v(bef) - ve), noise: ve }, after: { bias2: bi(aft), cond: Math.max(0, v(aft) - ve), noise: ve },
    fixed: { bias2: bi(fix), cond: Math.max(0, v(fix) - ve), noise: ve }, goal: { bias2: bi(gl), cond: Math.max(0, v(gl) - ve), noise: ve } };
  const tot = v(bef) || 1e-12, condFrac = Math.min(1, res.decomp.before.cond / tot), sumI = terms.reduce((a, t) => a + t.impactG * t.impactG, 0) || 1;
  res.varShare = terms.map(tm => ({ key: tm.key, name: tm.name, share: condFrac * tm.impactG * tm.impactG / sumI })).sort((a, b) => b.share - a.share);
  res.noiseShare = Math.min(1, ve / tot);
  res.comp = { terms: keep, all: terms, base: aNew, dynMax: S.dynMax, ref, sdBefore: res.before.sd, sdAfter: res.after.sd, sdFixed: res.afterFixed.sd, on: res.hasComp, aGoal: RD(aGoal, !!ref.pct) };
  res.series = W.map((r, i) => ({ k: r.idx, w: r.w, a: r.a, Q: r.Q, rho: r.rho, T: r.T, P: r.P, wNow: bef[i], wDyn: aft[i], wFix: fix[i], aDyn: aDyn[i] }));
}
function replayFeedback(res, c) {
  const { lab, c0, S, aNow, aNew, wNow, aim, target, t1, t2, Sn, Sw } = c;
  const W = lab.slice(-S.serN), last = a => a.slice(-Sn), sh = res.shift, goalShift = aim - wNow;
  const adj = W.map(r => r.w - S.aSign * c0 * uS(r) * (aNow - r.a)), base = mean(adj.slice(-Sw)), cen = adj.map(v => v - base + wNow);
  const PS = (arr, d) => projectStats(last(arr), target, t1, t2, d);
  res.before = PS(cen, 0); res.after = PS(cen, sh); res.afterFixed = res.after; res.goal = PS(cen, goalShift);
  res.distNow = last(cen); res.distAfter = last(cen).map(v => v + sh); res.distFixed = res.distAfter; res.distGoal = last(cen).map(v => v + goalShift);
  res.hasComp = false; res.comp = null; res.decomp = null; res.varShare = null;
  res.series = W.map((r, i) => ({ k: r.idx, w: r.w, a: r.a, Q: r.Q, rho: r.rho, T: r.T, P: r.P, wNow: cen[i], wDyn: cen[i] + sh, wFix: cen[i] + sh, aDyn: aNew }));
}

/* unit-aware wording: % mode talks about the closing point (% of setpoint), ms mode about the anticipation (ms) */
function UW(res, S) { const P = res.unit === 'pct', f2 = x => Math.abs(x).toFixed(2);
  return { P, lv: a => P ? (100 - a).toFixed(2) + ' %' : (+a).toFixed(1) + ' ms', step: P ? '±' + f2(S.maxStep) + ' %' : '±' + S.maxStep + ' ms', dyn: P ? '±' + f2(S.dynMax) + ' %' : '±' + S.dynMax + ' ms',
    dlv: d => P ? (d <= 0 ? '+' : '−') + f2(d) + ' %' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' ms', need: d => P ? (d <= 0 ? '+' : '−') + f2(d) + ' %' : (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(1) + ' ms',
    lever: P ? '1 % of the closing point' : '1 ms of closing anticipation', per: P ? 'g/%' : 'g/ms', kk: t => P ? -t.k : t.k, ku: P ? '% per unit' : 'ms per unit', iu: P ? ' %' : ' ms', name: P ? 'closing point' : 'anticipation' }; }
function buildTrace(res, S) {
  const U = UW(res, S);
  const st = res.stats, g = (x, d) => Math.abs(x).toFixed(d == null ? 1 : d), sg = (x, d) => (x >= 0 ? '+' : '−') + g(x, d == null ? 1 : d), tg = st.target;
  const T = []; const ex = res.explain;
  if (res.status === 'wait') { res.trace = [{ t: 'Not enough data', x: 'Only ' + res.nLab + ' weighed bottles for this head; at least ' + S.minN + ' are needed before any recommendation. The setpoint is left as it is.' }]; res.reason = 'Only ' + res.nLab + ' weighed bottles so far.'; return; }
  const dir = res.err > 0 ? 'heavier' : 'lighter';
  T.push({ t: '1 · Where this head is', x: 'Weighed bottles average ' + g(st.mean, 1) + ' g against a target of ' + g(tg, 1) + ' g. ' + (res.mode === 'learned' ? 'At today’s conditions the model expects ' + g(res.wNow, 1) + ' g, which is ' + g(res.err, 1) + ' g ' + (res.err > 0 ? 'too heavy.' : 'too light.') :
    'Corrected to the setpoint in use now, the last 20 bottles average ' + g(res.wNow, 1) + ' g (' + g(res.err, 1) + ' g ' + (res.err > 0 ? 'too heavy' : 'too light') + ').') });
  if (ex) {
    const setEff = ex.base - tg, top = ex.items.filter(i => Math.abs(i.delta) >= 0.05).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    T.push({ t: '2 · What causes it', x: 'Setpoint: at this head’s typical conditions and the ' + U.name + ' now in use (' + U.lv(res.aNow) + ') it would fill ' + g(ex.base, 1) + ' g (' + sg(setEff) + ' g vs target). ' +
      (top.length ? 'Today’s conditions then move it by ' + sg(res.wNow - ex.base) + ' g: ' + top.map(i => i.name + ' ' + sg(i.delta, 2) + ' g (' + (i.now > i.typical ? 'higher' : 'lower') + ' than usual)').join(', ') + '.' : 'Today’s conditions are close to this head’s usual, so they change almost nothing.') });
    if (res.inDead) res.reason = 'Already close enough: expected error ' + sg(res.err) + ' g is inside the ±' + g(res.dead, 1) + ' g dead-band, so no change.' + (top.length ? ' Biggest influence today: ' + top[0].name + ' ' + sg(top[0].delta, 1) + ' g, offset by the setpoint.' : '');
    else res.reason = Math.abs(setEff) >= Math.abs(res.wNow - ex.base) ? 'Mostly the setpoint: it gives ' + sg(setEff) + ' g at usual conditions.' + (top.length ? ' Today ' + top[0].name + ' adds ' + sg(top[0].delta, 1) + ' g.' : '') : 'Mostly today’s conditions: ' + (top[0] ? top[0].name + ' ' + sg(top[0].delta, 1) + ' g' : 'no single variable') + '.';
  } else {
    T.push({ t: '2 · Why simple feedback', x: 'The learned model is not used for this head: ' + ((res.reasons || []).join('; ') || 'not trusted yet') + '. The suggestion is the weight error divided by how much ' + (U.P ? 'one percent of the closing point' : 'one millisecond') + ' changes the weight, applied at ' + Math.round(S.fbGain * 100) + '% strength.' });
    res.reason = 'Simple feedback on the last 20 bottles (learned model not trusted yet).';
  }
  if (res.hasComp && res.comp) res.reason += ' Following the conditions cuts σ ' + g(res.comp.sdFixed, 2) + ' → ' + g(res.comp.sdAfter, 2) + ' g.';
  T.push({ t: '3 · The lever', x: U.lever + ' changes the bottle weight by about ' + g(res.slope, U.P ? 2 : 3) + ' g (' + (U.P ? 'a lower closing point closes earlier and gives less product' : (S.aSign > 0 ? 'closing earlier gives less product' : 'closing earlier gives more product')) + (U.P ? '; from the setpoint weight' : '; from density × flow') + (ex && res.model && res.model.lasso.indexOf('closing anticipation (own effect)') >= 0 ? ' plus the effect learned from your data' : '') + ').' });
  const lim = res.inDead ? 'The error is inside the dead-band (±' + g(res.dead, 2) + ' g), so the base is not changed.' : res.clamped ? 'That is more than the safe step of ' + U.step + ', so it is limited. It will take several rounds.' : 'Within the safe step of ' + U.step + '.';
  T.push({ t: '4 · The base value', x: g(res.err, 2) + ' g ÷ ' + g(res.slope, U.P ? 2 : 3) + ' ' + U.per + (res.gain < 1 ? ' × ' + res.gain + ' (feedback strength)' : '') + ' = ' + U.need(res.rawDelta) + ' needed' + (U.P ? ' on the closing point' : '') + '. ' + lim + (res.action !== 'keep' ? ' Proposed base: ' + U.lv(res.aNow) + ' → ' + U.lv(res.aNew) + '.' : '') });
  if (res.comp && res.comp.terms.length) {
    const c = res.comp, f = x => (x >= 0 ? '+' : '−') + Math.abs(+x.toPrecision(2)), nm = c.terms.map(t => t.name + ' ' + f(U.kk(t)) + ' ' + U.ku + ' (usual swing ±' + (+t.sd.toPrecision(2)) + ' → ±' + g(t.impactMs, U.P ? 2 : 1) + U.iu + ')').join('; ');
    T.push({ t: '5 · Follow the conditions', x: 'Instead of one fixed value the ' + U.name + ' moves bottle by bottle: ' + nm + '. Replaying the same recent bottles, the spread goes from σ ' + g(c.sdFixed, 2) + ' g (fixed value) to σ ' + g(c.sdAfter, 2) + ' g' + (res.hasComp ? '.' : ' – too small a gain, so compensation is not proposed.') + ' The movement is limited to ' + U.dyn + ' and conditions are clamped to the range seen in your data.' });
  } else if (res.mode === 'learned') T.push({ t: '5 · Follow the conditions', x: 'Flow, density, temperature and pressure hardly move the weight of this head, so a fixed value is enough.' });
  const okc = res.checks.filter(c => c.ok).length; T.push({ t: T.length + 1 + ' · Safety checks', x: okc + ' of ' + res.checks.length + ' passed. ' + res.checks.filter(c => !c.ok).map(c => c.label).join('; ') + (okc === res.checks.length ? 'The PLC keeps authority; you apply the change.' : '') });
  if (res.status === 'check') T.push({ t: 'Spread warning', x: 'Bottle-to-bottle spread (σ ' + g(res.after ? res.after.sd : st.sd, 2) + ' g) is more than ' + Math.round(S.spreadFrac * 100) + '% of T1 (' + g(st.t1, 1) + ' g). The setpoint cannot reduce it; check the head mechanically.' });
  res.trace = T;
}

function finishWait(res, S) { if (res.stats) { res.before = res.after = null; } if (res.recentW && res.stats) { res.before = res.after = projectStats(res.recentW, res.stats.target, res.stats.t1, res.stats.t2, 0); res.shift = 0; }
  res.status = 'wait'; res.mode = 'none'; res.action = 'none'; res.headline = 'Collecting data – keep ' + (res.unit === 'pct' ? (100 - res.aNow).toFixed(2) + ' %' : r1(res.aNow) + ' ms'); res.advice = 'Not enough weighed bottles yet (' + res.nLab + ' of ' + S.minN + ' needed). No recommendation until then.'; buildTrace(res, S); return res; }
function describe(res, S) {
  const U = UW(res, S), st = res.stats, g = x => Math.abs(x).toFixed(1), g2 = x => Math.abs(x).toFixed(2);
  const srcTxt = res.mode === 'learned' ? 'learned model (' + res.model.name + ')' : 'simple weight feedback';
  const dir = res.err > 0 ? 'too heavy' : 'too light', cm = res.comp && res.comp.on ? res.comp.terms.map(t => t.name).join(', ') : '';
  const sdTxt = res.comp && res.comp.on ? 'σ ' + g2(res.comp.sdBefore) + ' → ' + g2(res.comp.sdAfter) + ' g' : '';
  if (res.status === 'check') {
    const sd = res.after ? res.after.sd : st.sd;
    res.headline = 'Check the head – weights spread too much';
    res.advice = 'Bottle-to-bottle spread (σ ' + g2(sd) + ' g' + (res.comp && res.comp.on ? ' even after compensating for conditions' : '') + ') is large compared with the tolerance (T1 ±' + g(st.t1) + ' g). Moving the setpoint cannot fix that: check valve, nozzle, air in product or seals.' +
      (res.action !== 'keep' ? ' Centering would still help: ' + (U.P ? (res.delta > 0 ? 'lower' : 'raise') + ' the closing point to ' : (res.delta > 0 ? 'raise' : 'lower') + ' anticipation to ') + U.lv(res.aNew) + '.' : '');
  } else if (res.action === 'keep' && !res.hasComp) {
    res.headline = 'Keep ' + U.lv(res.aNow) + ' – on target';
    res.advice = 'Expected average weight at today’s conditions is ' + g(res.err) + ' g ' + (res.err >= 0 ? 'above' : 'below') + ' target – inside the dead-band. No change needed.';
  } else if (res.action === 'keep') {
    res.headline = 'Keep base ' + U.lv(res.aNow) + ' and let it follow ' + cm;
    res.advice = 'The average is on target, but the weight moves with ' + cm + '. Letting the anticipation follow them cuts the spread (' + sdTxt + ').';
  } else {
    const up = res.delta > 0;
    res.headline = U.P ? (up ? 'Lower' : 'Raise') + ' the base closing point from ' + U.lv(res.aNow) + ' to ' + U.lv(res.aNew) + ' of the setpoint (' + U.dlv(res.delta) + ')' + (res.hasComp ? ' and let it follow ' + cm : '') :
      (up ? 'Raise' : 'Lower') + ' base anticipation from ' + r1(res.aNow) + ' to ' + r1(res.aNew) + ' ms (' + (up ? '+' : '') + r1(res.delta) + ')' + (res.hasComp ? ' and let it follow ' + cm : '');
    res.advice = 'At today’s conditions the average bottle is about ' + g(res.err) + ' g ' + dir + '. ' + (up ? 'Closing earlier gives less product.' : 'Closing later gives more product.') +
      (res.clamped ? ' Step limited to ' + U.step + ' – re-run after it has been applied and weighed.' : '') + (res.hasComp ? ' Compensation for ' + cm + ' cuts the spread (' + sdTxt + ').' : '') + ' Source: ' + srcTxt + '.';
  }
  if (res.reasons && res.reasons.length) res.advice += ' Note: ' + res.reasons.join('; ') + '.';
}


/* Before / proposed statistics from the same recent bottles; 'proposed' = same bottles moved by the expected effect of the change. */
function capability(m, sd, target, t1) {
  const lsl = target - t1, usl = target + t1, ok = sd > 1e-9, cp = ok ? (usl - lsl) / (6 * sd) : 99, cpk = ok ? Math.min(usl - m, m - lsl) / (3 * sd) : (m >= lsl && m <= usl ? 99 : 0);
  return { cp: Math.min(cp, 9.99), cpk: Math.max(0, Math.min(cpk, 9.99))   /* 0 = the average is outside the limits */, ppm: Math.round(1e6 * pOut(sd, t1, m - target)) };
}
function projectStats(w, target, t1, t2, shift) {
  if (!w || w.length < 8) return null;
  const x = w.map(v => v + shift), n = x.length, m = mean(x), sd = sdev(x); let o1 = 0, o2 = 0, hv = 0, lt = 0;
  x.forEach(v => { const d = v - target; if (Math.abs(d) > t1) o1++; if (Math.abs(d) > t2) o2++; if (d > t1) hv++; if (d < -t1) lt++; });
  return Object.assign({ n, mean: m, err: m - target, sd, pOutT1: o1 / n, pOutT2: o2 / n, pHeavy: hv / n, pLight: lt / n, giveaway: Math.max(0, m - target) }, capability(m, sd, target, t1));
}
function summarize(results) {
  const keys = ['before', 'after', 'afterFixed', 'goal'], z = () => ({ o1: 0, o2: 0, abs: 0, give: 0, hv: 0, lt: 0, sd: 0, cpk: 0, cp: 0, ppm: 0 }), acc = {}, counts = { ok: 0, adjust: 0, check: 0, wait: 0 };
  keys.forEach(k => { acc[k] = z(); }); let W = 0, changed = 0;
  results.forEach(r => { counts[r.status]++; if (r.action === 'increase' || r.action === 'decrease' || r.hasComp) changed++;
    const b = r.before; if (!b) return; W += b.n;
    keys.forEach(k => { const s = r[k] || r.after || b, a = acc[k], w = b.n; a.o1 += w * s.pOutT1; a.o2 += w * s.pOutT2; a.abs += w * Math.abs(s.err); a.give += w * s.giveaway; a.hv += w * s.pHeavy; a.lt += w * s.pLight; a.sd += w * s.sd; a.cpk += w * Math.min(5, s.cpk); a.cp += w * Math.min(5, s.cp); a.ppm += w * s.ppm; }); });
  const nz = o => { const r = {}; for (const k in o) r[k] = W ? o[k] / W : 0; return { pOutT1: r.o1, pOutT2: r.o2, absErr: r.abs, giveaway: r.give, pHeavy: r.hv, pLight: r.lt, sd: r.sd, cpk: r.cpk, cp: r.cp, ppm: r.ppm }; };
  const out = { counts, changed, bottles: W }; keys.forEach(k => { out[k] = nz(acc[k]); }); const before = out.before, after = out.after;
  if (!W) out.headline = 'Not enough weighed bottles yet to compare.';
  else if (!changed) out.headline = 'No setpoint change is needed right now.';
  else out.headline = 'Applying the proposal on ' + changed + ' head' + (changed > 1 ? 's' : '') + ' is projected to raise Cpk from ' + before.cpk.toFixed(2) + ' to ' + after.cpk.toFixed(2) + ' and cut bottles outside T1 from ' + (before.pOutT1 * 100).toFixed(1) + '% to ' + (after.pOutT1 * 100).toFixed(1) + '%' +
    (before.giveaway - after.giveaway >= 0.05 ? ', with giveaway down from ' + before.giveaway.toFixed(2) + ' to ' + after.giveaway.toFixed(2) + ' kg per 1,000 bottles.' : '.');
  return out;
}

function groupByHead(records) { const by = {}; records.forEach(r => { (by[r.head] = by[r.head] || []).push(r); }); return by; }
function analyzeAll(records, S) {
  const by = groupByHead(records), heads = Object.keys(by).map(Number).sort((a, b) => a - b), out = [];
  heads.forEach(h => { by[h].sort((x, y) => x.idx - y.idx); out.push(analyzeHead(by[h], S)); }); return out;
}

/* ------------------------------ simulator ------------------------------ */
function Plant(o) {
  o = Object.assign({ seed: 1, nHeads: 10, target: 250, t1: 4, t2: 8, rhoNom: 1.05, qNom: 60, aStart: 60, noise: 0.25, delay: 14, scenario: 'demo', nCycles: 400, swing: 1, saw: 0 }, o || {});
  this.o = o; const R = rng(o.seed), N = makeNormal(R), N2 = makeNormal(rng(o.seed + 1000)); this.N = N;
  this.cyc = 0; this.fills = []; this.dRho = 0; this.pn = 0; this.tn = 0;
  this.h = []; const rnd = makeNormal(rng(o.seed + 7));
  for (let h = 0; h < o.nHeads; h++) { const tau = clamp(60 + 15 * rnd(), 35, 95), qs = 1 + 0.04 * rnd();
    this.h.push({ tau, qs, a: o.aStart, noise: o.noise, start: 0, tcmd: o.target / (o.rhoNom * o.qNom * qs) * 1000, tauAdd: 0 }); }
  if (o.scenario === 'demo' || o.scenario === 'drift') {
    this.h[3].a = this.h[3].tau - 32;           // head 4: far from ideal (too heavy? -> light) existing slow loop is slow
    this.h[6].noise = 3.0;                       // head 7: noisy valve
    this.h[9].start = o.nCycles - 25;            // head 10: just joined, little data
    this.h[1].driftAt = Math.floor(o.nCycles * 0.7); this.h[1].driftTau = 25; // head 2: seal wear step
  } else if (o.scenario === 'slow') {          // demo: heads start off target, machine's own feedback is slow
    const off = [-40, 30, -34, -52, 54, -22, 12, 40, -44, 0];
    this.h.forEach((x, i) => { x.a = Math.max(10, x.tau + off[i % off.length]); });
    this.h[6].noise = 3.0; this.h[9].start = o.nCycles - 25; this.h[1].driftAt = Math.floor(o.nCycles * 0.7); this.h[1].driftTau = 25;
  } else if (o.scenario === 'dynamic') {       // demo: moderate offsets, strong condition swings, slow built-in feedback
    const off = [-6, 8, -35, 4, 38, -9, 0, 7, -5, 0];
    this.h.forEach((x, i) => { x.a = Math.max(10, x.tau + off[i % off.length]); });
    this.h[6].noise = 3.0; this.h[9].start = o.nCycles - 25;
  } else if (o.scenario === 'clean') { this.h.forEach(x => { x.a = x.tau + 0; }); }
  if (o.closeUnit === 'pct') this.h.forEach(x => { x.c = 100 * (1 - x.a / x.tcmd); });
  this.lg = (o.scenario === 'slow' || o.scenario === 'dynamic') ? { every: 40, gain: 0.1, clamp: 1 } : { every: 20, gain: 0.3, clamp: 2 };
  this.R = R;
}
Plant.prototype.cycle = function (ctl) {
  const o = this.o, c = this.cyc, N = this.N, out = [];
  this.pn = 0.97 * this.pn + 0.002 * N(); this.tn = 0.99 * this.tn + 0.05 * N(); const sw = o.swing, saw = o.saw ? o.saw * 0.012 * (((c % 110) / 110) * 2 - 1) : 0;
  const P = 1.2 + sw * (0.01 * Math.sin(2 * Math.PI * c / 400) + this.pn) + saw, T = 20 + sw * (2.5 * Math.sin(2 * Math.PI * c / 900 + 1) + this.tn);
  this.dRho = 0.99 * this.dRho + 0.0002 * N(); const rhoT = o.rhoNom * (1 + this.dRho);
  for (let k = 0; k < o.nHeads; k++) {
    const H = this.h[k], eps = [N(), N(), N(), N(), N(), N()], PC = o.closeUnit === 'pct'; // fixed draws per bottle => paired experiments
    if (c < H.start) continue;
    if (H.driftAt != null && c >= H.driftAt) H.tauAdd = H.driftTau;
    const qT = o.qNom * H.qs * Math.sqrt(P / 1.2) * (1 + 0.002 * eps[0]), tauE = H.tau + H.tauAdd + 60 * (P - 1.2) + 2 * (T - 20);
    const meas = { Q: qT * (1 + 0.002 * eps[5]), rho: rhoT * (1 + 0.0005 * eps[2]), T: T + 0.05 * eps[4], P: P + 0.01 * eps[0] };
    const aEff = ctl && ctl.dyn ? ctl.dyn(k, meas) : (PC ? H.c : H.a), aMs = PC ? H.tcmd * (1 - aEff / 100) : aEff;
    const startup = c < 25; let mass = rhoT * qT * (H.tcmd - aMs + tauE) / 1000 + H.noise * eps[1];
    if (startup) mass += 3 + eps[2];
    if (Math.abs(eps[3]) > 3.0) mass = eps[4] > 0 ? 0 : 2 * mass;
    const f = { idx: this.fills.length, cycle: c, head: k + 1, a: aEff, t: H.tcmd, Q: meas.Q, rho: meas.rho,
      T: meas.T, P: meas.P, state: startup ? 'STARTUP' : 'RUN', target: o.target, t1: o.t1, t2: o.t2, trueW: mass };
    this.fills.push(f); out.push(f);
  }
  this.cyc++; return out;
};
/* labelled records as the PLC export would give them: weight of fill i arrives with row i+delay */
Plant.prototype.records = function (state) { const d = this.o.delay, F = this.fills, n = F.length;
  return F.filter(f => !state || f.state === state).map(f => Object.assign({}, f, { w: f.idx + d < n ? f.trueW : NaN })); };
/* the "existing" slow weight-feedback loop (what the PLC does today) */
Plant.prototype.legacyLoop = function (every, gain, clamp_) {
  every = every || this.lg.every; gain = gain == null ? this.lg.gain : gain; clamp_ = clamp_ == null ? this.lg.clamp : clamp_;
  const o = this.o, F = this.fills; if (this.cyc % every !== 0) return;
  for (let k = 0; k < o.nHeads; k++) { const H = this.h[k]; const mine = F.filter(f => f.head === k + 1 && f.state === 'RUN' && f.idx + o.delay < F.length).slice(-10);
    if (mine.length < 10) continue; const ws = mine.map(f => F[f.idx + o.delay].trueW), err = mean(ws) - o.target;
    if (Math.abs(err) > 0.5) { if (o.closeUnit === 'pct') H.c -= clamp(gain * err / (o.target / 100), -clamp_ * 100 / H.tcmd, clamp_ * 100 / H.tcmd); else H.a += clamp(gain * err / (o.rhoNom * o.qNom * H.qs / 1000), -clamp_, clamp_); } }
};
Plant.prototype.toCSV = function (opt) { opt = Object.assign({ delay: this.o.delay, sep: ',', dec: '.', header: null, plcAligned: false }, opt || {});
  if (opt.plcAligned) opt.delay = 0;   // the PLC stores each weight on the row of the fill it belongs to, and only valid machine states
  const F = this.fills, n = F.length, f = (x, d) => (Math.round(x * 10 ** d) / 10 ** d).toString().replace('.', opt.dec);
  const PC = this.o.closeUnit === 'pct', hdr = opt.header || (PC ? ['time', 'head', 'close_at_pct', 'flow_ml_s', 'density_g_ml', 'temp_C', 'pressure_bar', 'target_g', 'T1_g', 'T2_g', 'net_weight_g'] : opt.plcAligned ? ['time', 'head', 'anticipation_ms', 'dose_time_ms', 'flow_ml_s', 'density_g_ml', 'temp_C', 'pressure_bar', 'target_g', 'T1_g', 'T2_g', 'net_weight_g']
    : ['time', 'head', 'anticipation_ms', 'dose_time_ms', 'flow_ml_s', 'density_g_ml', 'temp_C', 'pressure_bar', 'state', 'target_g', 'T1_g', 'T2_g', 'net_weight_g']);
  const lines = [hdr.join(opt.sep)]; const base = Date.UTC(2026, 10, 10, 6, 0, 0);
  F.forEach((r, i) => { if (opt.plcAligned && r.state !== 'RUN') return; const w = i - opt.delay >= 0 ? F[i - opt.delay].trueW : NaN;
    const row = [new Date(base + r.cycle * 2400).toISOString().replace('T', ' ').slice(0, 19), r.head].concat(PC ? [f(r.a, 3)] : [f(r.a, 2), f(r.t, 1)], [f(r.Q, 3), f(r.rho, 4), f(r.T, 2), f(r.P, 3)]);
    if (!opt.plcAligned) row.push(r.state); row.push(r.target, r.t1, r.t2, isFinite(w) ? f(w, 2) : ''); lines.push(row.join(opt.sep)); });
  return lines.join('\n'); };
function simulateHistory(o) { const p = new Plant(o); for (let c = 0; c < p.o.nCycles; c++) { p.cycle(); p.legacyLoop(); } return p; }

function recommendationsText(results, S) {
  return results.map(r => 'Head ' + r.head + ': ' + r.headline).join('\n');
}

return { DEFAULTS, FIELDS, parseCSV, num, guessMapping, missingRequired, detectUnit, buildRecords, dominantState, estimateDelay, analyzeHead, analyzeAll, groupByHead,
  Plant, simulateHistory, recommendationsText, summarize, projectStats, capability, Phi, probit, fitBatch, lassoSelect, ridgeFit, rlsNew, rlsUpdate, rlsPred, cusum, rng, makeNormal, mean, sdev, median };
});
