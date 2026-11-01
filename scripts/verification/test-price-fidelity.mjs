import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getAdminAuthToken, API_BASE_URL, assertVerificationTarget } from "./common.mjs";

/** Read-only comparison against an explicitly approved API; never a 0/0 pass. */
export async function verifyPriceFidelity({ targetUrl = API_BASE_URL, fetchImpl = fetch, log = console.log } = {}) {
  assertVerificationTarget(targetUrl);
  const base = targetUrl.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${await getAdminAuthToken()}`, "Content-Type": "application/json" };
  async function json(path, options = {}) {
    const response = await fetchImpl(`${base}${path}`, { signal: AbortSignal.timeout(15000), ...options });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }
  log(`Price fidelity target: ${base}`);
  const settingsJson = await json("/api/v1/admin/fare-settings", { headers });
  if (!Array.isArray(settingsJson.settings)) throw new Error("Invalid fare settings response");
  const percentage = Number(settingsJson.settings.find(s => s.key === "advance_percent")?.value);
  if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) throw new Error("Missing/invalid advance_percent setting");
  const routesJson = await json("/api/v1/admin/routes", { headers });
  const routes = routesJson.routes ?? routesJson.data;
  if (!Array.isArray(routes)) throw new Error("Invalid routes response");
  const testRoutes = routes.filter(r => r.status === "published").slice(0, 5);
  if (testRoutes.length === 0) throw new Error("No published routes: price fidelity is unverified (0 comparisons)");

  let totalRouteTests = 0;
  let passedRouteTests = 0;
  const failures = [];
  const pickup = new Date(Date.now() + 2 * 86400000);
  pickup.setUTCHours(6, 30, 0, 0); // 12:00 IST: do not accidentally select a night journey.
  for (const route of testRoutes) {
    const data = await json(`/api/v1/admin/routes/${encodeURIComponent(route.id)}/vehicles`, { headers });
    if (!Array.isArray(data.vehicles)) throw new Error("Invalid route-vehicles response");
    const vehicles = data.vehicles.filter(v => v.is_active !== false && Number.isSafeInteger(v.one_way_amount) && v.one_way_amount > 0);
    for (const vehicle of vehicles) {
      totalRouteTests++;
      try {
        const quote = await json("/api/v1/quotes", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: "outstation", route_id: route.id, vehicle_model_id: vehicle.vehicle_model_id, trip_type: "one_way", pickup_at: pickup.toISOString(), passenger_count: 1 }),
        });
        const lines = quote.lines;
        if (quote.currency !== "INR" || !Array.isArray(lines) || lines.length === 0 || !lines.every(line => Number.isSafeInteger(line.amount) && line.amount > 0)) throw new Error("Invalid quote money/lines");
        const baseFare = lines.filter(line => line.code === "base_fare");
        if (baseFare.length !== 1 || baseFare[0].amount !== vehicle.one_way_amount) throw new Error("Stored route base fare does not match quote base fare");
        // Allow genuine extra charges: compare DB base with the base line, not
        // the grand total, and independently validate every monetary identity.
        const total = lines.reduce((sum, line) => sum + line.amount, 0);
        const advance = Math.min(total, Math.max(500, Math.round(total * percentage / 10000) * 100));
        if (quote.total !== total || quote.advance !== advance || quote.balance !== total - advance) throw new Error("Quote violates documented total/advance/balance policy");
        if (quote.vehicle?.vehicle_model_id !== vehicle.vehicle_model_id) throw new Error("Wrong vehicle quoted");
        passedRouteTests++;
      } catch (error) {
        failures.push(`${route.id}/${vehicle.vehicle_model_id}: ${error.message}`);
      }
    }
  }
  if (totalRouteTests === 0) throw new Error("No active one-way vehicle prices: price fidelity is unverified (0 comparisons)");
  log(`Price fidelity: ${passedRouteTests}/${totalRouteTests} route/vehicle comparisons passed.`);
  if (failures.length) throw new Error(`Price fidelity failed:\n${failures.join("\n")}`);

  // Preserve the catalog/rule diagnostics, but do not count them as fare matches.
  const catalog = await json("/api/v1/catalog");
  if (!Array.isArray(catalog.products)) throw new Error("Invalid published catalog response");
  const rules = await json("/api/v1/admin/fare-rules", { headers });
  if (!Array.isArray(rules.fare_rules)) throw new Error("Invalid fare rules response");
  log(`Catalog products: ${catalog.products.length}; configured fare rules: ${rules.fare_rules.length}. Tour/local/transfer price fidelity is NOT covered by this probe.`);
  return { passedRouteTests, totalRouteTests };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyPriceFidelity().catch(error => { console.error(error.message); process.exitCode = 1; });
}
