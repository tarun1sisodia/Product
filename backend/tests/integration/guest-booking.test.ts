import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerBookingsRoutes } from "../../src/modules/bookings/bookings.routes.js";
import { BookingsService } from "../../src/modules/bookings/bookings.service.js";
import type { BookingsRepository, BookingEntity } from "../../src/modules/bookings/bookings.repository.js";
import type { QuotesService } from "../../src/modules/quotes/quotes.service.js";
import type { CreateBookingRequest, QuoteResponse } from "../../src/contracts/fare-system.js";

const quote: QuoteResponse = {
  category: "outstation",
  vehicle: { vehicle_model_id: "10000000-0000-0000-0002-000000000001", display_name: "Dzire", group_code: "sedan", passenger_capacity: 4 },
  currency: "INR", lines: [{ code: "base_fare", label: "Base fare", amount: 5000 }],
  total: 5000, advance: 1400, balance: 3600, messages: [], details: {},
};
const payload: CreateBookingRequest = {
  quote: { category: "outstation", vehicle_model_id: quote.vehicle.vehicle_model_id, route_id: "20000000-0000-0000-0001-000000000001", trip_type: "one_way", passenger_count: 2, pickup_at: new Date(Date.now() + 86400000).toISOString() },
  quoted_total: 5000, customer_name: "Guest Customer", customer_phone: "+919876543210", pickup_address: "Tajganj, Agra",
};

// Real HTTP validation + booking service; injected quote/persistence boundaries.
// These tests do NOT exercise PostgreSQL, a live gateway, or a browser journey.
function setup(requireAuth = false, authenticated = false) {
  const app = Fastify();
  const create = vi.fn(async (data: Parameters<BookingsRepository["create"]>[0]) => ({
    ...data, id: "11111111-1111-4111-a111-111111111111", status: "pending_payment", balance_amount: 3600,
  }) as BookingEntity);
  const recompute = vi.fn(async () => quote);
  const service = new BookingsService(
    { create } as unknown as BookingsRepository,
    { quote: recompute } as unknown as QuotesService,
  );
  if (authenticated) {
    app.addHook("onRequest", async (req) => {
      req.user = { id: "11111111-1111-4111-a111-111111111112", role: "customer", email: "test@example.test", phone: null };
    });
  }
  registerBookingsRoutes(app, service, requireAuth);
  return { app, create, recompute };
}

describe("FRONTEND_RULES §7: configurable guest creation on canonical booking routes", () => {
  it.each(["/bookings", "/api/v1/bookings"])("allows guests by default at %s and generates a private token", async (url) => {
    const { app, create, recompute } = setup();
    try {
      const res = await app.inject({ method: "POST", url, payload });
      expect(res.statusCode).toBe(201);
      expect(create).toHaveBeenCalledOnce();
      expect(recompute).toHaveBeenCalledWith(payload.quote);
      expect(create.mock.calls[0]?.[0]).toMatchObject({ user_id: null, total_amount: 5000, advance_amount: 1400 });
      expect(res.json().booking.guest_access_token).toMatch(/^[a-f0-9]{64}$/);
      expect(res.json().booking.status).toBe("pending_payment");
    } finally { await app.close(); }
  });

  it("enforces CUSTOMER_AUTH_REQUIRED_FOR_NEW_BOOKINGS before quoting or persisting", async () => {
    const { app, create, recompute } = setup(true);
    try {
      const res = await app.inject({ method: "POST", url: "/api/v1/bookings", payload });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe("AUTH_REQUIRED");
      expect(create).not.toHaveBeenCalled();
      expect(recompute).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("retains authenticated customer ownership when sign-in is required", async () => {
    const { app, create } = setup(true, true);
    try {
      const res = await app.inject({ method: "POST", url: "/api/v1/bookings", payload });
      expect(res.statusCode).toBe(201);
      expect(create.mock.calls[0]?.[0].user_id).toBe("11111111-1111-4111-a111-111111111112");
    } finally { await app.close(); }
  });

  it("never accepts the anonymous caller's total as financial truth", async () => {
    const { app, create, recompute } = setup();
    try {
      const res = await app.inject({ method: "POST", url: "/api/v1/bookings", payload: { ...payload, quoted_total: 1 } });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe("PRICE_CHANGED");
      expect(res.json().fresh_quote.total).toBe(5000);
      expect(recompute).toHaveBeenCalledOnce();
      expect(create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("rejects malformed requests without calculating or writing a booking", async () => {
    const { app, create, recompute } = setup();
    try {
      const res = await app.inject({ method: "POST", url: "/api/v1/bookings", payload: { ...payload, quote: { ...payload.quote, vehicle_model_id: "sedan" } } });
      expect(res.statusCode).toBe(400);
      expect(create).not.toHaveBeenCalled();
      expect(recompute).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
