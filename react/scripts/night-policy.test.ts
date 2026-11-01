import assert from "node:assert/strict";
import test from "node:test";
import { checkIsNightPickup } from "../src/utils/customDistance.ts";
import { isNightTime } from "../src/fares.ts";

test("all customer fare estimators use the documented 22:00–05:00 night window", () => {
  for (const [time, expected] of [["20:00", false], ["21:59", false], ["22:00", true], ["23:59", true], ["00:00", true], ["04:59", true], ["05:00", false], ["05:59", false], ["12:00", false]] as const) {
    assert.equal(checkIsNightPickup(time), expected, `custom estimator at ${time}`);
    assert.equal(isNightTime(time), expected, `fare preview at ${time}`);
  }
});

test("malformed pickup times never add an estimated night charge", () => {
  for (const time of ["", " ", "24:00", "25:15", "-1:00", "22:60", "night", "22:00extra"]) {
    assert.equal(checkIsNightPickup(time), false, time);
    assert.equal(isNightTime(time), false, time);
  }
});
