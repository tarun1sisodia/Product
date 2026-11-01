import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { API_BASE_URL, assertVerificationTarget } from "../verification/common.mjs";

// Header configuration only; this cannot prove HTTP/3 negotiation at the edge.
export async function verifyNetworkHeaders({ targetUrl = API_BASE_URL, fetchImpl = fetch } = {}) {
  assertVerificationTarget(targetUrl);
  const response = await fetchImpl(`${targetUrl.replace(/\/+$/, "")}/api/v1/health`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Health probe failed: HTTP ${response.status}`);
  if (!/(?:^|,)\s*h3=":443"(?:;|$)/.test(response.headers.get("alt-svc") ?? "")) throw new Error("Missing expected HTTP/3 Alt-Svc advertisement");
  if (response.headers.has("timing-allow-origin")) throw new Error("Timing-Allow-Origin must remain absent (SEC-002 timing oracle)");
  return { checked: 2, scope: "response headers only; not HTTP/3 transport verification" };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  verifyNetworkHeaders().then(result => console.log(result)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
