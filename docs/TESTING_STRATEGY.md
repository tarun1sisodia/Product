# Testing Strategy — SK Baghel Tour & Travels

**Status (2026-11-01): strategy and executable local test inventory, not a release certificate.**

Use `PLATFORM_ARCHITECTURE.md`, `BACKEND_RULES.md`, and `FRONTEND_RULES.md` as the product rules. A passing test that contradicts those rules must be corrected together with the implementation; do not preserve a defect as a test expectation. Missing provider credentials, skipped journeys, and empty datasets are not passing acceptance tests.

## 1. Required layers and targets

| Layer | Target (not measured attainment) | Execution |
|---|---|---|
| Unit | 80%+ measured code coverage | Backend Vitest; customer/admin Node tests |
| Integration | All critical component interactions and persistence paths | HTTP/service tests plus separately provisioned PostgreSQL/provider tests |
| Contract | Positive and negative shared-schema and response checks | Vitest and generated-source parity check |
| E2E | All critical customer/admin journeys in a browser | TestSprite against approved staging/local targets |
| Security | Auth, ownership, PII, input abuse, payment verification, replay/idempotency | Negative tests plus staging security acceptance |

No instrumented coverage report has been produced in this audit. Historical 100% coverage tables and illustrative constructor examples have been removed because test counts do not establish statement/branch coverage.

## 2. Deterministic local gate

Install all four dependency trees with `npm run install:all`, then run:

```sh
npm run verify
npm run verify:pipeline
```

`verify` checks canonical contract copies, all three typechecks, site configuration, root verification-tool regressions, backend deterministic tests, customer unit/component tests, admin tests, SEO lifecycle guards, and all three production builds.

`verify:pipeline` also purges build output and checks admin fallback artifacts, frontend secret identifiers, and Cloudflare file-size budgets. It is a local script, not evidence that a hosted workflow or deployment ran. Backend lint and live acceptance remain separate gates; see below. Neither script proves visual fidelity, complete guest checkout, real payments, working assets, Lighthouse scores, or PostgreSQL migrations.

## 3. Backend tests

```sh
npm --prefix backend test
npm --prefix backend test -- --reporter=verbose
npm --prefix backend run test:unit
npm --prefix backend run test:integration
npm --prefix backend run test:contract
npm --prefix backend run typecheck
npm --prefix backend run lint
```

- `backend/vitest.config.ts` discovers `tests/**/*.test.ts`, uses serial file execution and a 15-second test/hook timeout, and configures test authentication and fake payment keys.
- `test` / `test:ci` fail when no tests are discovered. There is no `--passWithNoTests` escape hatch.
- Most historical unit files also contain mocked service, route, and repository interactions. Their directory name does not prove real database coverage.
- `tests/contract/contracts.test.ts` contains the existing ten shared response-schema tests, moved unchanged from `tests/unit/` so the dedicated contract command actually executes them.
- `tests/integration/guest-booking.test.ts` exercises real HTTP validation and `BookingsService` with injected quote/persistence boundaries. It checks both route aliases, guest token generation, the sign-in-required flag, authenticated ownership binding, client-price rejection, and malformed-input rejection. **It does not connect to PostgreSQL or complete checkout.**
- `tests/unit/advance-policy.test.ts` checks independent fixed examples across all four fare categories: default 28%, nearest ₹100, ₹500 minimum, capped at total; configured rate overrides remain supported.
- `tests/unit/night-policy.test.ts` checks 22:00 inclusive / 05:00 exclusive in IST, equivalent UTC instants, and explicit configuration overrides.
- Existing payment regressions must continue to protect rupee/paise boundaries, provider verification, state transitions, wrong-order/amount/currency failures, and duplicate capture handling.

## 4. Customer and admin tests

```sh
npm --prefix react test
npm --prefix react run test:unit
npm --prefix react run test:components
npm --prefix react run test:seo
npm --prefix admin test
```

Customer `test:unit` uses the workspace's pinned `tsx` dependency to discover **all** `scripts/*.test.ts`. Native Node type stripping alone cannot resolve the repository's `.js` imports of TypeScript source. `test:catalog-sources` remains a focused compatibility command, not the full customer gate.

The component command runs combobox SSR, ARIA/source-contract, custom-distance/fare, distance-matrix, and mocked LocationIQ proxy checks. These must not be presented as browser keyboard, focus, screen-reader, debounce/race, or live-provider acceptance.

- Booking-header fixtures must satisfy `BookingCreateResponse`, preserve JSON and bearer headers, allow anonymous creation requests when the backend permits them, surface backend auth requirements, and reject malformed responses.
- LocationIQ fixtures use the backend `{ success, data: { suggestions } }` envelope. Assert proxy-only requests, no credential/query-key exposure, normalized data, abort propagation, and curated-fallback behavior on failures. Never restore frontend tokens or direct provider calls to satisfy a stale test.
- Night estimators must agree on the documented default and reject malformed pickup time strings.
- SEO lifecycle and artifact checks cover emitted HTML/configuration, not live crawling, missing image-library restoration, or real Core Web Vitals.

## 5. Operational probes: explicit targets and nonzero coverage

```sh
API_BASE_URL=http://127.0.0.1:4000 npm run verify:operations
API_BASE_URL=http://127.0.0.1:4000 node scripts/verification/test-price-fidelity.mjs
API_BASE_URL=http://127.0.0.1:4000 npm run verify:t1
```

Operational probes default to local port 4000, never production. Non-loopback targets additionally require `ALLOW_REMOTE_VERIFICATION=true` and an approved staging URL. Customer verification can create bookings; use an isolated test database and test identities. Never make real charges or run these against production as routine checks.

- Customer/admin prerequisite failures remain visible in the ten-check denominators; they must not silently remove dependent cases.
- Every still-mounted legacy endpoint must actually return its deprecation header (404 is acceptable only for an intentionally decommissioned route).
- Price fidelity must perform at least one published-route/active-vehicle comparison, reject HTTP/schema/money mismatches, validate base-fare lines separately from legitimate extra charges, and return nonzero on failure. Its current scope does not cover local/transfer/tour price fidelity.
- T1 verifies actual health response headers and the absence of `Timing-Allow-Origin`. An `Alt-Svc` advertisement is not proof of negotiated HTTP/3.
- `scripts/tests/verification-tools.test.mjs` supplies negative regressions for the verification tools themselves.

## 6. Live prerequisites and safety

```sh
npm --prefix backend run test:db
npm --prefix backend run audit:env
npm run testsprite:validate
```

PostgreSQL connectivity requires an approved `DATABASE_URL`. MongoDB is not a platform prerequisite. `test:db` is a connectivity diagnostic, not migration/index/RLS or transaction acceptance.

The environment audit reads optional `backend/.env` plus injected process variables (process values win), redacts configured secrets, and returns nonzero on recorded failures. It does not send email as a probe. Its storage write/read/delete probe requires explicit `ALLOW_STORAGE_WRITE_PROBE=true` against a test bucket. Merely configuring two stores does not establish dual-write/failover correctness. Separate `test:r2` / `test:e2e-pipeline` commands can write storage objects and must only run with approved test storage.

`testsprite:validate` checks local specifications and CLI/auth readiness; it is not an E2E run. Missing CLI/auth/project/approved target must be recorded as blocked, not passed. Follow `.agents/skills/testsprite-verify/SKILL.md` for an actual terminal browser-test verdict. Hosted CI, PostgreSQL migrations, sandbox gateway reconciliation, storage failover, email delivery, and full browser journeys require separate evidence.

## 7. Test and fixture discipline

1. Derive expected monetary values from independent documented examples, not from the function under test. Validate persisted state and payment units as well as status codes.
2. Test happy paths, invalid input, unauthorized/other-owner calls, duplicates, provider outages, and retries.
3. Use injected repositories/providers and clocks. Generate future pickup dates where the API enforces future booking; keep fixed dates only for pure timezone/calendar examples.
4. Restore mocked globals and close Fastify/Vite instances even after assertion failures.
5. Never log credentials, customer PII, or provider payloads to make debugging easier.
6. Do not remove assertions or suppress lint rules to manufacture a green result.
7. Keep logs/generated reports outside Git. Record outstanding gaps and the precise boundary tested in `DOC_ALIGNMENT_PROGRESS.md`.
