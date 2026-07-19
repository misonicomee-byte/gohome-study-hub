import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseCollectArgs,
  resolveYouTubeAccessToken,
  runCollection,
} from "../scripts/monthly-ranking-data/collect.mjs";

const now = new Date("2026-07-19T00:00:00Z");
const period = {
  month: "2026-06",
  startDate: "2026-06-01",
  endDate: "2026-06-30",
  timezone: "Asia/Tokyo",
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("CLI arguments are strict and reject unknown, duplicate, or missing values", () => {
  assert.deepEqual(parseCollectArgs(["--month", "2026-06", "--out", "output/test"]), {
    month: "2026-06",
    out: "output/test",
  });
  for (const argv of [
    ["2026-06"],
    ["--unknown", "x"],
    ["--month"],
    ["--month", "--out"],
    ["--month", "2026-06", "--month", "2026-05"],
    ["--month=2026-06"],
    ["--out", ""],
  ]) {
    assert.throws(() => parseCollectArgs(argv), /argument|option|value|duplicate/i);
  }
});

test("YouTube access token uses a direct token without a network request", async () => {
  let calls = 0;
  const token = await resolveYouTubeAccessToken({
    env: { YOUTUBE_ACCESS_TOKEN: "direct-test-token" },
    fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
  });
  assert.equal(token, "direct-test-token");
  assert.equal(calls, 0);
});

test("YouTube access token refresh uses Google's OAuth token endpoint", async () => {
  let request;
  const token = await resolveYouTubeAccessToken({
    env: {
      YOUTUBE_REFRESH_TOKEN: "refresh-test-token",
      YOUTUBE_CLIENT_ID: "client-test-id",
      YOUTUBE_CLIENT_SECRET: "client-test-secret",
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ access_token: "refreshed-test-token", expires_in: 3600 });
    },
  });

  assert.equal(token, "refreshed-test-token");
  assert.equal(request.url, "https://oauth2.googleapis.com/token");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request.options.body)), {
    grant_type: "refresh_token",
    refresh_token: "refresh-test-token",
    client_id: "client-test-id",
    client_secret: "client-test-secret",
  });
});

test("CLI validates all required environment configuration before network", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "monthly-ranking-preflight-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const env of [
    { YOUTUBE_ACCESS_TOKEN: "test-token" },
    { CONTENT_ANALYTICS_GAS_URL: "https://example.test/exec" },
    {
      CONTENT_ANALYTICS_GAS_URL: "https://example.test/exec",
      YOUTUBE_REFRESH_TOKEN: "refresh",
      YOUTUBE_CLIENT_ID: "client",
    },
    { CONTENT_ANALYTICS_GAS_URL: "file:///tmp/gas", YOUTUBE_ACCESS_TOKEN: "test-token" },
  ]) {
    await t.test(JSON.stringify(Object.keys(env)), async () => {
      let calls = 0;
      await assert.rejects(
        runCollection({
          argv: ["--month", "2026-06", "--out", join(root, `run-${Math.random()}`)],
          env,
          now,
          fetchImpl: async () => { calls += 1; throw new Error("must not fetch"); },
        }),
        /(CONTENT_ANALYTICS_GAS_URL|YouTube|credentials|URL)/i,
      );
      assert.equal(calls, 0);
    });
  }
});

test("fixture-injected CLI writes all three validated manifests with the fixed channel id", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "monthly-ranking-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "2026-06");
  let analyticsChannelId;

  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    if (parsed.hostname === "youtubeanalytics.googleapis.com") {
      analyticsChannelId = parsed.searchParams.get("ids");
      return jsonResponse({ rows: [
        ["short-a", "SHORTS", 30, 3],
        ["short-b", "SHORTS", 20, 2],
        ["short-c", "SHORTS", 10, 1],
      ] });
    }
    if (parsed.hostname === "www.googleapis.com") {
      return jsonResponse({ items: parsed.searchParams.get("id").split(",").map((id) => ({
        id,
        snippet: { title: id, publishedAt: "2026-01-01T00:00:00Z" },
      })) });
    }
    if (parsed.searchParams.get("api") === "blog-ranking") {
      return jsonResponse({
        period: { startDate: period.startDate, endDate: period.endDate },
        data: [1, 2, 3].map((rank) => ({
          url: `https://gohome-clinic.com/2026/01/0${rank}/blog-${rank}/`,
          title: `blog-${rank}`,
          date: `2026-01-0${rank}`,
          pageViews: 4 - rank,
          totalUsers: 1,
        })),
      });
    }
    if (parsed.searchParams.get("api") === "instagram-monthly-ranking") {
      return jsonResponse({
        partial: false,
        period: { ...period, boundarySnapshotDate: "2026-07-01" },
        data: [1, 2, 3].map((rank) => ({
          id: `post-${rank}`,
          caption: `post-${rank}`,
          permalink: `https://www.instagram.com/p/post-${rank}/`,
          timestamp: `2026-01-0${rank}T00:00:00Z`,
          viewsDelta: 4 - rank,
          totalInteractionsDelta: 1,
        })),
      });
    }
    throw new Error(`unexpected fixture URL ${parsed}`);
  };

  const result = await runCollection({
    argv: ["--month", "2026-06", "--out", out],
    env: {
      CONTENT_ANALYTICS_GAS_URL: "https://example.test/exec",
      YOUTUBE_ACCESS_TOKEN: "fixture-access-token",
    },
    fetchImpl,
    now,
  });

  assert.equal(result.out, out);
  assert.equal(analyticsChannelId, "channel==UCJ2B_z_pz0R_yTZkRbSl4Lg");
  for (const channel of ["youtube", "blog", "instagram"]) {
    const manifest = JSON.parse(await readFile(join(out, channel, "ranking.json"), "utf8"));
    assert.equal(manifest.channel, channel);
    assert.equal(manifest.items.length, 3);
  }
});

test("collector failure leaves no mixed final manifest directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "monthly-ranking-atomic-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const out = join(root, "failed-run");
  const manifest = (channel) => ({
    schemaVersion: 1,
    channel,
    period,
    rankingMetric: "fixture",
    rankingLabel: "fixture",
    generatedAt: "2026-07-19T00:00:00Z",
    items: [1, 2, 3].map((rank) => ({
      rank,
      contentId: `${channel}-${rank}`,
      title: `${channel}-${rank}`,
      url: `https://example.test/${channel}/${rank}`,
      publishedAt: "2026-01-01",
      metricValue: 4 - rank,
      secondaryMetricValue: 1,
    })),
  });

  await assert.rejects(
    runCollection({
      argv: ["--month", "2026-06", "--out", out],
      env: { CONTENT_ANALYTICS_GAS_URL: "https://example.test/exec", YOUTUBE_ACCESS_TOKEN: "test-token" },
      now,
      fetchImpl: async () => { throw new Error("network must not be used by injected collectors"); },
      collectors: {
        youtube: async () => manifest("youtube"),
        blog: async () => manifest("blog"),
        instagram: async () => { throw new Error("fixture Instagram failure"); },
      },
    }),
    /fixture Instagram failure/,
  );
  await assert.rejects(access(out));
  assert.deepEqual(await readdir(root), []);
});
