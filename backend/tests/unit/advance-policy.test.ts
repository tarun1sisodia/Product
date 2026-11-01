import { describe, expect, it } from "vitest";
import { finalizeQuote } from "../../src/modules/fare-engine/finalizer.js";
import { advanceOf } from "../../src/shared/money.js";
import type { CategoryCode } from "../../src/contracts/fare-system.js";

// Independent fixed examples from BACKEND_RULES Law 2 and
// BACKEND_ARCHITECTURE §5: nearest ₹100, ₹500 floor, capped at total.
const examples = [
  [1, 1], [499, 499], [500, 500], [1200, 500], [1785, 500],
  [3500, 1000], [4320, 1200], [4600, 1300], [9250, 2600],
  [15450, 4300], [20893, 5900], [100000, 28000],
] as const;
const categories: CategoryCode[] = ["outstation", "local_package", "transfer", "tour_package"];
function quote(total: number, category: CategoryCode = "outstation", advancePercent = 28) {
  return finalizeQuote({
    category,
    vehicle: { vehicle_model_id: "10000000-0000-0000-0002-000000000001", display_name: "Dzire", group_code: "sedan", passenger_capacity: 4 },
    lines: [{ code: "base_fare", label: "Base fare", amount: total }],
    messages: [], advancePercent, details: {},
  });
}
describe("Documented advance policy across both fare engines", () => {
  for (const category of categories) {
    it.each(examples)(`${category}: total ₹%i requires ₹%i advance`, (total, advance) => {
      const result = quote(total, category);
      expect(result.total).toBe(total);
      expect(result.advance).toBe(advance);
      expect(result.balance).toBe(total - advance);
      expect(result.advance).toBe(advanceOf(total));
    });
  }
  it("applies the same hundred-rupee rounding and floor to admin-configured rates", () => {
    expect(quote(3100, "outstation", 20).advance).toBe(600);
    expect(quote(1900, "local_package", 20).advance).toBe(500);
  });
});
