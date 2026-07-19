import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildCopy } from "../scripts/monthly-ranking-shorts/copy.mjs";
import {
  parseArgs,
  prepareChannelAssets,
  runMonthlyRanking,
  validateHistoryDocument,
  writeProceduralBgm,
} from "../scripts/monthly-ranking-shorts/orchestrate.mjs";

const CHANNELS = ["youtube", "blog", "instagram"];
const PNG = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");

function manifest(channel, month = "2026-06") {
  return {
    schemaVersion: 1,
    channel,
    period: {
      month,
      startDate: `${month}-01`,
      endDate: `${month}-30`,
      timezone: "Asia/Tokyo",
    },
    rankingMetric: "views",
    rankingLabel: `${month}の閲覧数`,
    generatedAt: "2026-07-01T00:00:00+09:00",
    items: [1, 2, 3].map((rank) => ({
      rank,
      contentId: `${channel}-${rank}`,
      title: `${channel} タイトル ${rank}`,
      url: channel === "blog"
        ? `https://gohome-clinic.com/posts/${rank}`
        : `https://example.test/${channel}/${rank}`,
      publishedAt: `2026-06-0${rank}`,
      metricValue: 1000 - rank,
      secondaryMetricValue: 10 - rank,
    })),
  };
}

function response({ body, contentType, url, status = 200 }) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => name.toLowerCase() === "content-type" ? contentType : null },
    async arrayBuffer() { return data; },
    async text() { return data.toString("utf8"); },
    async json() { return JSON.parse(data.toString("utf8")); },
  };
}

test("CLI accepts only documented options and placement:motion styles", () => {
  assert.deepEqual(parseArgs([
    "--month", "2026-06", "--out", "output/2026-06",
    "--youtube-style", "hook:cutout-zoom",
  ]), {
    month: "2026-06",
    outDir: "output/2026-06",
    styles: { youtube: { placement: "hook", motion: "cutout-zoom" } },
  });
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--publish"]), /unknown option/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--month", "2026-07", "--out", "x"]), /duplicate option/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--blog-style", "hook:wipe"]), /invalid style/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--blog-style", "none:letter-scatter"]), /invalid style/);
});

test("history wrapper schema is validated before entries are used", () => {
  assert.deepEqual(validateHistoryDocument({ schemaVersion: 1, entries: [] }), []);
  assert.throws(() => validateHistoryDocument({ schemaVersion: 2, entries: [] }), /schemaVersion/);
  assert.throws(() => validateHistoryDocument({ schemaVersion: 1, entries: {} }), /entries/);
});

test("package exposes the ranking:shorts CLI without a publishing command", async () => {
  const packageJson = JSON.parse(await readFile(path.join(import.meta.dirname, "../package.json"), "utf8"));
  assert.equal(packageJson.scripts["ranking:shorts"], "node scripts/monthly-ranking-shorts/orchestrate.mjs");
  assert.doesNotMatch(packageJson.scripts["ranking:shorts"], /publish|upload/i);
});

test("procedural BGM is deterministic, valid PCM WAV, and 54 seconds", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-bgm-"));
  const first = path.join(root, "first.wav");
  const second = path.join(root, "second.wav");
  await writeProceduralBgm(first);
  await writeProceduralBgm(second);
  const [a, b] = await Promise.all([readFile(first), readFile(second)]);
  assert.deepEqual(a, b);
  assert.equal(a.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(a.subarray(8, 12).toString("ascii"), "WAVE");
  const sampleRate = a.readUInt32LE(24);
  const dataBytes = a.readUInt32LE(40);
  assert.equal(dataBytes / (sampleRate * 2), 54);
});

test("assets use YouTube thumbnails, blog OG images, and matching Instagram post IDs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-assets-"));
  const requested = [];
  const instagramPosts = [
    { id: "wrong", media_url: "https://cdninstagram.com/wrong.png" },
    { id: "instagram-1", thumbnail_url: "https://cdninstagram.com/right.png" },
    { id: "instagram-2", media_url: "https://cdninstagram.com/two.png" },
    { id: "instagram-3", media_url: "https://cdninstagram.com/three.png" },
  ];
  const fetchImpl = async (url) => {
    requested.push(String(url));
    if (String(url).includes("api=instagram-posts")) {
      return response({ body: JSON.stringify({ posts: instagramPosts }), contentType: "application/json", url: String(url) });
    }
    if (String(url).startsWith("https://gohome-clinic.com/posts/")) {
      const rank = String(url).split("/").at(-1);
      return response({
        body: `<meta property="og:image" content="/media/${rank}.png">`,
        contentType: "text/html", url: String(url),
      });
    }
    return response({ body: PNG, contentType: "image/png", url: String(url) });
  };
  for (const channel of CHANNELS) {
    await prepareChannelAssets({
      manifest: manifest(channel),
      assetsDir: path.join(root, channel),
      fetchImpl,
      env: { CONTENT_ANALYTICS_GAS_URL: "https://script.google.com/macros/s/example/exec" },
    });
  }
  assert(requested.includes("https://i.ytimg.com/vi/youtube-1/hqdefault.jpg"));
  assert(requested.includes("https://gohome-clinic.com/media/1.png"));
  assert(requested.includes("https://cdninstagram.com/right.png"));
  assert(!requested.includes("https://cdninstagram.com/wrong.png"));
});

test("unsafe or failed asset fetches become text-free PNG fallbacks", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-fallback-"));
  const fetchImpl = async (url) => {
    if (String(url).includes("/posts/")) {
      return response({
        body: '<meta property="og:image" content="https://evil.example/private.png">',
        contentType: "text/html", url: String(url),
      });
    }
    throw new Error("network fixture failure");
  };
  const assets = await prepareChannelAssets({
    manifest: manifest("blog"), assetsDir: root, fetchImpl, env: {},
  });
  assert.equal(assets.length, 3);
  for (const asset of assets) {
    const bytes = await readFile(asset);
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  }
});

test("one failed render does not stop other channels and post_caption is copy authority", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-run-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const calls = [];
  const spawnImpl = async (command, args) => {
    calls.push([command, ...args]);
    if (command === "npm") {
      await assert.rejects(access(outDir), /ENOENT/);
      for (const channel of CHANNELS) {
        const directory = path.join(outDir, channel);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, "ranking.json"), `${JSON.stringify(manifest(channel), null, 2)}\n`);
      }
      return;
    }
    const output = args[args.indexOf("--out") + 1];
    if (output.includes(`${path.sep}instagram${path.sep}`)) throw new Error("renderer fixture failed with secret=do-not-copy");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "fixture video");
    await writeFile(path.join(path.dirname(output), "post_caption.txt"), "renderer version");
    await writeFile(output.replace(/\.mp4$/, ".qa.json"), "{}\n");
    await writeFile(output.replace(/\.mp4$/, "-qa-sheet.jpg"), "fixture");
    await writeFile(path.join(path.dirname(output), "captions.json"), "[]\n");
  };
  const fetchImpl = async (url) => {
    if (String(url).includes("api=instagram-posts")) {
      return response({
        body: JSON.stringify({ posts: [1, 2, 3].map((rank) => ({ id: `instagram-${rank}`, media_url: `https://cdninstagram.com/${rank}.png` })) }),
        contentType: "application/json", url: String(url),
      });
    }
    if (String(url).startsWith("https://gohome-clinic.com/posts/")) {
      return response({ body: '<meta property="og:image" content="https://gohome-clinic.com/og.png">', contentType: "text/html", url: String(url) });
    }
    return response({ body: PNG, contentType: "image/png", url: String(url) });
  };
  const result = await runMonthlyRanking({
    month: "2026-06", outDir, spawnImpl, fetchImpl, historyPath,
    env: { CONTENT_ANALYTICS_GAS_URL: "https://script.google.com/macros/s/example/exec" },
  });
  assert.equal(result.youtube.status, "ok");
  assert.equal(result.blog.status, "ok");
  assert.equal(result.instagram.status, "failed");
  assert(!result.instagram.error.includes("do-not-copy"));
  assert.equal(calls.filter(([command]) => command === "python3").length, 3);
  assert(!calls.flat().some((value) => /publish|upload/i.test(String(value))));
  for (const channel of ["youtube", "blog"]) {
    const actual = await readFile(path.join(outDir, channel, "candidate", "post_caption.txt"), "utf8");
    assert.equal(actual, buildCopy(manifest(channel)).postCaption);
    await assert.rejects(stat(path.join(outDir, channel, "candidate", "post-title.txt")));
    await assert.rejects(stat(path.join(outDir, channel, "candidate", "post-description.txt")));
  }
  const summary = JSON.parse(await readFile(path.join(outDir, "run-summary.json"), "utf8"));
  assert.equal(summary.channels.instagram.status, "failed");
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  assert.deepEqual(history.entries.map(({ channel }) => channel).sort(), ["blog", "youtube"]);
});

test("an invalid manifest is not rendered while valid channels still complete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-invalid-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const rendered = [];
  const spawnImpl = async (command, args) => {
    if (command === "npm") {
      for (const channel of CHANNELS) {
        const directory = path.join(outDir, channel);
        await mkdir(directory, { recursive: true });
        const value = channel === "blog" ? { ...manifest(channel), items: [] } : manifest(channel);
        await writeFile(path.join(directory, "ranking.json"), `${JSON.stringify(value)}\n`);
      }
      return;
    }
    const output = args[args.indexOf("--out") + 1];
    rendered.push(output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "fixture video");
    await writeFile(output.replace(/\.mp4$/, ".qa.json"), "{}\n");
    await writeFile(output.replace(/\.mp4$/, "-qa-sheet.jpg"), "fixture");
    await writeFile(path.join(path.dirname(output), "post_caption.txt"), "renderer version");
    await writeFile(path.join(path.dirname(output), "captions.json"), "[]\n");
  };
  const result = await runMonthlyRanking({
    month: "2026-06",
    outDir,
    historyPath,
    spawnImpl,
    fetchImpl: async () => { throw new Error("fixture unavailable"); },
    env: {},
  });
  assert.equal(result.youtube.status, "ok");
  assert.equal(result.blog.status, "failed");
  assert.equal(result.instagram.status, "ok");
  assert.equal(rendered.length, 2);
  assert(!rendered.some((output) => output.includes(`${path.sep}blog${path.sep}`)));
});
