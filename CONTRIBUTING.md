# Contributing to DoseTuner

Thanks for helping! You can use DoseTuner in your own fork however you like (MIT). If you want your improvement to land in the main project, follow the flow below. **Every change to `main` is reviewed and approved by the maintainer.**

## The flow

1. **Fork** the repository (button top-right on GitHub).
2. **Clone** your fork and create a branch: `git checkout -b feat/short-description`.
3. **Change** the code. Source lives in `src/`; never edit `dist/` by hand.
4. **Check** locally:
   ```bash
   npm run build
   npm test          # must end with: 0 failed
   ```
   If you touched the UI, also run `npm i && npm run test:ui`.
5. **Commit** with a clear message (`fix: …`, `feat: …`, `docs: …`).
6. **Push** to your fork and open a **Pull Request** against `main`. Fill in the template.
7. **Review**: the maintainer and CI check it. Expect questions or change requests. When approved it is merged and the public app updates automatically.

Not sure yet? Open an [Issue](https://github.com/Konkowski/DoseTuner/issues/new/choose) or a Discussion first.

## What makes a good PR

- **Small and focused**: one idea per PR.
- **Tested**: algorithm changes need a numerical check in `test/test.js`. Say what you measured (e.g. Cpk before/after on the simulator).
- **Honest**: report limits and failure cases, not just wins.
- **Simple for operators**: the app must stay usable by a non-technical person on a phone. No jargon in the UI, no extra setup steps.
- **No new runtime dependencies**: the app ships as one self-contained file.

## Design rules

- The tool **recommends**; it never writes to the machine. The PLC keeps authority.
- Closing point is a **percentage of the setpoint**. No time units in the main flow.
- Every suggestion must be **explainable** (which factor, which direction, how much).
- Safety first: bounded steps, data-sufficiency check, fallback to feedback.
- Colours follow the tokens in `src/app.html` (`--teal` proposed, grey now, orange offset, blue conditions, amber T2, red alert).

## Easy first contributions

- Add column-name aliases in `FIELDS` (`src/core.js`) for your PLC export.
- Translate the UI strings.
- Share an anonymised real-machine result in a Discussion.
- Improve docs.

## For the maintainer

Recommended repository settings: protect `main` (require a pull request and one approval, require the **CI** check, disallow force-push); Pages source = **GitHub Actions**; enable Issues and Discussions. `CODEOWNERS` already requests your review on every PR.

By contributing you agree your work is released under the [MIT License](LICENSE). Please follow the [Code of Conduct](CODE_OF_CONDUCT.md).
