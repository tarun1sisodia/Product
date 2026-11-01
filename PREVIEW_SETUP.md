# Local preview setup (sandbox)

This repository is a checkout of `tarun1sisodia/Product`. The application source is the
`Agra-Sk-Baghel-Tour-And-Travels` monorepo snapshot (commit `c6fd6da`): `react/` (customer site),
`admin/` (operations desk), `backend/` (Fastify API), `contracts/`, `docs/` and `scripts/`.

## 1. Install dependencies

```bash
npm ci                 # root tooling
npm ci --prefix react  # customer site (vite + react 19)
```

## 2. Restore the image library (gitignored)

`react/public/assets` is 66 MB of photography, so it is **not** committed here. Every page under
`/assets/...` 404s without it.

```bash
git clone --depth 1 https://github.com/tarun1sisodia/Agra-Sk-Baghel-Tour-And-Travels.git /tmp/upstream
cp -a /tmp/upstream/react/public/assets react/public/
```

## 3. Run the customer site

```bash
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

`react/vite.config.ts` already binds `0.0.0.0:5173` with `allowedHosts: true`, so proxied preview
hosts work without changes. The dev server proxies `/api` to `http://localhost:4000`; without a
running backend the booking/inquiry calls fall back to the app's error states. On any host other
than localhost the client calls the production API origin from `src/services/api.ts`.

## 4. Verify a change before shipping

```bash
npm run verify            # contracts check, 3× typecheck, tests, SEO, builds
npm run customer:build    # prerender pass — 120 pages, 106 sitemap URLs
```

## Known gaps in this snapshot

- `docs/SEO_ENGINE.md` §10.2 requests `Product` on route templates; the route template
  currently publishes `TaxiService`. See the conformance report before broadening this claim to other templates.
- A partial audit is recorded in `docs/AUDIT_CONFORMANCE_REPORT.md`; there is still no
  automated `scripts/audit-docs-conformance.mjs` gate.
- `react/src/data/fleetCatalogue.ts` is absent, but `react/src/data/fleets.ts` is an existing
  registry. Canonical group/model parity and remaining duplication still need verification.
