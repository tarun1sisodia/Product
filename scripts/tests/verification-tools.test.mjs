import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertVerificationTarget } from "../verification/common.mjs";
import { verifyPriceFidelity } from "../verification/test-price-fidelity.mjs";
import { runCustomerFlowVerification } from "../verification/test-customer-flow.mjs";
import { runAdminOperationsVerification } from "../verification/test-admin-operations.mjs";
import { runLegacySafetyVerification } from "../verification/test-legacy-safety.mjs";

const targetUrl = "http://127.0.0.1:4000";
function fakePriceApi({ routes = [{ id: "route-1", status: "published" }], vehicles = [{ vehicle_model_id: "car-1", one_way_amount: 3500, is_active: true }], quote = {}, status = 200 } = {}) {
  return async (input) => {
    const path = new URL(input).pathname;
    if (status !== 200) return new Response("Unavailable", { status });
    if (path.endsWith("/fare-settings")) return Response.json({ settings: [{ key: "advance_percent", value: 28 }] });
    if (path.endsWith("/admin/routes")) return Response.json({ routes });
    if (path.endsWith("/vehicles")) return Response.json({ vehicles });
    if (path.endsWith("/quotes")) return Response.json({
      currency: "INR", vehicle: { vehicle_model_id: "car-1" },
      lines: [{ code: "base_fare", amount: 3500 }, { code: "extra_charge", amount: 100 }],
      total: 3600, advance: 1000, balance: 2600, ...quote,
    });
    if (path.endsWith("/catalog")) return Response.json({ products: [] });
    if (path.endsWith("/fare-rules")) return Response.json({ fare_rules: [] });
    throw new Error(`Unmocked path ${path}`);
  };
}

test("operations require explicit remote opt-in and reject credential-bearing targets", () => {
  const previous = process.env.ALLOW_REMOTE_VERIFICATION;
  delete process.env.ALLOW_REMOTE_VERIFICATION;
  try {
    assert.equal(assertVerificationTarget(targetUrl).hostname, "127.0.0.1");
    assert.throws(() => assertVerificationTarget("https://production.example.test"), /Remote verification requires explicit/);
    for (const invalid of ["file:///tmp/test", "http://user:secret@localhost", "http://localhost?secret=test", "http://localhost#secret"]) assert.throws(() => assertVerificationTarget(invalid));
    process.env.ALLOW_REMOTE_VERIFICATION = "true";
    assert.equal(assertVerificationTarget("https://staging.example.test").hostname, "staging.example.test");
  } finally {
    if (previous === undefined) delete process.env.ALLOW_REMOTE_VERIFICATION;
    else process.env.ALLOW_REMOTE_VERIFICATION = previous;
  }
});

test("price fidelity compares base fare separately from legitimate extra charges", async () => {
  assert.deepEqual(await verifyPriceFidelity({ targetUrl, fetchImpl: fakePriceApi(), log: () => {} }), { passedRouteTests: 1, totalRouteTests: 1 });
});
test("zero published routes cannot be a green price check", async () => {
  await assert.rejects(verifyPriceFidelity({ targetUrl, fetchImpl: fakePriceApi({ routes: [] }), log: () => {} }), /0 comparisons/);
});
test("zero active vehicle rates cannot be a green price check", async () => {
  await assert.rejects(verifyPriceFidelity({ targetUrl, fetchImpl: fakePriceApi({ vehicles: [] }), log: () => {} }), /0 comparisons/);
});
test("HTTP failures are not silently treated as empty successful data", async () => {
  await assert.rejects(verifyPriceFidelity({ targetUrl, fetchImpl: fakePriceApi({ status: 503 }), log: () => {} }), /HTTP 503/);
});
for (const [name, quote] of [
  ["base price mismatch", { lines: [{ code: "base_fare", amount: 3501 }] }],
  ["total mismatch", { total: 9999 }],
  ["unrounded advance", { advance: 1008, balance: 2592 }],
  ["balance mismatch", { balance: 1 }],
  ["wrong vehicle", { vehicle: { vehicle_model_id: "other-car" } }],
]) {
  test(`price fidelity rejects ${name}`, async () => {
    await assert.rejects(verifyPriceFidelity({ targetUrl, fetchImpl: fakePriceApi({ quote }), log: () => {} }), /Price fidelity failed/);
  });
}

test("price verifier CLI exits nonzero rather than logging failure and returning success", () => {
  const bootstrap = `globalThis.fetch = async () => Response.json({ settings: [{key: "advance_percent", value: 28}], routes: [] });`;
  const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(bootstrap)}`, fileURLToPath(new URL("../verification/test-price-fidelity.mjs", import.meta.url))], {
    env: { ...process.env, API_BASE_URL: targetUrl }, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /0 comparisons/);
});

test("unavailable SQL routes keep all ten customer checks visible instead of shrinking coverage", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  t.mock.method(console, "log", () => {});
  const result = await runCustomerFlowVerification(targetUrl);
  assert.deepEqual(result, { passedCount: 0, totalCount: 10 });
});
test("missing prerequisites keep all ten admin checks visible", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("Not found", { status: 404 }));
  t.mock.method(console, "log", () => {});
  assert.deepEqual(await runAdminOperationsVerification(targetUrl), { passedCount: 0, totalCount: 10 });
});
test("every still-mounted legacy endpoint must actually send deprecation headers", async (t) => {
  t.mock.method(globalThis, "fetch", async (input) => Response.json(String(input).endsWith("/catalog") ? { products: [], groups: [], vehicles: [] } : {}));
  t.mock.method(console, "log", () => {});
  assert.deepEqual(await runLegacySafetyVerification(targetUrl), { passedCount: 1, totalCount: 4 });
});

test("T1 guard checks real response status and never permits Timing-Allow-Origin", async () => {
  const { verifyNetworkHeaders } = await import("../network/verify-t1-headers.mjs");
  const good = () => new Response("ok", { headers: { "Alt-Svc": 'h3=":443"; ma=86400' } });
  assert.equal((await verifyNetworkHeaders({ targetUrl, fetchImpl: async () => good() })).checked, 2);
  await assert.rejects(verifyNetworkHeaders({ targetUrl, fetchImpl: async () => new Response("error", { status: 500 }) }), /HTTP 500/);
  await assert.rejects(verifyNetworkHeaders({ targetUrl, fetchImpl: async () => new Response("ok") }), /Alt-Svc/);
  await assert.rejects(verifyNetworkHeaders({ targetUrl, fetchImpl: async () => {
    const response = good(); response.headers.set("Timing-Allow-Origin", "*"); return response;
  } }), /Timing-Allow-Origin/);
});
