import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { collectBlogRanking } from "./blog.mjs";
import { collectInstagramRanking } from "./instagram.mjs";
import { periodFromMonth, previousMonthPeriod } from "./period.mjs";
import { validateManifest, writeManifest } from "./schema.mjs";
import { collectYouTubeRanking } from "./youtube.mjs";

const CHANNEL_ID = "UCJ2B_z_pz0R_yTZkRbSl4Lg";
const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const OPTIONS = new Set(["--month", "--out"]);
const OAUTH_NETWORK_ERROR_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);
const DEFAULT_FILE_OPS = { mkdir, mkdtemp, rename, rm };

function nonEmptyEnvironmentValue(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireGasUrl(env) {
  const value = nonEmptyEnvironmentValue(env, "CONTENT_ANALYTICS_GAS_URL");
  if (!value) throw new Error("CONTENT_ANALYTICS_GAS_URL is required");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CONTENT_ANALYTICS_GAS_URL must be a valid HTTP(S) URL");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("CONTENT_ANALYTICS_GAS_URL must be a valid HTTP(S) URL");
  }
  return url.href;
}

function youtubeCredentialMode(env) {
  const accessToken = nonEmptyEnvironmentValue(env, "YOUTUBE_ACCESS_TOKEN");
  if (accessToken) return { mode: "access", accessToken };
  const refreshToken = nonEmptyEnvironmentValue(env, "YOUTUBE_REFRESH_TOKEN");
  const clientId = nonEmptyEnvironmentValue(env, "YOUTUBE_CLIENT_ID");
  const clientSecret = nonEmptyEnvironmentValue(env, "YOUTUBE_CLIENT_SECRET");
  if (!refreshToken || !clientId || !clientSecret) {
    throw new Error(
      "YouTube credentials require YOUTUBE_ACCESS_TOKEN or YOUTUBE_REFRESH_TOKEN with YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET",
    );
  }
  return { mode: "refresh", refreshToken, clientId, clientSecret };
}

function validateEnvironment(env) {
  return {
    gasUrl: requireGasUrl(env),
    credentials: youtubeCredentialMode(env),
  };
}

export function parseCollectArgs(argv) {
  if (!Array.isArray(argv)) throw new Error("CLI arguments must be an array");
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (typeof option !== "string" || !OPTIONS.has(option)) {
      throw new Error(`unknown CLI option: ${String(option)}`);
    }
    if (Object.hasOwn(result, option.slice(2))) throw new Error(`duplicate CLI option: ${option}`);
    if (typeof value !== "string" || !value.trim() || value.startsWith("--")) {
      throw new Error(`CLI option ${option} requires a value`);
    }
    result[option.slice(2)] = value;
  }
  return result;
}

export async function resolveYouTubeAccessToken({ env, fetchImpl = fetch, credentials } = {}) {
  const resolved = credentials ?? youtubeCredentialMode(env ?? {});
  if (resolved.mode === "access") {
    const accessToken = typeof resolved.accessToken === "string" ? resolved.accessToken.trim() : "";
    if (!accessToken) throw new Error("YouTube access token is empty");
    return accessToken;
  }

  let response;
  try {
    response = await fetchImpl(OAUTH_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: resolved.refreshToken,
        client_id: resolved.clientId,
        client_secret: resolved.clientSecret,
      }).toString(),
    });
  } catch (error) {
    const code = typeof error?.code === "string" && OAUTH_NETWORK_ERROR_CODES.has(error.code)
      ? ` code=${error.code}`
      : "";
    throw new Error(`YouTube OAuth token request failed${code}`);
  }
  if (!response || typeof response !== "object" || response.ok !== true || typeof response.json !== "function") {
    const status = response && Number.isInteger(response.status)
      && response.status >= 100 && response.status <= 599
      ? response.status
      : "unknown";
    throw new Error(`YouTube OAuth token endpoint status=${status}`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("YouTube OAuth token response was not valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.access_token !== "string" || !body.access_token.trim()) {
    throw new Error("YouTube OAuth token endpoint returned an invalid access token");
  }
  if (Object.hasOwn(body, "token_type")
    && (typeof body.token_type !== "string" || body.token_type.trim().toLowerCase() !== "bearer")) {
    throw new Error("YouTube OAuth token endpoint returned an invalid token type");
  }
  return body.access_token.trim();
}

function requireChannelManifests(manifests) {
  const expectedChannels = ["youtube", "blog", "instagram"];
  if (!Array.isArray(manifests) || manifests.length !== expectedChannels.length) {
    throw new Error("collectors must return exactly three manifests");
  }
  for (const [index, manifest] of manifests.entries()) {
    validateManifest(manifest);
    if (manifest.channel !== expectedChannels[index]) {
      throw new Error(`collector returned unexpected channel ${manifest.channel}`);
    }
  }
}

async function writeStagedManifests(out, manifests, fileOps = {}) {
  const operations = { ...DEFAULT_FILE_OPS, ...fileOps };
  const parent = dirname(out);
  await operations.mkdir(parent, { recursive: true });
  const staging = await operations.mkdtemp(join(parent, `.${basename(out)}.tmp-`));
  let finalCreated = false;
  try {
    await Promise.all(manifests.map((manifest) => writeManifest(
      join(staging, manifest.channel, "ranking.json"),
      manifest,
    )));
    try {
      await operations.mkdir(out, { recursive: false });
      finalCreated = true;
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`output path already exists: ${out}`);
      throw error;
    }
    for (const manifest of manifests) {
      await operations.rename(join(staging, manifest.channel), join(out, manifest.channel));
    }
    await operations.rm(staging, { recursive: true, force: true });
  } catch (error) {
    if (finalCreated) await operations.rm(out, { recursive: true, force: true });
    await operations.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function runCollection({
  argv = [],
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
  collectors = {},
  fileOps = {},
} = {}) {
  const args = parseCollectArgs(argv);
  const period = args.month ? periodFromMonth(args.month, now) : previousMonthPeriod(now);
  const out = resolve(args.out ?? join("output", "monthly-ranking", period.month));
  const configuration = validateEnvironment(env);
  const accessToken = await resolveYouTubeAccessToken({
    env,
    fetchImpl,
    credentials: configuration.credentials,
  });
  const youtubeCollector = collectors.youtube ?? collectYouTubeRanking;
  const blogCollector = collectors.blog ?? collectBlogRanking;
  const instagramCollector = collectors.instagram ?? collectInstagramRanking;
  const manifests = await Promise.all([
    youtubeCollector({ accessToken, channelId: CHANNEL_ID, period, fetchImpl }),
    blogCollector({ gasUrl: configuration.gasUrl, period, fetchImpl }),
    instagramCollector({ gasUrl: configuration.gasUrl, period, fetchImpl }),
  ]);
  requireChannelManifests(manifests);
  await writeStagedManifests(out, manifests, fileOps);
  return { out, period, manifests };
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = fetch } = {}) {
  const result = await runCollection({ argv, env, fetchImpl });
  console.log(`Monthly ranking manifests written to ${result.out}`);
  return result;
}

const isDirectExecution = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isDirectExecution) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Monthly ranking collection failed");
    process.exitCode = 1;
  });
}
