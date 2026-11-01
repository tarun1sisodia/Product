import { beforeEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { createPostgresRepositories } from "../../src/db/postgres.js";
import { createMemoryRepositories } from "../../src/db/memory.js";
import { PaymentsRepository } from "../../src/modules/payments/payments.repository.js";
import type { BookingRecord, PaymentRecord } from "../../src/types/domain.js";

const sql = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      on() {}
      connect = async () => sql;
    },
  },
}));

const capture = { paymentId: "payment-1", bookingId: "booking-1", providerPaymentId: "pay_verified", webhookEventId: "event-1" };
const review = { paymentId: "payment-1", reason: "amount_mismatch", webhookEventId: "event-1" };

// These are SQL contract tests, not evidence that migrations have run on PostgreSQL.
describe.each([
  ["shared PostgreSQL repository", async () => (await createPostgresRepositories("postgres://test:test@localhost/test")).payments],
  ["checkout PostgreSQL repository", async () => new PaymentsRepository({ connect: async () => sql } as unknown as pg.Pool)],
] as const)("%s follows docs/PAYMENT_SYSTEM.md", (_name, repository) => {
  beforeEach(() => {
    sql.query.mockReset().mockResolvedValue({ rows: [{ id: "booking-1", status: "pending_payment" }], rowCount: 1 });
    sql.release.mockClear();
  });

  it("writes paid_confirmed for a draft or pending booking before committing the event", async () => {
    await (await repository()).processCaptured(capture);
    const statements = sql.query.mock.calls.map(([statement]) => String(statement).replace(/\s+/g, " ").trim().toLowerCase());
    expect(statements[0]).toBe("begin");
    expect(statements).toContainEqual(expect.stringContaining("for update"));
    const bookingUpdate = statements.find((statement) => statement.startsWith("update bookings"));
    expect(bookingUpdate).toMatch(/status\s*=\s*'paid_confirmed'/);
    expect(bookingUpdate).toMatch(/status in \('draft', 'pending_payment'\)/);
    const eventIndex = statements.findIndex((statement) => statement.startsWith("update payment_webhook_events"));
    expect(eventIndex).toBeGreaterThan(statements.indexOf(bookingUpdate!));
    expect(statements.at(-1)).toBe("commit");
    expect(sql.release).toHaveBeenCalledOnce();
  });

  it.each(["cancelled", "refunded"])("rolls back without confirming a %s booking", async (status) => {
    sql.query.mockImplementation(async (statement: string) => ({
      rows: /select.*bookings/i.test(statement) ? [{ id: "booking-1", status }] : [],
      rowCount: 1,
    }));
    await expect((await repository()).processCaptured(capture)).rejects.toThrow(/cancelled/i);
    const statements = sql.query.mock.calls.map(([statement]) => String(statement).trim().toLowerCase());
    expect(statements.at(-1)).toBe("rollback");
    expect(statements.some((statement) => statement.startsWith("update"))).toBe(false);
    expect(sql.release).toHaveBeenCalledOnce();
  });

  it("marks both payment state and reconciliation state needs_review, without changing the booking", async () => {
    await (await repository()).processNeedsReview(review);
    const statements = sql.query.mock.calls.map(([statement]) => String(statement).toLowerCase());
    const paymentUpdate = statements.find((statement) => statement.includes("update payments"));
    expect(paymentUpdate).toMatch(/status\s*=\s*'needs_review'/);
    expect(paymentUpdate).toMatch(/reconciliation_status\s*=\s*'needs_review'/);
    expect(statements.some((statement) => statement.includes("update bookings"))).toBe(false);
    expect(statements.at(-1)).toBe("commit");
  });
});

const now = "2026-11-01T12:00:00.000Z";
function booking(status: BookingRecord["status"]): BookingRecord {
  const fareSnapshot: BookingRecord["fareSnapshot"] = {
    baseFare: 2500, nightAllowance: 0, driverAllowance: 0, discountAmount: 0,
    totalFare: 2500, advanceAmount: 700, balanceAmount: 1800, currency: "INR",
    fareVersion: "test", label: "Test fare", duration: "4 hours", distanceKm: 230,
    billedKm: 230, alwaysRoundTrip: false, tripType: "one-way", vehicleTier: "sedan",
    promoCode: null, promoValid: false, roundMultiplierApplied: false, rules: [],
  };
  return {
    id: capture.bookingId, ticketId: "AGR-20261101-TEST", userId: null, guestAccessToken: "test-guest-token",
    tripType: "one-way", vehicleTier: "sedan", originName: "Agra", destinationName: "Delhi",
    bookingSelection: null, selectedCatalogItemId: null, pickupAddress: "Agra station", dropAddress: null,
    pickupDatetime: now, returnDatetime: null, flightTrainNumber: null, distanceKm: 230,
    customerName: "Test Customer", customerPhone: "+919876543210", customerEmail: null,
    baseFare: 2500, nightAllowance: 0, driverAllowance: 0, discountAmount: 0, promoCode: null,
    totalFare: 2500, advanceAmount: 700, balanceAmount: 1800, fareRulesVersion: "test", fareSnapshot,
    status, version: 0, specialNotes: null, packageId: null, createdAt: now, updatedAt: now,
  };
}
function payment(): PaymentRecord {
  return {
    id: capture.paymentId, bookingId: capture.bookingId, provider: "razorpay", providerOrderId: "order-test",
    providerPaymentId: null, checkoutSessionId: null, checkoutUrl: null, publicClientToken: null,
    amountMinor: 70000, currency: "INR", inrAmountPaise: 70000, status: "pending", paymentMethod: null,
    feeMinor: 0, taxMinor: 0, idempotencyKey: "test-payment", webhookEventId: null,
    reconciliationStatus: "pending", failureReason: null, verifiedAt: null, expiresAt: now, createdAt: now, updatedAt: now,
  };
}

describe("memory repository payment-state parity", () => {
  it.each(["draft", "pending_payment"] as const)("confirms a %s booking as paid_confirmed", async (status) => {
    const repos = createMemoryRepositories(now);
    await repos.bookings.create(booking(status));
    await repos.payments.create(payment());
    await repos.payments.processCaptured(capture);
    expect((await repos.bookings.getById(capture.bookingId))?.status).toBe("paid_confirmed");
    expect(await repos.payments.getByProviderOrderId("order-test")).toMatchObject({ status: "captured", reconciliationStatus: "matched" });
  });

  it.each(["cancelled", "refunded"] as const)("leaves a %s booking and payment unchanged", async (status) => {
    const repos = createMemoryRepositories(now);
    await repos.bookings.create(booking(status));
    await repos.payments.create(payment());
    await expect(repos.payments.processCaptured(capture)).rejects.toThrow(/cancelled/i);
    expect((await repos.bookings.getById(capture.bookingId))?.status).toBe(status);
    expect((await repos.payments.getByProviderOrderId("order-test"))?.status).toBe("pending");
  });

  it.each(["paid_confirmed", "in_transit", "completed"] as const)("does not rewind a %s booking on capture replay", async (status) => {
    const repos = createMemoryRepositories(now);
    await repos.bookings.create(booking(status));
    await repos.payments.create(payment());
    await repos.payments.processCaptured(capture);
    await repos.payments.processCaptured(capture);
    expect((await repos.bookings.getById(capture.bookingId))?.status).toBe(status);
  });

  it("persists needs_review reconciliation without confirming the booking", async () => {
    const repos = createMemoryRepositories(now);
    await repos.bookings.create(booking("pending_payment"));
    await repos.payments.create(payment());
    await repos.payments.processNeedsReview(review);
    expect(await repos.payments.getByProviderOrderId("order-test")).toMatchObject({ status: "needs_review", reconciliationStatus: "needs_review", failureReason: "amount_mismatch" });
    expect((await repos.bookings.getById(capture.bookingId))?.status).toBe("pending_payment");
  });
});
