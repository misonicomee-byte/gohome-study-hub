import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { validateManifest, writeManifest } from "../scripts/monthly-ranking-data/schema.mjs";

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
test("accepts Podcast items only with canonical Spotify and RSS image metadata", () => {
  const podcast = {
    ...valid,
    channel: "podcast",
    items: valid.items.map((item, index) => ({
      ...item,
      url: `https://podcasters.spotify.com/pod/show/go-ito/episodes/episode-${index}`,
      imageUrl: `https://d3t3ozftmdmh3i.cloudfront.net/${index}.jpg`,
    })),
  };
  assert.equal(validateManifest(podcast), podcast);
  assert.throws(() => validateManifest({
    ...podcast,
    items: podcast.items.map((item, index) => index ? item : { ...item, imageUrl: "https://evil.example/1.jpg" }),
  }), /image/i);
});
test("rejects fewer than three items", () => assert.throws(() => validateManifest({
  ...valid,
  items: valid.items.slice(0, 2),
}), /exactly 3/));
test("rejects duplicate ranks", () => assert.throws(() => validateManifest({
  ...valid,
  items: valid.items.map((item) => ({ ...item, rank: 1 })),
}), /ranks 1,2,3/));

test("rejects partial-month period boundaries", () => {
  for (const period of [
    { ...valid.period, startDate: "2026-06-02" },
    { ...valid.period, endDate: "2026-06-29" },
  ]) {
    assert.throws(() => validateManifest({ ...valid, period }), /calendar day of period.month/);
  }
});

test("accepts a full leap-February period", () => {
  const leapFebruary = {
    ...valid,
    period: { month: "2028-02", startDate: "2028-02-01", endDate: "2028-02-29", timezone: "Asia/Tokyo" },
  };
  assert.equal(validateManifest(leapFebruary), leapFebruary);
});

test("rejects required manifest metadata when missing or invalid", () => {
  const invalidManifests = [
    { ...valid, period: { ...valid.period, month: undefined } },
    { ...valid, period: { ...valid.period, month: "2026-13" } },
    { ...valid, period: { ...valid.period, startDate: undefined } },
    { ...valid, period: { ...valid.period, startDate: "2026-06-31" } },
    { ...valid, period: { ...valid.period, endDate: undefined } },
    { ...valid, period: { ...valid.period, endDate: "2026-07-01" } },
    { ...valid, period: { ...valid.period, startDate: "2026-06-30", endDate: "2026-06-01" } },
    { ...valid, rankingMetric: undefined },
    { ...valid, rankingMetric: "" },
    { ...valid, rankingLabel: undefined },
    { ...valid, generatedAt: undefined },
    { ...valid, generatedAt: "2026-02-30T09:00:00+09:00" },
  ];

  for (const manifest of invalidManifests) {
    assert.throws(() => validateManifest(manifest));
  }
});

test("rejects required item fields when missing or invalid", () => {
  const invalidItems = [
    { ...valid.items[0], contentId: undefined },
    { ...valid.items[0], contentId: "" },
    { ...valid.items[0], title: undefined },
    { ...valid.items[0], url: undefined },
    { ...valid.items[0], url: "not a URL" },
    { ...valid.items[0], publishedAt: undefined },
    { ...valid.items[0], publishedAt: "2026-02-30" },
    { ...valid.items[0], metricValue: undefined },
    { ...valid.items[0], metricValue: Number.NaN },
    { ...valid.items[0], secondaryMetricValue: undefined },
    { ...valid.items[0], secondaryMetricValue: Number.POSITIVE_INFINITY },
  ];

  for (const item of invalidItems) {
    assert.throws(() => validateManifest({ ...valid, items: [item, ...valid.items.slice(1)] }));
  }
});

test("writeManifest creates parent directories and writes stable JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "monthly-ranking-schema-"));
  const path = join(directory, "nested", "ranking.json");
  try {
    await writeManifest(path, valid);
    const contents = await readFile(path, "utf8");
    assert.equal(contents, `${JSON.stringify(valid, null, 2)}\n`);
    assert.deepEqual(JSON.parse(contents), valid);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
