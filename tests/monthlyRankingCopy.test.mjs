import assert from "node:assert/strict";
import test from "node:test";
import { buildCopy } from "../scripts/monthly-ranking-shorts/copy.mjs";

const manifest = {
  channel: "youtube",
  period: { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", timezone: "Asia/Tokyo" },
  rankingLabel: "2026年6月中に増えた再生回数",
  items: [1, 2, 3].map((rank) => ({
    rank,
    title: `タイトル${rank}`,
    metricValue: rank * 100,
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
});

test("captions reveal ranks 3, 2, 1 and use natural Japanese month text", () => {
  const copy = buildCopy(manifest);
  assert.deepEqual(copy.captions.slice(1, 4).map((caption) => caption.rank), [3, 2, 1]);
  assert.match(copy.narration, /^2026年6月/);
  assert.doesNotMatch(copy.narration, /2026-06/);
});
