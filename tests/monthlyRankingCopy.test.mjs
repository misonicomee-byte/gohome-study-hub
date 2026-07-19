import assert from "node:assert/strict";
import test from "node:test";
import { buildCopy } from "../scripts/monthly-ranking-shorts/copy.mjs";

const manifest = {
  schemaVersion: 1,
  channel: "youtube",
  period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" },
  rankingMetric: "views",
  rankingLabel: "2026-06の再生回数",
  generatedAt: "2026-07-05T09:00:00+09:00",
  items: [1, 2, 3].map((rank) => ({
    rank,
    contentId: `id-${rank}`,
    title: `タイトル${rank}`,
    metricValue: rank * 100,
    secondaryMetricValue: 0,
    publishedAt: "2026-01-01",
    url: `https://example.test/${rank}`,
  })),
};

test("copy preserves all titles, metrics, and URLs without evaluative claims", () => {
  const copy = buildCopy(manifest);
  for (const item of manifest.items) {
    assert.match(copy.narration, new RegExp(item.title));
    assert.match(copy.narration, new RegExp(String(item.metricValue)));
    assert.match(copy.postCaption, new RegExp(item.url.replaceAll("/", "\\/")));
  }
  assert.doesNotMatch(copy.narration + copy.postCaption, /治る|必ず|最高の医療/);
});

test("post caption follows the one-file copy-paste format", () => {
  const copy = buildCopy(manifest);
  assert.match(copy.postCaption, /^■タイトル\n.+\n\n■説明文\n/s);
  assert.match(copy.postCaption, /ごうホームクリニック\nhttps:\/\/gohome-clinic\.com\/\n/);
  assert.match(copy.postCaption, /※本動画はAIを活用して制作/);
  assert.match(copy.postCaption, /#ごうホームクリニック .+#YouTubeShorts\n$/);
  assert.equal(copy.postCaption.includes("■クリニックURL"), false);
  assert.equal(copy.postCaption.includes("■ハッシュタグ"), false);
  assert.match(copy.postCaption, /https:\/\/example\.test\/1[\s\S]+https:\/\/example\.test\/2[\s\S]+https:\/\/example\.test\/3/);
  assert.ok(copy.postCaption.indexOf("https://gohome-clinic.com/") < copy.postCaption.indexOf("#ごうホームクリニック"));
});

test("captions reveal ranks 3, 2, 1 and use natural Japanese month text", () => {
  const copy = buildCopy(manifest);
  assert.deepEqual(copy.captions.slice(1, 4).map((caption) => caption.rank), [3, 2, 1]);
  assert.match(copy.narration, /^2026年6月/);
  assert.doesNotMatch(copy.narration, /2026-06/);
});

test("Instagram initial fallback is not described as a monthly increase", () => {
  const copy = buildCopy({
    ...manifest,
    channel: "instagram",
    rankingMetric: "currentViewsOfPostsPublishedInMonth",
    rankingMode: "initialPublishedMonthCurrentViews",
    rankingLabel: "2026-06公開投稿の現在views TOP3（初回限定・月内増加数ではありません）",
  });
  assert.match(copy.postCaption, /現在の閲覧数/);
  assert.match(copy.postCaption, /月内の増加数ではありません/);
});

test("Podcast copy accurately describes monthly YouTube view growth as popularity", () => {
  const copy = buildCopy({
    ...manifest,
    channel: "podcast",
    rankingLabel: "前月（2026-06）中に増えたYouTube再生回数",
    items: manifest.items.map((item, index) => ({
      ...item,
      url: `https://podcasters.spotify.com/pod/show/go-ito/episodes/episode-${index}`,
      imageUrl: `https://d3t3ozftmdmh3i.cloudfront.net/${index}.jpg`,
    })),
  });
  assert.match(copy.postCaption, /ポッドキャスト 人気コンテンツTOP3/);
  assert.match(copy.postCaption, /前月.*中に増えたYouTube再生回数/);
  assert.match(copy.postCaption, /#ポッドキャスト/);
  assert.doesNotMatch(copy.postCaption, /新着/);
});

test("rejects malformed periods, prototype channels, injection, claims, and unsafe URLs", () => {
  assert.throws(() => buildCopy({ ...manifest, channel: "constructor" }));
  assert.throws(() => buildCopy({ ...manifest, period: { ...manifest.period, endDate: "2026-06-29" } }));
  assert.throws(() => buildCopy({ ...manifest, items: manifest.items.map((item, index) => index ? item : { ...item, title: "安全\n#偽タグ" }) }));
  assert.throws(() => buildCopy({ ...manifest, items: manifest.items.map((item, index) => index ? item : { ...item, title: "必ず治る記事" }) }));
  assert.throws(() => buildCopy({ ...manifest, items: manifest.items.map((item, index) => index ? item : { ...item, url: "https://user:pass@example.test/1" }) }));
});

test("rejects broader medical claims in titles and ranking labels", () => {
  assert.throws(() => buildCopy({
    ...manifest,
    rankingLabel: "症状が改善します",
  }), /claim/i);
  assert.throws(() => buildCopy({
    ...manifest,
    items: manifest.items.map((item, index) => index
      ? item
      : { ...item, title: "病気を予防できます" }),
  }), /claim/i);
});

test("rejects non-canonical HTTPS URLs and fallback metadata mismatches", () => {
  assert.throws(() => buildCopy({
    ...manifest,
    items: manifest.items.map((item, index) => index
      ? item
      : { ...item, url: "https://example.test/space here" }),
  }), /URL/i);
  assert.throws(() => buildCopy({
    ...manifest,
    channel: "youtube",
    rankingMetric: "currentViewsOfPostsPublishedInMonth",
    rankingMode: "initialPublishedMonthCurrentViews",
  }), /fallback/i);
  assert.throws(() => buildCopy({
    ...manifest,
    channel: "instagram",
    rankingMode: "initialPublishedMonthCurrentViews",
  }), /fallback/i);
});
