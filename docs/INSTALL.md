# Install and run

DoseTuner is a static web app. There is nothing to install on a server.

## Option A: just open it
Go to **https://konkowski.github.io/DoseTuner/** (the GitHub Pages deployment of this repository). Works in any modern browser.

## Option B: install on a phone (offline)
The app is a PWA. It needs to be served over **HTTPS** once; after that it works without network.

- **Android / Chrome:** open the link → ⋮ → *Install app* (or *Add to Home screen*).
- **iPhone / Safari:** open the link → Share → *Add to Home Screen*.

## Option C: one file, no hosting
`npm run build` produces `dist/index.html`, a single self-contained file. Send it to a phone and open it with the browser. It works, but browsers do not allow offline install (service worker) from a local file; use Option B for that.

## Option D: run your own copy
1. Fork the repository.
2. In your fork: *Settings → Pages → Source: GitHub Actions*.
3. Push to `main`. The workflow in `.github/workflows/pages.yml` publishes `https://<your-user>.github.io/DoseTuner/`.

## Local development
```bash
npm run build
npm run serve     # http://localhost:8765
```
Data you load is stored only in your browser (IndexedDB). Clearing site data removes it.
