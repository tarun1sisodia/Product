import { describe, expect, it } from "vitest";
import { isPickupInNightWindow } from "../../src/modules/fare-engine/datetime.js";
import { isNightPickup } from "../../src/modules/fares/rules/night.rules.js";

const boundaries = [["20:00", false], ["21:59", false], ["22:00", true], ["23:59", true], ["00:00", true], ["04:59", true], ["05:00", false], ["05:59", false], ["12:00", false]] as const;
describe("BACKEND_RULES Law 2: default night window is 22:00–05:00 IST", () => {
  it.each(boundaries)("%s is night=%s in both fare engines", (time, expected) => {
    const pickup = `2026-11-15T${time}:00+05:30`;
    expect(isPickupInNightWindow(pickup)).toBe(expected);
    expect(isNightPickup(pickup)).toBe(expected);
    // The same instant expressed in UTC must have identical IST classification.
    expect(isPickupInNightWindow(new Date(pickup).toISOString())).toBe(expected);
  });
  it("keeps explicitly configured night-window overrides authoritative", () => {
    const pickup = "2026-11-15T20:00:00+05:30";
    expect(isPickupInNightWindow(pickup, 20, 6)).toBe(true);
    expect(isNightPickup(pickup, { nightStartHour: 20, nightEndHour: 6 })).toBe(true);
  });
});
