import assert from "node:assert/strict";
import test from "node:test";
import { createBooking } from "../src/services/cleanFareApi.ts";
import type { BookingCreateResponse, CreateBookingRequest } from "../src/contracts/fare-system.ts";

const request: CreateBookingRequest = {
  customer_name: "Test Customer",
  customer_phone: "+919876543210",
  customer_email: "test@example.com",
  pickup_address: "Tajganj, Agra",
  drop_address: "Delhi Airport",
  quoted_total: 5000,
  quote: {
    category: "outstation",
    route_id: "20000000-0000-0000-0001-000000000001",
    vehicle_model_id: "10000000-0000-0000-0002-000000000001",
    trip_type: "one_way",
    passenger_count: 2,
    pickup_at: new Date(Date.now() + 86400000).toISOString(),
  },
};
const booking: BookingCreateResponse = {
  booking_id: "11111111-1111-4111-a111-111111111111",
  ticket_id: "AGR-20261101-9999",
  guest_access_token: "test-guest-token",
  status: "pending_payment",
  total_amount: 5000,
  advance_amount: 1400,
  balance_amount: 3600,
  fare_breakdown: {
    category: "outstation",
    vehicle: {
      vehicle_model_id: request.quote.vehicle_model_id,
      display_name: "Maruti Dzire",
      group_code: "sedan",
      passenger_capacity: 4,
    },
    currency: "INR",
    lines: [{ code: "base_fare", label: "Base fare", amount: 5000 }],
    total: 5000,
    advance: 1400,
    balance: 3600,
    messages: [],
    details: {},
  },
};

test("authenticated booking preserves JSON headers, bearer token and authoritative response", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init ?? {});
    return Response.json({ success: true, booking }, { status: 201 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  assert.deepEqual(await createBooking(request, "  test-access-token  "), booking);
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0]?.headers);
  assert.equal(headers.get("Content-Type"), "application/json");
  assert.equal(headers.get("Authorization"), "Bearer test-access-token");
  assert.deepEqual(JSON.parse(String(calls[0]?.body)), request);
});

// FRONTEND_RULES section 7: guest creation is allowed by default; only the
// backend may enforce CUSTOMER_AUTH_REQUIRED_FOR_NEW_BOOKINGS.
test("anonymous booking preserves JSON without an empty Authorization header", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: RequestInit[] = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(init ?? {});
    return Response.json({ success: true, booking }, { status: 201 });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  for (const token of [null, "", "   "]) {
    assert.deepEqual(await createBooking(request, token), booking);
  }
  assert.equal(calls.length, 3);
  for (const call of calls) {
    const headers = new Headers(call.headers);
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.has("Authorization"), false);
  }
});

test("backend-required authentication is surfaced, never silently bypassed", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: "AUTH_REQUIRED", message: "Sign in required" }, { status: 401 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(createBooking(request, null), { code: "AUTH_REQUIRED", status: 401 });
});

test("invalid booking selection is rejected before sending a request", async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("must not fetch"); };
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(createBooking({ ...request, quote: { ...request.quote, vehicle_model_id: "sedan" } }, "test-token"), {
    code: "INVALID_BOOKING_PAYLOAD", status: 400,
  });
  assert.equal(calls, 0);
});

test("HTTP 201 without a valid persisted booking does not count as success", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true, booking: { id: booking.booking_id } }, { status: 201 });
  t.after(() => { globalThis.fetch = originalFetch; });
  await assert.rejects(createBooking(request, "test-token"));
});
