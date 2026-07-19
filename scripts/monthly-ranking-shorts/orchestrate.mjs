import { spawn } from "node:child_process";
import { deflateSync } from "node:zlib";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateManifest } from "../monthly-ranking-data/schema.mjs";
import { buildCopy } from "./copy.mjs";
import { recommendStyle, recordStyle, validateHistory } from "./history.mjs";

const CHANNELS = Object.freeze(["youtube", "blog", "instagram"]);
const STYLE_KEYS = new Set([
  "hook:cutout-zoom",
  "chapter:split-reveal",
  "hook:letter-scatter",
  "chapter:cutout-zoom",
  "none:split-reveal",
]);
const IMAGE_LIMIT = 12 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(MODULE_DIR, "../..");
const DEFAULT_HISTORY_PATH = path.join(REPOSITORY_ROOT, "config/monthly-ranking-style-history.json");
const RENDERER_PATH = path.join(REPOSITORY_ROOT, "scripts/ranking-shorts-renderer/main.py");

function requireMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value ?? "") || value.startsWith("0000-")) {
    throw new Error("month must be YYYY-MM");
  }
  return value;
}

function parseStyle(value) {
  const [placement, motion, extra] = String(value ?? "").split(":");
  if (extra !== undefined || !STYLE_KEYS.has(`${placement}:${motion}`)) {
    throw new Error("invalid style; expected placement:motion");
  }
  return { placement, motion };
}

export function parseArgs(argv) {
  const result = { styles: {} };
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (option !== "--month" && option !== "--out" && !/^--(youtube|blog|instagram)-style$/.test(option ?? "")) {
      throw new Error(`unknown option: ${option ?? "option"}`);
    }
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${option ?? "option"}`);
    }
    if (seen.has(option)) throw new Error(`duplicate option: ${option}`);
    seen.add(option);
    if (option === "--month") result.month = requireMonth(value);
    else if (option === "--out") result.outDir = value;
    else {
      const match = /^--(youtube|blog|instagram)-style$/.exec(option);
      result.styles[match[1]] = parseStyle(value);
    }
  }
  if (!result.month) throw new Error("--month is required");
  if (!result.outDir) throw new Error("--out is required");
  return result;
}

export function spawnChecked(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: false, ...options });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(command)} failed (${signal ?? `exit ${code}`})`));
    });
  });
}

export function validateHistoryDocument(document) {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    throw new Error("history document must be an object");
  }
  if (document.schemaVersion !== 1) throw new Error("history schemaVersion must be 1");
  if (!Array.isArray(document.entries)) throw new Error("history entries must be an array");
  return validateHistory(document.entries);
}

async function atomicWrite(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporary, value);
  await rename(temporary, target);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}

function solidPng(channel, rank, width = 720, height = 1280) {
  const palettes = {
    youtube: [205, 55, 66],
    blog: [43, 116, 126],
    instagram: [118, 76, 151],
  };
  const base = palettes[channel] ?? [51, 94, 122];
  const color = base.map((component) => Math.max(0, component - (rank - 1) * 12));
  const row = Buffer.alloc(1 + width * 3);
  for (let offset = 1; offset < row.length; offset += 3) {
    row[offset] = color[0];
    row[offset + 1] = color[1];
    row[offset + 2] = color[2];
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export async function writeProceduralBgm(target) {
  const sampleRate = 8000;
  const seconds = 54;
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    const beat = Math.floor(index / (sampleRate * 0.5)) % 4;
    const frequency = [220, 277.18, 329.63, 277.18][beat];
    const envelope = Math.min(1, (index % (sampleRate * 0.5)) / 400) * 0.035;
    const value = Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 32767 * envelope);
    data.writeInt16LE(value, index * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  await atomicWrite(path.resolve(target), Buffer.concat([header, data]));
  return path.resolve(target);
}

function allowedHost(hostname, allowed) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return allowed.some((domain) => normalized === domain || normalized.endsWith(`.${domain}`));
}

function safeHttpsUrl(value, allowed, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHost(url.hostname, allowed)) {
    throw new Error(`${label} host is not allowed`);
  }
  return url;
}

async function limitedBody(response, limit, method) {
  if (!response?.ok) throw new Error(`asset request failed (${response?.status ?? "unknown"})`);
  const body = method === "text"
    ? Buffer.from(await response.text(), "utf8")
    : Buffer.from(await response.arrayBuffer());
  if (body.length > limit) throw new Error("asset response is too large");
  return body;
}

function imageExtension(bytes, contentType) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && /image\/png/i.test(contentType ?? "")) return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && /image\/jpe?g/i.test(contentType ?? "")) return ".jpg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    && /image\/webp/i.test(contentType ?? "")) return ".webp";
  throw new Error("asset response is not a supported image");
}

async function fetchImage(url, allowed, fetchImpl) {
  const requested = safeHttpsUrl(url, allowed, "asset URL");
  const response = await fetchImpl(requested.href, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const finalUrl = response?.url || requested.href;
  safeHttpsUrl(finalUrl, allowed, "asset redirect URL");
  const bytes = await limitedBody(response, IMAGE_LIMIT, "bytes");
  return { bytes, extension: imageExtension(bytes, response.headers?.get?.("content-type")) };
}

function extractOgImage(html) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const property = /\bproperty\s*=\s*["']og:image(?::secure_url)?["']/i.test(tag);
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (property && content) return content.replaceAll("&amp;", "&");
  }
  throw new Error("blog page has no OG image");
}

async function blogImageUrl(item, fetchImpl) {
  const pageUrl = safeHttpsUrl(item.url, ["gohome-clinic.com"], "blog URL");
  const response = await fetchImpl(pageUrl.href, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  const finalUrl = safeHttpsUrl(response?.url || pageUrl.href, ["gohome-clinic.com"], "blog redirect URL");
  const html = (await limitedBody(response, TEXT_LIMIT, "text")).toString("utf8");
  return new URL(extractOgImage(html), finalUrl).href;
}

async function instagramPosts(env, fetchImpl) {
  const api = safeHttpsUrl(env.CONTENT_ANALYTICS_GAS_URL, ["script.google.com", "script.googleusercontent.com"], "Instagram API URL");
  api.searchParams.set("api", "instagram-posts");
  api.searchParams.set("limit", "100");
  const response = await fetchImpl(api.href, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  safeHttpsUrl(response?.url || api.href, ["script.google.com", "script.googleusercontent.com"], "Instagram API redirect URL");
  const json = JSON.parse((await limitedBody(response, TEXT_LIMIT, "text")).toString("utf8"));
  const posts = Array.isArray(json?.data) ? json.data : json?.posts;
  if (!Array.isArray(posts)) throw new Error("Instagram posts payload is invalid");
  return posts;
}

export async function prepareChannelAssets({ manifest, assetsDir, fetchImpl = fetch, env = process.env }) {
  validateManifest(manifest);
  await mkdir(assetsDir, { recursive: true });
  let posts;
  if (manifest.channel === "instagram") {
    try {
      posts = await instagramPosts(env, fetchImpl);
    } catch {
      posts = null;
    }
  }
  const results = [];
  for (const item of manifest.items) {
    let asset;
    try {
      if (manifest.channel === "youtube") {
        asset = await fetchImage(
          `https://i.ytimg.com/vi/${encodeURIComponent(item.contentId)}/hqdefault.jpg`,
          ["i.ytimg.com"], fetchImpl,
        );
      } else if (manifest.channel === "blog") {
        asset = await fetchImage(await blogImageUrl(item, fetchImpl), ["gohome-clinic.com"], fetchImpl);
      } else {
        const post = posts?.find((candidate) => String(candidate?.id) === item.contentId);
        const url = post?.thumbnail_url || post?.media_url;
        if (!url) throw new Error("matching Instagram asset is missing");
        asset = await fetchImage(url, ["cdninstagram.com", "fbcdn.net"], fetchImpl);
      }
    } catch {
      asset = { bytes: solidPng(manifest.channel, item.rank), extension: ".png" };
    }
    const target = path.join(assetsDir, `rank-${item.rank}${asset.extension}`);
    await atomicWrite(target, asset.bytes);
    results.push(target);
  }
  return results;
}

async function resolveBgm(outDir, env) {
  const explicit = env.RANKING_SHORTS_BGM?.trim();
  if (!explicit) return writeProceduralBgm(path.join(outDir, "shared", "procedural-bgm.wav"));
  if (env.RANKING_SHORTS_BGM_LICENSE_CONFIRMED !== "true") {
    throw new Error("explicit BGM requires RANKING_SHORTS_BGM_LICENSE_CONFIRMED=true");
  }
  const target = path.resolve(explicit);
  const [metadata, lexical] = await Promise.all([stat(target), lstat(target)]);
  if (!metadata.isFile() || lexical.isSymbolicLink() || !new Set([".wav", ".mp3", ".m4a", ".aac"]).has(path.extname(target).toLowerCase())) {
    throw new Error("explicit BGM must be a regular supported audio file");
  }
  return target;
}

function publicResultError() {
  return "channel processing failed; inspect local logs and source artifacts";
}

async function verifyRendererArtifacts(videoPath) {
  const targets = [
    videoPath,
    videoPath.replace(/\.mp4$/u, ".qa.json"),
    videoPath.replace(/\.mp4$/u, "-qa-sheet.jpg"),
    path.join(path.dirname(videoPath), "post_caption.txt"),
    path.join(path.dirname(videoPath), "captions.json"),
  ];
  for (const target of targets) {
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      throw new Error("renderer did not create complete regular-file artifacts");
    }
  }
}

export async function runMonthlyRanking({
  month,
  outDir,
  styles = {},
  spawnImpl = spawnChecked,
  fetchImpl = fetch,
  env = process.env,
  historyPath = DEFAULT_HISTORY_PATH,
} = {}) {
  requireMonth(month);
  const outputRoot = path.resolve(outDir);
  const historyDocument = JSON.parse(await readFile(historyPath, "utf8"));
  let history = [...validateHistoryDocument(historyDocument)];
  await spawnImpl("npm", ["run", "ranking:collect", "--", "--month", month, "--out", outputRoot], {
    cwd: REPOSITORY_ROOT,
    env,
  });
  const bgm = await resolveBgm(outputRoot, env);

  const channels = {};
  for (const channel of CHANNELS) {
    try {
      const channelDir = path.join(outputRoot, channel);
      const manifestPath = path.join(channelDir, "ranking.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      validateManifest(manifest);
      if (manifest.channel !== channel || manifest.period.month !== month) {
        throw new Error("manifest channel or month does not match orchestration target");
      }
      const copy = buildCopy(manifest);
      await atomicWrite(path.join(channelDir, "narration.txt"), `${copy.narration}\n`);
      await atomicWrite(path.join(channelDir, "captions.json"), `${JSON.stringify(copy.captions, null, 2)}\n`);
      const assetsDir = path.join(channelDir, "assets");
      await prepareChannelAssets({ manifest, assetsDir, fetchImpl, env });
      const style = styles[channel] ? parseStyle(`${styles[channel].placement}:${styles[channel].motion}`) : recommendStyle(channel, month, history);
      const candidateDir = path.join(channelDir, "candidate");
      const videoPath = path.join(candidateDir, "ranking-short.mp4");
      await spawnImpl(env.RANKING_SHORTS_PYTHON || "python3", [
        RENDERER_PATH,
        "--manifest", manifestPath,
        "--assets", assetsDir,
        "--placement", style.placement,
        "--motion", style.motion,
        "--resolution", "1080x1920",
        "--bgm", bgm,
        "--out", videoPath,
      ], { cwd: REPOSITORY_ROOT, env });
      await verifyRendererArtifacts(videoPath);
      await atomicWrite(path.join(candidateDir, "post_caption.txt"), copy.postCaption);
      history = recordStyle(channel, month, style.placement, style.motion, history);
      channels[channel] = { status: "ok", output: videoPath, style };
    } catch {
      channels[channel] = { status: "failed", error: publicResultError() };
    }
  }

  await atomicWrite(historyPath, `${JSON.stringify({ schemaVersion: 1, entries: history }, null, 2)}\n`);
  const summary = {
    schemaVersion: 1,
    month,
    generatedAt: new Date().toISOString(),
    publishAttempted: false,
    channels,
  };
  await atomicWrite(path.join(outputRoot, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  return channels;
}

export async function main({ argv = process.argv.slice(2), env = process.env } = {}) {
  const args = parseArgs(argv);
  const channels = await runMonthlyRanking({ ...args, env });
  if (Object.values(channels).some(({ status }) => status === "failed")) process.exitCode = 1;
  return channels;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Monthly ranking orchestration failed");
    process.exitCode = 1;
  });
}
