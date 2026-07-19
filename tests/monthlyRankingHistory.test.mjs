import assert from "node:assert/strict";
import test from "node:test";
import { recommendStyle, recordStyle, validateHistory } from "../scripts/monthly-ranking-shorts/history.mjs";

test("style recommendation does not repeat the prior month combination", () => {
  const history = [{ channel: "youtube", month: "2026-05", placement: "hook", motion: "cutout-zoom" }];
  assert.notDeepEqual(recommendStyle("youtube", "2026-06", history), {
    placement: "hook",
    motion: "cutout-zoom",
  });
});

test("style rotation is deterministic and differs across channels", () => {
  const youtube = recommendStyle("youtube", "2026-06", []);
  assert.deepEqual(youtube, recommendStyle("youtube", "2026-06", []));
  assert.notDeepEqual(youtube, recommendStyle("blog", "2026-06", []));
});

test("recordStyle keeps only the latest six entries per channel", () => {
  let history = [];
  for (let month = 1; month <= 8; month += 1) {
    history = recordStyle("blog", `2026-${String(month).padStart(2, "0")}`, "chapter", "split-reveal", history);
  }
  assert.deepEqual(history.filter((entry) => entry.channel === "blog").map((entry) => entry.month), [
    "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
  ]);
});

test("history validation rejects duplicate months and unsupported styles", () => {
  assert.throws(() => validateHistory([
    { channel: "youtube", month: "2026-06", placement: "hook", motion: "cutout-zoom" },
    { channel: "youtube", month: "2026-06", placement: "chapter", motion: "split-reveal" },
  ]), /duplicate/i);
  assert.throws(() => validateHistory([
    { channel: "youtube", month: "2026-06", placement: "hook", motion: "spin" },
  ]), /style/i);
});
