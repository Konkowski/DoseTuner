# Level-1 validation pack

Independent check of DoseTuner without a machine.
- `PROMPT.md` — paste into another chat (needs code execution)
- `SPEC.md` — exact rules the tool follows
- `input/` — example PLC histories (simulated; head 10 is thin on purpose)
- `expected_output/` — what the tool outputs for them (regenerate: `node scripts/export-validation.js`)
- Run the tool on any CSV: `node scripts/run-app.js file.csv > out.csv`
