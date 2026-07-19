import assert from "node:assert/strict";
import test from "node:test";
import { validateManifest } from "../scripts/monthly-ranking-data/schema.mjs";

const valid = {
  schemaVersion: 1,
  channel: "youtube",
  period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" },
  rankingMetric: "views",
  rankingLabel: "2026年6月の再生回数",
  generatedAt: "2026-07-05T09:00:00+09:00",
  items: [1, 2, 3].map((rank) => ({
    rank,
    contentId: `id-${rank}`,
    title: `title-${rank}`,
    url: "https://example.test",
    publishedAt: "2026-01-01",
    metricValue: 4 - rank,
    secondaryMetricValue: 0,
  })),
};

test("accepts an exact TOP3 manifest", () => assert.equal(validateManifest(valid), valid));
test("rejects fewer than three items", () => assert.throws(() => validateManifest({
  ...valid,
  items: valid.items.slice(0, 2),
}), /exactly 3/));
test("rejects duplicate ranks", () => assert.throws(() => validateManifest({
  ...valid,
  items: valid.items.map((item) => ({ ...item, rank: 1 })),
}), /ranks 1,2,3/));
