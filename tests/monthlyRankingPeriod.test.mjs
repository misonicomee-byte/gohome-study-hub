import assert from "node:assert/strict";
import test from "node:test";
import { periodFromMonth, previousMonthPeriod } from "../scripts/monthly-ranking-data/period.mjs";

test("previousMonthPeriod handles year rollover in JST", () => {
  assert.deepEqual(previousMonthPeriod(new Date("2026-01-04T23:00:00Z")), {
    month: "2025-12", startDate: "2025-12-01", endDate: "2025-12-31", timezone: "Asia/Tokyo",
  });
});

test("previousMonthPeriod handles leap February", () => {
  assert.equal(previousMonthPeriod(new Date("2028-03-05T00:00:00Z")).endDate, "2028-02-29");
});

test("periodFromMonth returns real month boundaries", () => {
  assert.deepEqual(periodFromMonth("2028-02", new Date("2028-03-05T00:00:00Z")), {
    month: "2028-02", startDate: "2028-02-01", endDate: "2028-02-29", timezone: "Asia/Tokyo",
  });
});

test("periodFromMonth rejects malformed, year-zero, and future JST months", () => {
  const now = new Date("2026-06-30T15:30:00Z"); // 2026-07-01 00:30 JST
  for (const month of ["2026-7", "2026-13", "0000-12", "2026-08"]) {
    assert.throws(() => periodFromMonth(month, now), /month/i);
  }
  assert.equal(periodFromMonth("2026-07", now).month, "2026-07");
});
