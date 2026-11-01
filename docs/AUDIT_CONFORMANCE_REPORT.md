# Documentation conformance audit — partial, not a completion certificate

**Audit date:** 2026-11-01  
**Scope:** Initial cross-check of the current checkout against the canonical platform specification, operational rules, payment specification, and documentation entry points. This is **not** an exhaustive review of every Markdown requirement or every implementation path.  
**Product verdict:** **Not established as complete or production-ready.** Passing the configured checks does not establish compliance with the whole specification.

## 1. Authority and verification method

- Start with [AGENT_GUIDE.md](AGENT_GUIDE.md) and [PLATFORM_ARCHITECTURE.md](PLATFORM_ARCHITECTURE.md).
- Follow [BACKEND_RULES.md](../BACKEND_RULES.md), [FRONTEND_RULES.md](../FRONTEND_RULES.md), and domain-specific specifications.
- Payment corrections below follow [PAYMENT_SYSTEM.md](PAYMENT_SYSTEM.md), particularly §§1 and 3, and [.agents/rules/PAYMENT_AGENT_RULES.md](../.agents/rules/PAYMENT_AGENT_RULES.md).
- Missing specifications, contradictory documentation, source inspection, automated tests, and live integration evidence are distinct categories. None substitutes for another.
- The historical phase tables in the agent guides previously labeled every phase complete. Those statuses were not re-established by this audit and must not be used as release approval.

## 2. Confirmed defects corrected in this pass

| Requirement | Initial evidence | Correction | Verification |
|---|---|---|---|
| Generated contracts must match `contracts/` | Initial `npm run verify` stopped at `contracts:check`: `bookings.ts`, `fare-system.ts`, `fares.ts`, and `product-verticals.ts` differed in all three applications (12 files) | Regenerated copies with `npm run contracts:sync`; canonical sources were not changed | `contracts:check`, all three typechecks, complete verification run |
| Verified capture transitions eligible bookings to `paid_confirmed` | Both PostgreSQL capture implementations and the memory implementation wrote legacy `confirmed` | Changed capture updates to `paid_confirmed` for `draft` / `pending_payment`; did not remove compatibility reads or rewrite historical bookings | New SQL-contract tests for both PostgreSQL implementations; memory-state tests; updated service regression |
| Payment discrepancies set reconciliation status to `needs_review` without confirming a booking | `processNeedsReview` set payment status but left reconciliation status unchanged | Set both statuses in both PostgreSQL implementations and memory implementation | New tests assert both statuses and absence of a booking confirmation |

The payment-state regression suite is [payment-state-conformance.test.ts](../backend/tests/unit/payment-state-conformance.test.ts): **16 tests**, including cancellation/refund guards and capture replay preserving later trip states. PostgreSQL tests use a mocked query client; they do **not** execute against a database. Migration [0045](../backend/migrations/0045_recreate_refunds_and_expand_payment_status.sql) already permits the corrected booking statuses and adds reconciliation columns. No migration was added or applied in this pass.

A regression-sensitivity check temporarily ran the new suite against the original repository implementations: **7 tests failed** on the original defects; after restoring the fixes, **all 16 passed**. No temporary mutation was retained.

The checkout booking entity now reuses the backend `BookingStatus` type instead of an independent union that omitted `paid_confirmed`. This does not resolve the legacy state model described below.

## 3. Confirmed remaining gaps

These findings are an initial remediation queue, **not an exhaustive backlog**.

| Priority | Requirement / specification | Evidence in this checkout | Remaining work |
|---|---|---|---|
| P1 | Two staff roles: `super_admin`, `developer` — platform §1, backend §1, [RBAC.md](RBAC.md) | [Backend domain](../backend/src/types/domain.ts) still defines `content_editor`, `review_moderator`, `dispatcher`, and `finance_operator`, but no `developer`. [Role guards](../backend/src/middlewares/roleGuard.ts) still authorize those roles. [Admin types](../admin/src/lib/types.ts) use `super_admin` / `finance_operator`; [admin authentication](../admin/src/lib/auth.ts) only accepts `super_admin` | Migrate roles and policies safely; align JWT principal handling, endpoint-specific permissions, admin routing/navigation, and allow/deny tests. Do not merely admit developers to unrestricted admin endpoints |
| P1 | No driver-assignment step; trip completion records driver balance collection — backend Law 8, platform §2, database §4.2 | `driver_assigned` remains in backend domain, booking repository status API, admin types and booking UI. No checked-in SQL migration contains `balance_collected_by_driver`, `admin_trip_notes`, or `completed_at`; admin transition request schema only accepts `to` and `expectedVersion` | Implement an append-only schema change, repository mapping and atomic completion command; align both repository implementations and UI; test authorization, invalid transitions, duplicate completion and cash-collection persistence |
| P1 | Database-backed SEO Control Center — platform §2.2, database §4.7, SEO engine | Contracts now include `SeoMetadataItem` / `SeoRedirectItem`, but no checked-in migration defines `seo_metadata` or `seo_redirects`; the admin router has no SEO management page | Trace and implement schema, repositories, authenticated CRUD, publish validation, render-time consumption and redirects. Contract declarations alone do not implement this feature |
| P1 | Documented CI verification — deployment docs and root agent rules | `.github/workflows/` is ignored; this checkout has no tracked workflow files. A local pipeline script exists | Verify whether CI is configured externally; restore repository automation if required. A local successful run is not evidence that pull requests are gated |
| P1 | Required visual lock and admin requirements documents — root `AGENTS.md` | `docs/project/DESIGN_LOCKS.md`, `docs/project/ANIMATION_RULES.md`, and `docs/admin/ADMIN_PRD.md` are absent. Several other `docs/project/` links are also broken. Design/animation documents do exist under `react/docs/`, but the design-lock registry and referenced admin PRD are not there | Restore authoritative missing documents or reconcile links against approved sources. Do not invent lock permissions or silently substitute a test PRD for the missing admin PRD. No UI components were redesigned in this pass |
| P2 | Schema type on route detail pages — SEO engine §10.2 | Document requests `Product`; [RouteTemplate.tsx](../react/src/templates/RouteTemplate.tsx) uses `TaxiService` | Resolve schema requirements against supported structured-data semantics; add generated-artifact assertions before treating existing SEO checks as full conformance |
| P2 | Reproducible visual assets — [PREVIEW_SETUP.md](../PREVIEW_SETUP.md) | `react/public/assets/` is ignored and absent here; the documented restoration was not performed. SSG still builds with references to these assets | Restore the authorized image library, validate referenced assets and perform browser checks. Build success does not establish that images load |

## 4. Documentation conflicts requiring explicit reconciliation

- Backend Law 2 documents `max(500, round(totalFare × 0.28 / 100) × 100)` for the advance. The modular [fare finalizer](../backend/src/modules/fare-engine/finalizer.ts) uses the configured advance percentage, rounds to a whole rupee and caps the advance at the total. The full fare business-logic specification and approved business rules must be cross-checked before changing money behavior; this audit did **not** change fare arithmetic.
- The platform describes a five-minute L1 cache; backend §12.1 says TTL zero/on-demand. Actual cache lifecycle and invalidation still require a dedicated review.
- Database and publishing documents use `publication_outbox` / `publishing_outbox`; [PublicationWorker](../backend/src/modules/publishing/publication-worker.ts) queries `site_publish_events`. A naming mismatch alone does not prove that publishing is broken; verify the entire publication transaction, invalidation and deployed content lifecycle.
- [PREVIEW_SETUP.md](../PREVIEW_SETUP.md) previously attributed the route schema requirement to SEO engine §4.1. In the current SEO document it is §10.2. Likewise, absence of a specifically named fleet file is not proof that no registry exists: `react/src/data/fleets.ts` exists. Fleet group/model parity still needs a separate audit.

## 5. Executed verification

After the corrections, `npm run verify` **passed** on 2026-11-01:

- Shared-contract synchronization check.
- Customer, admin and backend TypeScript checks.
- Customer configuration validation.
- Backend: **36 test files, 429 tests passed**.
- Customer catalog/source regressions: **41 passed**.
- Admin configured unit tests: **5 passed**.
- Customer SEO unit tests: **13 passed**, plus the configured SEO lifecycle and static performance-guardrail checks.
- All three production builds.
- Customer SSG: **120 rendered pages**, **29 redirects**; artifact validator checked **147 HTML files** and **106 sitemap URLs** using the production canonical origin.

`npm run verify:pipeline` also **passed** from clean build-output directories, including the admin fallback-artifact check, Cloudflare single-file size budget, and frontend secret-identifier scan. These are local checks, not a successful hosted CI run or a comprehensive secret audit.

Diff hygiene: `git diff --check` flags a trailing blank line in each of the three regenerated `fare-system.ts` copies, inherited from the canonical source. The generated files were kept byte-identical to their source rather than hand-edited. Non-generated changes pass the whitespace check. Build-generated `react/public/release.json` changes were discarded.

The script called “PageSpeed Insights & Performance Guardrail Checks” checks local source/build assertions. Its success is **not** a measured Lighthouse/PageSpeed score, real-browser hydration proof, accessibility audit or Core Web Vitals result.

## 6. Not verified / not done

- Exhaustive requirement-by-requirement review of every Markdown file.
- Real PostgreSQL migration replay, constraints/RLS checks and concurrent payment/refund integration scenarios.
- Browser E2E flows or visual checks across devices.
- Real Supabase OAuth sessions, live/test Razorpay transactions, Resend/WhatsApp delivery, storage uploads, deploy hooks or production monitoring.
- Production deployment or changes to provider configuration.
- Completion of the remaining gaps above; full payment-system security certification.

## 7. Completion order and exit criteria

1. Reconcile missing authoritative documents and conflicting business/security requirements.
2. Finish role migration and endpoint-specific RBAC with database-backed deny/allow coverage.
3. Finish no-assignment trip lifecycle and durable completion/cash-balance records.
4. Implement missing SEO management and trace publishing/cache integration end to end.
5. Audit remaining platform modules against their detailed PRDs, contracts and database migrations; record each as implemented, tested, blocked or missing.
6. Restore assets; run browser journeys and real PostgreSQL integration tests, then staging provider tests.
7. Re-run local verification plus CI/security/artifact checks, deploy in the documented order, and collect live acceptance/monitoring evidence.

**Do not mark the whole product complete while any required acceptance evidence is missing.**
