// Exports, for every CSV in examples/, the exact numbers the app produces per head.
// Usage: node scripts/export-validation.js   ->  validation/level1/{input,expected_output}/
const fs = require('fs'), path = require('path'), { runCsv } = require('./run-app.js');
const root = path.join(__dirname, '..'), exDir = path.join(root, 'examples');
const inDir = path.join(root, 'validation', 'level1', 'input'), outDir = path.join(root, 'validation', 'level1', 'expected_output');
fs.mkdirSync(inDir, { recursive: true }); fs.mkdirSync(outDir, { recursive: true });
for (const f of fs.readdirSync(exDir).filter(x => x.endsWith('.csv'))) {
  fs.copyFileSync(path.join(exDir, f), path.join(inDir, f));
  fs.writeFileSync(path.join(outDir, f.replace(/\.csv$/, '_app_output.csv')), runCsv(fs.readFileSync(path.join(exDir, f), 'utf8')));
  console.log('exported', f);
}
