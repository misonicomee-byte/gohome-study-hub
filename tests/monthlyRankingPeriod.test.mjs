import assert from "node:assert/strict";
import test from "node:test";
import { previousMonthPeriod } from "../scripts/monthly-ranking-data/period.mjs";

test("previousMonthPeriod handles year rollover in JST", () => {
  assert.deepEqual(previousMonthPeriod(new Date("2026-01-04T23:00:00Z")), {
    month: "2025-12", startDate: "2025-12-01", endDate: "2025-12-31", timezone: "Asia/Tokyo",
  });
});

test("previousMonthPeriod handles leap February", () => {
  assert.equal(previousMonthPeriod(new Date("2028-03-05T00:00:00Z")).endDate, "2028-02-29");
});
