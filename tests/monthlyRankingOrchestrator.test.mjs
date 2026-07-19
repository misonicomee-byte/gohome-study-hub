import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readdir, stat, utimes, writeFile } from "node:fs/promises";
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

const CHANNELS = ["youtube", "blog", "instagram", "podcast"];
const PNG = Buffer.from("89504e470d0a1a0a0000000049454e44ae426082", "hex");
const PUBLIC_DNS = async () => [{ address: "93.184.216.34", family: 4 }];

function manifest(channel, month = "2026-06") {
  const [year, monthNumber] = month.split("-").map(Number);
  const endDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    schemaVersion: 1,
    channel,
    period: {
      month,
      startDate: `${month}-01`,
      endDate: `${month}-${String(endDay).padStart(2, "0")}`,
      timezone: "Asia/Tokyo",
    },
    rankingMetric: "views",
    rankingLabel: channel === "podcast" ? `前月（${month}）中に増えたYouTube再生回数` : `${month}の閲覧数`,
    generatedAt: "2026-07-01T00:00:00+09:00",
    items: [1, 2, 3].map((rank) => ({
      rank,
      contentId: `${channel}-${rank}`,
      title: `${channel} タイトル ${rank}`,
      url: channel === "blog"
        ? `https://gohome-clinic.com/posts/${rank}`
        : channel === "podcast"
          ? `https://podcasters.spotify.com/pod/show/go-ito/episodes/podcast-${rank}`
          : `https://example.test/${channel}/${rank}`,
      ...(channel === "podcast" ? {
        imageUrl: `https://d3t3ozftmdmh3i.cloudfront.net/podcast-${rank}.jpg`,
      } : {}),
      publishedAt: `2026-06-0${rank}`,
      metricValue: 1000 - rank,
      secondaryMetricValue: 10 - rank,
    })),
  };
}

function response({ body, contentType, url, status = 200, location, contentLength, chunks }) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const bodyChunks = chunks ?? [data];
  let cancelled = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: (name) => {
      if (name.toLowerCase() === "content-type") return contentType;
      if (name.toLowerCase() === "location") return location ?? null;
      if (name.toLowerCase() === "content-length") return contentLength ?? null;
      return null;
    } },
    body: new ReadableStream({
      pull(controller) {
        const chunk = bodyChunks.shift();
        if (chunk) controller.enqueue(new Uint8Array(chunk));
        else controller.close();
      },
      cancel() { cancelled = true; },
    }),
    get cancelled() { return cancelled; },
    async arrayBuffer() { return data; },
    async text() { return data.toString("utf8"); },
    async json() { return JSON.parse(data.toString("utf8")); },
  };
}

test("CLI accepts only documented options and placement:motion styles", () => {
  assert.deepEqual(parseArgs([
    "--month", "2026-06", "--out", "output/2026-06",
    "--channel", "podcast",
    "--youtube-style", "hook:cutout-zoom",
  ]), {
    month: "2026-06",
    outDir: "output/2026-06",
    channel: "podcast",
    styles: { youtube: { placement: "hook", motion: "cutout-zoom" } },
  });
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--publish"]), /unknown option/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--month", "2026-07", "--out", "x"]), /duplicate option/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--blog-style", "hook:wipe"]), /invalid style/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--blog-style", "none:letter-scatter"]), /invalid style/);
  assert.throws(() => parseArgs(["--month", "2026-06", "--out", "x", "--channel", "unknown"]), /invalid channel/);
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
      lookupImpl: PUBLIC_DNS,
      env: { CONTENT_ANALYTICS_GAS_URL: "https://script.google.com/macros/s/example/exec" },
    });
  }
  assert(requested.includes("https://i.ytimg.com/vi/youtube-1/hqdefault.jpg"));
  assert(requested.includes("https://gohome-clinic.com/media/1.png"));
  assert(requested.includes("https://cdninstagram.com/right.png"));
  assert(requested.includes("https://d3t3ozftmdmh3i.cloudfront.net/podcast-1.jpg"));
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
    manifest: manifest("blog"), assetsDir: root, fetchImpl, lookupImpl: PUBLIC_DNS, env: {},
  });
  assert.equal(assets.length, 3);
  for (const asset of assets) {
    const bytes = await readFile(asset);
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  }
});

test("asset redirects are followed manually and every hop is allowlisted before fetching", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-redirect-"));
  const requested = [];
  const fetchImpl = async (url, options) => {
    requested.push(String(url));
    assert.equal(options.redirect, "manual");
    return response({
      body: "",
      contentType: "text/plain",
      url: String(url),
      status: 302,
      location: "https://127.0.0.1/private.png",
    });
  };
  const assets = await prepareChannelAssets({
    manifest: manifest("youtube"),
    assetsDir: root,
    fetchImpl,
    lookupImpl: PUBLIC_DNS,
    env: {},
  });
  assert.equal(requested.length, 3);
  assert(requested.every((url) => url.startsWith("https://i.ytimg.com/")));
  for (const asset of assets) {
    assert.deepEqual((await readFile(asset)).subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"));
  }
});

test("asset response limits are enforced while streaming and cancel oversized bodies", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-stream-limit-"));
  const oversized = [];
  const fetchImpl = async (url) => {
    const reply = response({
      body: Buffer.alloc(0),
      contentType: "image/png",
      url: String(url),
      chunks: [PNG, Buffer.alloc(12 * 1024 * 1024)],
    });
    oversized.push(reply);
    return reply;
  };
  const assets = await prepareChannelAssets({
    manifest: manifest("youtube"),
    assetsDir: root,
    fetchImpl,
    lookupImpl: PUBLIC_DNS,
    env: {},
  });
  assert.equal(assets.length, 3);
  assert.equal(oversized.length, 3);
  for (const asset of assets) assert((await stat(asset)).size < 1024 * 1024);
});

test("an oversized Content-Length is rejected before reading the response body", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-content-length-"));
  let readerCalled = false;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: (name) => {
      if (name.toLowerCase() === "content-type") return "image/png";
      if (name.toLowerCase() === "content-length") return String(13 * 1024 * 1024);
      return null;
    } },
    body: {
      getReader() {
        readerCalled = true;
        throw new Error("body must not be read");
      },
    },
  });
  const assets = await prepareChannelAssets({
    manifest: manifest("youtube"), assetsDir: root, fetchImpl, lookupImpl: PUBLIC_DNS, env: {},
  });
  assert.equal(readerCalled, false);
  for (const asset of assets) assert((await stat(asset)).size < 1024 * 1024);
});

test("one failed render does not stop other channels and post_caption is copy authority", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-run-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const calls = [];
  const spawnImpl = async (command, args, options) => {
    calls.push([command, ...args]);
    if (command === "npm") {
      const channel = args[args.indexOf("--channel") + 1];
      const collectorOut = args[args.indexOf("--out") + 1];
      const directory = path.join(collectorOut, channel);
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "ranking.json"), `${JSON.stringify(manifest(channel), null, 2)}\n`);
      return;
    }
    assert.equal(options.env.YOUTUBE_CLIENT_SECRET, undefined);
    assert.equal(options.env.GEMINI_API_KEY, "gemini-test");
    const output = args[args.indexOf("--out") + 1];
    if (output.includes("channel-instagram")) {
      await mkdir(path.dirname(output), { recursive: true });
      await writeFile(output, "partial fixture video");
      throw new Error("renderer fixture failed with secret=do-not-copy");
    }
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
    lookupImpl: PUBLIC_DNS,
    env: {
      CONTENT_ANALYTICS_GAS_URL: "https://script.google.com/macros/s/example/exec",
      GEMINI_API_KEY: "gemini-test",
      YOUTUBE_CLIENT_SECRET: "collector-only-secret",
    },
  });
  assert.equal(result.youtube.status, "ok");
  assert.equal(result.blog.status, "ok");
  assert.equal(result.instagram.status, "failed");
  assert(!result.instagram.error.includes("do-not-copy"));
  assert.equal(result.podcast.status, "ok");
  assert.equal(calls.filter(([command]) => command === "npm").length, 4);
  assert.equal(calls.filter(([command]) => command === "python3").length, 4);
  assert(!calls.flat().some((value) => /publish|upload/i.test(String(value))));
  for (const channel of ["youtube", "blog", "podcast"]) {
    const actual = await readFile(path.join(outDir, channel, "candidate", "post_caption.txt"), "utf8");
    assert.equal(actual, buildCopy(manifest(channel)).postCaption);
    await assert.rejects(stat(path.join(outDir, channel, "candidate", "post-title.txt")));
    await assert.rejects(stat(path.join(outDir, channel, "candidate", "post-description.txt")));
  }
  const summary = JSON.parse(await readFile(path.join(outDir, "run-summary.json"), "utf8"));
  assert.equal(summary.channels.instagram.status, "failed");
  assert.equal(summary.channels.instagram.errorCategory, "render");
  assert.deepEqual(Object.keys(summary.bgm).sort(), ["licenseConfirmed", "sha256", "source"]);
  assert.equal(summary.bgm.source, "procedural");
  await assert.rejects(lstat(path.join(outDir, "instagram")), /ENOENT/);
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  assert.deepEqual(history.entries.map(({ channel }) => channel).sort(), ["blog", "podcast", "youtube"]);
});

test("an invalid manifest is not rendered while valid channels still complete", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-invalid-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const rendered = [];
  const spawnImpl = async (command, args) => {
    if (command === "npm") {
      const channel = args[args.indexOf("--channel") + 1];
      const collectorOut = args[args.indexOf("--out") + 1];
      const directory = path.join(collectorOut, channel);
      await mkdir(directory, { recursive: true });
      const value = channel === "blog" ? { ...manifest(channel), items: [] } : manifest(channel);
      await writeFile(path.join(directory, "ranking.json"), `${JSON.stringify(value)}\n`);
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
    lookupImpl: PUBLIC_DNS,
    fetchImpl: async () => { throw new Error("fixture unavailable"); },
    env: {},
  });
  assert.equal(result.youtube.status, "ok");
  assert.equal(result.blog.status, "failed");
  assert.equal(result.instagram.status, "ok");
  assert.equal(result.podcast.status, "ok");
  assert.equal(rendered.length, 3);
  assert(!rendered.some((output) => output.includes(`${path.sep}blog${path.sep}`)));
});

test("one collector failure is isolated and all other channels still render", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-collector-isolation-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const rendered = [];
  const spawnImpl = async (command, args) => {
    if (command === "npm") {
      const channel = args[args.indexOf("--channel") + 1];
      if (channel === "instagram") throw new Error("collector secret must not leak");
      const collectorOut = args[args.indexOf("--out") + 1];
      await mkdir(path.join(collectorOut, channel), { recursive: true });
      await writeFile(path.join(collectorOut, channel, "ranking.json"), JSON.stringify(manifest(channel)));
      return;
    }
    const output = args[args.indexOf("--out") + 1];
    rendered.push(output);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "video");
    await writeFile(output.replace(/\.mp4$/u, ".qa.json"), "{}");
    await writeFile(output.replace(/\.mp4$/u, "-qa-sheet.jpg"), "sheet");
    await writeFile(path.join(path.dirname(output), "post_caption.txt"), "renderer copy");
    await writeFile(path.join(path.dirname(output), "captions.json"), "[]");
  };
  const result = await runMonthlyRanking({
    month: "2026-06",
    outDir,
    historyPath,
    spawnImpl,
    fetchImpl: async () => { throw new Error("asset unavailable"); },
    lookupImpl: PUBLIC_DNS,
    env: {},
  });
  assert.equal(result.instagram.status, "failed");
  assert.equal(result.instagram.errorCategory, "collection");
  assert.equal(rendered.length, 3);
  assert.deepEqual(
    Object.entries(result).filter(([, value]) => value.status === "ok").map(([channel]) => channel).sort(),
    ["blog", "podcast", "youtube"],
  );
  assert.equal((await readdir(root)).some((name) => name.startsWith(".out.tmp-")), false);
});

test("existing output is rejected before collection and never clobbered", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-no-clobber-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  await mkdir(outDir);
  await writeFile(path.join(outDir, "keep.txt"), "keep");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  let calls = 0;
  await assert.rejects(
    runMonthlyRanking({
      month: "2026-06",
      outDir,
      historyPath,
      spawnImpl: async () => { calls += 1; },
      lookupImpl: PUBLIC_DNS,
      env: {},
    }),
    /already exists/i,
  );
  assert.equal(calls, 0);
  assert.equal(await readFile(path.join(outDir, "keep.txt"), "utf8"), "keep");
});

test("a stale output lock is recovered without leaving lock or staging files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-stale-lock-"));
  const outDir = path.join(root, "out");
  const historyPath = path.join(root, "history.json");
  const lockPath = `${outDir}.lock`;
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  await writeFile(lockPath, '{"owner":"abandoned"}\n');
  const old = new Date(Date.now() - 3 * 60 * 60 * 1000);
  await utimes(lockPath, old, old);
  const spawnImpl = async (command, args) => {
    if (command === "npm") {
      const collectorOut = args[args.indexOf("--out") + 1];
      await mkdir(path.join(collectorOut, "youtube"), { recursive: true });
      await writeFile(path.join(collectorOut, "youtube", "ranking.json"), JSON.stringify(manifest("youtube")));
      return;
    }
    const output = args[args.indexOf("--out") + 1];
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "video");
    await writeFile(output.replace(/\.mp4$/u, ".qa.json"), "{}");
    await writeFile(output.replace(/\.mp4$/u, "-qa-sheet.jpg"), "sheet");
    await writeFile(path.join(path.dirname(output), "post_caption.txt"), "renderer copy");
    await writeFile(path.join(path.dirname(output), "captions.json"), "[]");
  };
  const result = await runMonthlyRanking({
    month: "2026-06", channel: "youtube", outDir, historyPath, spawnImpl,
    fetchImpl: async () => { throw new Error("offline"); }, lookupImpl: PUBLIC_DNS, env: {},
  });
  assert.equal(result.youtube.status, "ok");
  await assert.rejects(lstat(lockPath), /ENOENT/);
  assert.equal((await readdir(root)).some((name) => name.startsWith(".out.tmp-")), false);
});

test("concurrent channel runs merge history without lost updates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "ranking-history-concurrent-"));
  const historyPath = path.join(root, "history.json");
  await writeFile(historyPath, '{"schemaVersion":1,"entries":[]}\n');
  const makeSpawn = (targetChannel, month) => async (command, args) => {
    if (command === "npm") {
      assert.equal(args[args.indexOf("--channel") + 1], targetChannel);
      const collectorOut = args[args.indexOf("--out") + 1];
      await mkdir(path.join(collectorOut, targetChannel), { recursive: true });
      await writeFile(path.join(collectorOut, targetChannel, "ranking.json"), JSON.stringify(manifest(targetChannel, month)));
      return;
    }
    const output = args[args.indexOf("--out") + 1];
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, "video");
    await writeFile(output.replace(/\.mp4$/u, ".qa.json"), "{}");
    await writeFile(output.replace(/\.mp4$/u, "-qa-sheet.jpg"), "sheet");
    await writeFile(path.join(path.dirname(output), "post_caption.txt"), "renderer copy");
    await writeFile(path.join(path.dirname(output), "captions.json"), "[]");
  };
  await Promise.all([
    runMonthlyRanking({
      month: "2026-06", channel: "youtube", outDir: path.join(root, "youtube"), historyPath,
      spawnImpl: makeSpawn("youtube", "2026-06"), fetchImpl: async () => { throw new Error("offline"); },
      lookupImpl: PUBLIC_DNS, env: {},
    }),
    runMonthlyRanking({
      month: "2026-05", channel: "podcast", outDir: path.join(root, "podcast"), historyPath,
      spawnImpl: makeSpawn("podcast", "2026-05"), fetchImpl: async () => { throw new Error("offline"); },
      lookupImpl: PUBLIC_DNS, env: {},
    }),
  ]);
  const history = JSON.parse(await readFile(historyPath, "utf8"));
  assert.deepEqual(history.entries.map(({ channel, month }) => `${channel}:${month}`).sort(), [
    "podcast:2026-05", "youtube:2026-06",
  ]);
});

test("workflow is pilot-gated, selects one channel, and contains no publishing step", async () => {
  const source = await readFile(path.join(import.meta.dirname, "../.github/workflows/monthly_ranking_shorts.yml"), "utf8");
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /ENABLE_MONTHLY_RANKING_SCHEDULE/);
  assert.match(source, /youtube.*blog.*instagram.*podcast/s);
  assert.match(source, /--channel/);
  assert.match(source, /tar --dereference/);
  assert.match(source, /第1.*YouTube|first.*youtube/i);
  assert.match(source, /第5.*予備|fifth.*skip/i);
  assert.doesNotMatch(source, /youtube.*upload|instagram.*publish|publishAttempt/i);
});
