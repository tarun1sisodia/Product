import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// PLATFORM_ARCHITECTURE: provider credentials belong to the backend. These
// fixtures deliberately use the proxy envelope, never the raw provider API.
async function runTests() {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { noDiscovery: true },
  });
  const originalFetch = globalThis.fetch;
  let assertions = 0;
  const equal = (actual: unknown, expected: unknown, message?: string) => {
    assert.deepEqual(actual, expected, message);
    assertions++;
  };
  try {
    const { fetchLocationIQSuggestions } = await vite.ssrLoadModule("/src/hooks/useLocationIQ.ts");
    let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
    for (const query of ["a", "   "]) equal(await fetchLocationIQSuggestions({ query }), []);
    const preAborted = new AbortController();
    preAborted.abort();
    equal(await fetchLocationIQSuggestions({ query: "Agra", signal: preAborted.signal }), []);
    equal(calls, 0, "Short queries and pre-aborted searches must not call the proxy");

    const suggestions = [
      { placeId: "98765", displayName: "Taj Mahal, Agra, Uttar Pradesh", city: "Agra", state: "Uttar Pradesh", lat: 27.1751448, lon: 78.0421422 },
      { placeId: "54321", displayName: "Indira Gandhi International Airport, New Delhi, Delhi", city: "New Delhi", state: "Delhi", lat: 28.5561624, lon: 77.1002812 },
    ];
    let capturedUrl = "";
    globalThis.fetch = async (input) => {
      capturedUrl = String(input);
      calls++;
      return Response.json({ success: true, data: { source: "provider", suggestions } });
    };
    const results = await fetchLocationIQSuggestions({ query: "  Taj Mahal  " });
    equal(calls, 1, "Searching must work without any browser token");
    const url = new URL(capturedUrl, "https://customer.example.test");
    equal(url.pathname, "/api/v1/locations/autocomplete");
    equal(url.searchParams.get("q"), "Taj Mahal");
    equal([...url.searchParams.keys()], ["q"], "No provider key may be sent by the browser");
    equal(capturedUrl.includes("locationiq.com"), false, "Never contact the provider from the browser");
    equal(results.length, 2);
    equal(results[0], {
      id: "location-98765", name: "Taj Mahal", subtitle: suggestions[0].displayName,
      code: "IQ", isLocationIQ: true, lat: 27.1751448, lon: 78.0421422,
      raw: { place_id: "98765", lat: "27.1751448", lon: "78.0421422", display_name: suggestions[0].displayName },
    });
    equal(results[1].name, "Indira Gandhi International Airport");

    // The client also supports the array envelope used by older proxy versions.
    globalThis.fetch = async () => Response.json({ success: true, data: suggestions });
    equal((await fetchLocationIQSuggestions({ query: "Agra" })).length, 2);

    // Provider/proxy failures must permit curated destinations, never a direct
    // provider retry or a request for a token in the public UI.
    for (const status of [401, 429, 503]) {
      let attempts = 0;
      globalThis.fetch = async () => { attempts++; return new Response("Unavailable", { status }); };
      equal(await fetchLocationIQSuggestions({ query: "Agra" }), []);
      equal(attempts, 1, `HTTP ${status} must not cause a direct-provider retry`);
    }
    for (const body of [{ success: true, data: { suggestions: [] } }, { unexpected: true }]) {
      globalThis.fetch = async () => Response.json(body);
      equal(await fetchLocationIQSuggestions({ query: "Agra" }), []);
    }
    globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
    equal(await fetchLocationIQSuggestions({ query: "Agra" }), []);
    globalThis.fetch = async () => new Response("invalid JSON", { status: 200 });
    equal(await fetchLocationIQSuggestions({ query: "Agra" }), []);

    const active = new AbortController();
    globalThis.fetch = async (_input, init) => new Promise((_resolve, reject) => {
      equal(init?.signal, active.signal, "Forward the abort signal to fetch");
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      active.abort();
    });
    equal(await fetchLocationIQSuggestions({ query: "Jaipur", signal: active.signal }), []);
    console.log(`LocationIQ proxy: ${assertions} assertions passed (mocked; not a live-provider test).`);
  } finally {
    globalThis.fetch = originalFetch;
    await vite.close();
  }
}
runTests().catch((error) => { console.error(error); process.exitCode = 1; });
