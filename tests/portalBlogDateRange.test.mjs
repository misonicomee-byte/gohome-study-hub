import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
  new URL("../src/data/portal.ts", import.meta.url),
  "utf8",
);

function loadRollingBlogDateRange() {
  const match = source.match(
    /export function rollingBlogDateRange\(now = new Date\(\)\) \{[\s\S]*?\n\}/,
  );
  assert.ok(match, "portal should expose rollingBlogDateRange");

  const context = vm.createContext({ Date, Intl, Object, Number, String });
  vm.runInContext(match[0].replace("export ", ""), context);
  return context.rollingBlogDateRange;
}

test("rolling blog period contains 180 Asia/Tokyo calendar dates", () => {
  const rollingBlogDateRange = loadRollingBlogDateRange();

  assert.deepEqual(
    { ...rollingBlogDateRange(new Date("2026-07-18T14:59:59.999Z")) },
    { startDate: "2026-01-20", endDate: "2026-07-18" },
  );
  assert.deepEqual(
    { ...rollingBlogDateRange(new Date("2026-07-18T15:00:00.000Z")) },
    { startDate: "2026-01-21", endDate: "2026-07-19" },
  );
});

test("portal blog request sends explicit dates without the retired days parameter", () => {
  const fetchSource = source.match(
    /async function fetchBlogFromGAS\(\): Promise<BlogPost\[]> \{[\s\S]*?\n\}/,
  )?.[0] ?? "";

  assert.match(fetchSource, /new URL\(GAS_URL\)/);
  assert.match(fetchSource, /new URLSearchParams\(\{/);
  assert.match(fetchSource, /api:\s*"blog-ranking"/);
  assert.match(fetchSource, /startDate/);
  assert.match(fetchSource, /endDate/);
  assert.match(fetchSource, /limit:\s*"100"/);
  assert.doesNotMatch(fetchSource, /\bdays\b/);
  assert.match(source, /let _blogCachePromise: Promise<BlogPost\[]> \| null = null/);
  assert.match(fetchSource, /if \(_blogCachePromise\) return _blogCachePromise/);
});
