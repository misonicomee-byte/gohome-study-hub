import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createReadStream } from "node:fs";
import { isIP } from "node:net";
import { deflateSync } from "node:zlib";
import {
  open,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateManifest } from "../monthly-ranking-data/schema.mjs";
import { buildCopy } from "./copy.mjs";
import { recommendStyle, recordStyle, validateHistory } from "./history.mjs";

const CHANNELS = Object.freeze(["youtube", "blog", "instagram", "podcast"]);
const STYLE_KEYS = new Set([
  "hook:cutout-zoom",
  "chapter:split-reveal",
  "hook:letter-scatter",
  "chapter:cutout-zoom",
  "none:split-reveal",
]);
const IMAGE_LIMIT = 12 * 1024 * 1024;
const TEXT_LIMIT = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const LOCK_STALE_MS = 2 * 60 * 60 * 1000;
const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const ALLOW_SUBDOMAINS = new Set(["gohome-clinic.com", "cdninstagram.com", "fbcdn.net"]);
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
    if (option !== "--month" && option !== "--out" && option !== "--channel"
      && !/^--(youtube|blog|instagram|podcast)-style$/.test(option ?? "")) {
      throw new Error(`unknown option: ${option ?? "option"}`);
    }
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${option ?? "option"}`);
    }
    if (seen.has(option)) throw new Error(`duplicate option: ${option}`);
    seen.add(option);
    if (option === "--month") result.month = requireMonth(value);
    else if (option === "--out") result.outDir = value;
    else if (option === "--channel") {
      if (!CHANNELS.includes(value)) throw new Error("invalid channel");
      result.channel = value;
    }
    else {
      const match = /^--(youtube|blog|instagram|podcast)-style$/.exec(option);
      result.styles[match[1]] = parseStyle(value);
    }
  }
  if (!result.month) throw new Error("--month is required");
  if (!result.outDir) throw new Error("--out is required");
  return result;
}

export function selectScheduledChannel(jstDay) {
  if (!Number.isInteger(jstDay) || jstDay < 1 || jstDay > 31) {
    throw new Error("JST day must be an integer from 1 through 31");
  }
  const week = Math.floor((jstDay - 1) / 7) + 1;
  const firstSundayDay = jstDay - (week - 1) * 7;
  if (week === 5) return { channel: "reserve", skip: true, week, firstSundayDay };
  const order = firstSundayDay <= 4
    ? ["instagram", "blog", "youtube", "podcast"]
    : ["youtube", "blog", "instagram", "podcast"];
  return { channel: order[week - 1], skip: false, week, firstSundayDay };
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
  try {
    await writeFile(temporary, value);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireFileLock(lockPath, {
  staleMs = LOCK_STALE_MS,
  waitMs = LOCK_WAIT_MS,
} = {}) {
  const started = Date.now();
  await mkdir(path.dirname(lockPath), { recursive: true });
  while (true) {
    try {
      const owner = randomUUID();
      const handle = await open(lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ owner, pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      } catch (error) {
        await handle.close().catch(() => {});
        await rm(lockPath, { force: true }).catch(() => {});
        throw error;
      }
      return async () => {
        await handle.close().catch(() => {});
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current?.owner === owner) await rm(lockPath, { force: true });
        } catch (error) {
          if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let metadata;
      try {
        metadata = await lstat(lockPath);
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - metadata.mtimeMs > staleMs) {
        const stale = `${lockPath}.stale.${process.pid}.${Date.now()}`;
        try {
          await rename(lockPath, stale);
          await rm(stale, { force: true });
          continue;
        } catch (renameError) {
          if (["ENOENT", "EEXIST"].includes(renameError?.code)) continue;
          throw renameError;
        }
      }
      if (Date.now() - started >= waitMs) throw new Error("lock acquisition timed out");
      await sleep(LOCK_RETRY_MS);
    }
  }
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
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
  return allowed.some((domain) => normalized === domain
    || (ALLOW_SUBDOMAINS.has(domain) && normalized.endsWith(`.${domain}`)));
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

function isPublicIpAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && [0, 168].includes(b))
      || (a === 198 && [18, 19, 51].includes(b))
      || (a === 203 && b === 0));
  }
  if (version === 6) {
    const normalized = address.toLowerCase().split("%")[0];
    if (normalized.startsWith("::ffff:")) return isPublicIpAddress(normalized.slice(7));
    return !(normalized === "::" || normalized === "::1"
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/u.test(normalized) || normalized.startsWith("ff"));
  }
  return false;
}

async function assertPublicResolution(hostname, lookupImpl) {
  if (isIP(hostname)) throw new Error("IP-literal asset hosts are not allowed");
  const result = await lookupImpl(hostname, { all: true, verbatim: true });
  const addresses = Array.isArray(result) ? result : [result];
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) {
    throw new Error("asset host resolved to a non-public address");
  }
}

function normalizedContentType(response) {
  return String(response?.headers?.get?.("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
}

async function limitedBody(response, limit) {
  const rawLength = response?.headers?.get?.("content-length");
  if (rawLength !== null && rawLength !== undefined && rawLength !== "") {
    if (!/^\d+$/u.test(String(rawLength))) throw new Error("asset response has invalid content length");
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared) || declared > limit) throw new Error("asset response is too large");
  }
  if (!response?.body || typeof response.body.getReader !== "function") {
    throw new Error("asset response body is not streamable");
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > limit) {
        await reader.cancel("size limit exceeded").catch(() => {});
        throw new Error("asset response is too large");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchAllowedResource({
  url,
  allowed,
  acceptedTypes,
  limit,
  label,
  fetchImpl,
  lookupImpl,
}) {
  let current = safeHttpsUrl(url, allowed, label);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertPublicResolution(current.hostname, lookupImpl);
    const response = await fetchImpl(current.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    if ([301, 302, 303, 307, 308].includes(response?.status)) {
      if (redirects === MAX_REDIRECTS) throw new Error(`${label} has too many redirects`);
      const location = response?.headers?.get?.("location");
      if (!location) throw new Error(`${label} redirect is missing Location`);
      current = safeHttpsUrl(new URL(location, current).href, allowed, `${label} redirect URL`);
      continue;
    }
    if (!response?.ok) throw new Error(`${label} request failed (${response?.status ?? "unknown"})`);
    const contentType = normalizedContentType(response);
    if (!acceptedTypes.includes(contentType)) throw new Error(`${label} returned an unsupported content type`);
    return { bytes: await limitedBody(response, limit), contentType, finalUrl: current };
  }
  throw new Error(`${label} has too many redirects`);
}

function imageExtension(bytes, contentType) {
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) && contentType === "image/png") return ".png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && ["image/jpeg", "image/jpg"].includes(contentType)) return ".jpg";
  if (bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
    && contentType === "image/webp") return ".webp";
  throw new Error("asset response is not a supported image");
}

async function fetchImage(url, allowed, fetchImpl, lookupImpl) {
  const resource = await fetchAllowedResource({
    url,
    allowed,
    acceptedTypes: ["image/png", "image/jpeg", "image/jpg", "image/webp"],
    limit: IMAGE_LIMIT,
    label: "asset",
    fetchImpl,
    lookupImpl,
  });
  return { bytes: resource.bytes, extension: imageExtension(resource.bytes, resource.contentType) };
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

async function blogImageUrl(item, fetchImpl, lookupImpl) {
  const resource = await fetchAllowedResource({
    url: item.url,
    allowed: ["gohome-clinic.com"],
    acceptedTypes: ["text/html", "application/xhtml+xml"],
    limit: TEXT_LIMIT,
    label: "blog page",
    fetchImpl,
    lookupImpl,
  });
  return new URL(extractOgImage(resource.bytes.toString("utf8")), resource.finalUrl).href;
}

async function instagramPosts(env, fetchImpl, lookupImpl) {
  const api = safeHttpsUrl(env.CONTENT_ANALYTICS_GAS_URL, ["script.google.com", "script.googleusercontent.com"], "Instagram API URL");
  api.searchParams.set("api", "instagram-posts");
  api.searchParams.set("limit", "100");
  const resource = await fetchAllowedResource({
    url: api.href,
    allowed: ["script.google.com", "script.googleusercontent.com"],
    acceptedTypes: ["application/json"],
    limit: TEXT_LIMIT,
    label: "Instagram API",
    fetchImpl,
    lookupImpl,
  });
  const json = JSON.parse(resource.bytes.toString("utf8"));
  const posts = Array.isArray(json?.data) ? json.data : json?.posts;
  if (!Array.isArray(posts)) throw new Error("Instagram posts payload is invalid");
  return posts;
}

export async function prepareChannelAssets({
  manifest,
  assetsDir,
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
  env = process.env,
}) {
  validateManifest(manifest);
  await mkdir(assetsDir, { recursive: true });
  let posts;
  if (manifest.channel === "instagram") {
    try {
      posts = await instagramPosts(env, fetchImpl, lookupImpl);
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
          ["i.ytimg.com"], fetchImpl, lookupImpl,
        );
      } else if (manifest.channel === "blog") {
        asset = await fetchImage(
          await blogImageUrl(item, fetchImpl, lookupImpl),
          ["gohome-clinic.com"], fetchImpl, lookupImpl,
        );
      } else if (manifest.channel === "instagram") {
        const post = posts?.find((candidate) => String(candidate?.id) === item.contentId);
        const url = post?.thumbnail_url || post?.media_url;
        if (!url) throw new Error("matching Instagram asset is missing");
        asset = await fetchImage(url, ["cdninstagram.com", "fbcdn.net"], fetchImpl, lookupImpl);
      } else {
        asset = await fetchImage(
          item.imageUrl,
          ["d3t3ozftmdmh3i.cloudfront.net"],
          fetchImpl,
          lookupImpl,
        );
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

async function sha256File(target) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(target)) hash.update(chunk);
  return hash.digest("hex");
}

async function resolveBgm(outDir, env) {
  const explicit = env.RANKING_SHORTS_BGM?.trim();
  if (!explicit) {
    const bgmPath = await writeProceduralBgm(path.join(outDir, "shared", "procedural-bgm.wav"));
    return {
      path: bgmPath,
      summary: { source: "procedural", sha256: await sha256File(bgmPath), licenseConfirmed: true },
    };
  }
  if (env.RANKING_SHORTS_BGM_LICENSE_CONFIRMED !== "true") {
    throw new Error("explicit BGM requires RANKING_SHORTS_BGM_LICENSE_CONFIRMED=true");
  }
  const target = path.resolve(explicit);
  const [metadata, lexical] = await Promise.all([stat(target), lstat(target)]);
  if (!metadata.isFile() || lexical.isSymbolicLink() || !new Set([".wav", ".mp3", ".m4a", ".aac"]).has(path.extname(target).toLowerCase())) {
    throw new Error("explicit BGM must be a regular supported audio file");
  }
  return {
    path: target,
    summary: { source: "explicit", sha256: await sha256File(target), licenseConfirmed: true },
  };
}

function publicResultError() {
  return "channel processing failed; inspect local logs and source artifacts";
}

function rendererEnvironment(env) {
  const names = [
    "PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "PYTHONPATH", "VIRTUAL_ENV",
    "GEMINI_API_KEY", "GEMINI_TTS_MODEL", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE",
  ];
  return Object.fromEntries(names.flatMap((name) => env[name] === undefined ? [] : [[name, env[name]]]));
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

async function updateHistory(historyPath, records) {
  if (!records.length) return;
  const release = await acquireFileLock(`${historyPath}.lock`);
  try {
    const document = JSON.parse(await readFile(historyPath, "utf8"));
    let history = [...validateHistoryDocument(document)];
    for (const record of records) {
      history = recordStyle(
        record.channel,
        record.month,
        record.placement,
        record.motion,
        history,
      );
    }
    await atomicWrite(historyPath, `${JSON.stringify({ schemaVersion: 1, entries: history }, null, 2)}\n`);
  } finally {
    await release();
  }
}

function failedChannel(category) {
  return {
    status: "failed",
    error: publicResultError(),
    errorCategory: category,
  };
}

export async function runMonthlyRanking({
  month,
  outDir,
  channel,
  styles = {},
  spawnImpl = spawnChecked,
  fetchImpl = fetch,
  lookupImpl = dnsLookup,
  env = process.env,
  historyPath = DEFAULT_HISTORY_PATH,
} = {}) {
  requireMonth(month);
  if (channel !== undefined && !CHANNELS.includes(channel)) throw new Error("invalid channel");
  const selectedChannels = channel ? [channel] : [...CHANNELS];
  const outputRoot = path.resolve(outDir);
  const outputParent = path.dirname(outputRoot);
  const outputName = path.basename(outputRoot);
  const releaseOutputLock = await acquireFileLock(`${outputRoot}.lock`);
  let runStage;
  let completed;
  let published = false;
  try {
    if (await pathExists(outputRoot)) throw new Error("output already exists");
    const historyDocument = JSON.parse(await readFile(historyPath, "utf8"));
    const history = [...validateHistoryDocument(historyDocument)];
    await mkdir(outputParent, { recursive: true });
    runStage = await mkdtemp(path.join(outputParent, `.${outputName}.tmp-`));
    const stageSuffix = path.basename(runStage).slice(`.${outputName}.tmp-`.length);
    completed = path.join(outputParent, `.${outputName}.complete-${stageSuffix}`);

    const bgm = await resolveBgm(runStage, env);
    const channels = {};
    const historyRecords = [];
    for (const currentChannel of selectedChannels) {
      let category = "collection";
      let channelStage;
      try {
        channelStage = await mkdtemp(path.join(runStage, `.channel-${currentChannel}.tmp-`));
        const collectorRoot = path.join(channelStage, ".collector");
        const collectorOut = path.join(collectorRoot, "result");
        await spawnImpl("npm", [
          "run", "ranking:collect", "--",
          "--month", month,
          "--out", collectorOut,
          "--channel", currentChannel,
        ], { cwd: REPOSITORY_ROOT, env });

        category = "manifest";
        const collectedManifestPath = path.join(collectorOut, currentChannel, "ranking.json");
        const manifestSource = await readFile(collectedManifestPath, "utf8");
        const manifest = JSON.parse(manifestSource);
        validateManifest(manifest);
        if (manifest.channel !== currentChannel || manifest.period.month !== month) {
          throw new Error("manifest channel or month does not match orchestration target");
        }
        const manifestPath = path.join(channelStage, "ranking.json");
        await atomicWrite(manifestPath, manifestSource.endsWith("\n") ? manifestSource : `${manifestSource}\n`);
        await rm(collectorRoot, { recursive: true, force: true });

        category = "copy";
        const copy = buildCopy(manifest);
        await atomicWrite(path.join(channelStage, "narration.txt"), `${copy.narration}\n`);
        await atomicWrite(path.join(channelStage, "captions.json"), `${JSON.stringify(copy.captions, null, 2)}\n`);

        category = "assets";
        const assetsDir = path.join(channelStage, "assets");
        await prepareChannelAssets({ manifest, assetsDir, fetchImpl, lookupImpl, env });
        const style = styles[currentChannel]
          ? parseStyle(`${styles[currentChannel].placement}:${styles[currentChannel].motion}`)
          : recommendStyle(currentChannel, month, history);

        category = "render";
        const candidateDir = path.join(channelStage, "candidate");
        const videoPath = path.join(candidateDir, "ranking-short.mp4");
        await spawnImpl(env.RANKING_SHORTS_PYTHON || "python3", [
          RENDERER_PATH,
          "--manifest", manifestPath,
          "--assets", assetsDir,
          "--placement", style.placement,
          "--motion", style.motion,
          "--resolution", "1080x1920",
          "--bgm", bgm.path,
          "--out", videoPath,
        ], { cwd: REPOSITORY_ROOT, env: rendererEnvironment(env) });

        category = "verification";
        await verifyRendererArtifacts(videoPath);
        await atomicWrite(path.join(candidateDir, "post_caption.txt"), copy.postCaption);

        category = "promotion";
        const finalChannelStage = path.join(runStage, currentChannel);
        await rename(channelStage, finalChannelStage);
        channelStage = null;
        const finalVideoPath = path.join(outputRoot, currentChannel, "candidate", "ranking-short.mp4");
        historyRecords.push({ channel: currentChannel, month, ...style });
        channels[currentChannel] = { status: "ok", output: finalVideoPath, style };
      } catch (error) {
        console.error(`${currentChannel} channel failed at ${category}`);
        if (channelStage) await rm(channelStage, { recursive: true, force: true }).catch(() => {});
        channels[currentChannel] = failedChannel(category);
      }
    }

    await updateHistory(historyPath, historyRecords);
    const summary = {
      schemaVersion: 1,
      month,
      generatedAt: new Date().toISOString(),
      publishAttempted: false,
      bgm: bgm.summary,
      channels,
    };
    await atomicWrite(path.join(runStage, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
    await rename(runStage, completed);
    runStage = null;
    try {
      await symlink(path.relative(outputParent, completed), outputRoot, "dir");
      published = true;
    } catch (error) {
      await rm(completed, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    return channels;
  } finally {
    if (runStage) await rm(runStage, { recursive: true, force: true }).catch(() => {});
    if (!published && completed) await rm(completed, { recursive: true, force: true }).catch(() => {});
    await releaseOutputLock();
  }
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
