import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const entryPoint = new URL("../functions/api/auth/line/start.ts", import.meta.url).pathname;
const env = {
  LINE_LOGIN_CHANNEL_ID: "1234567890",
  LINE_LOGIN_CHANNEL_SECRET: "line-login-secret",
  LINE_SESSION_SECRET: "line-session-secret-for-tests",
};

let bundledModulePromise;
let tempDirectory;

async function loadStartModule() {
  if (bundledModulePromise) return bundledModulePromise;

  tempDirectory = await mkdtemp(join(tmpdir(), "gohome-line-start-"));
  const outfile = join(tempDirectory, "start.mjs");
  await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    outfile,
    logLevel: "silent",
  });
  bundledModulePromise = import(pathToFileURL(outfile).href);
  return bundledModulePromise;
}

test.after(async () => {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
});

async function authorizationUrlFor(userAgent) {
  const { onRequestGet } = await loadStartModule();
  const response = await onRequestGet({
    request: new Request("https://study.gohome-clinic.com/api/auth/line/start?returnTo=/houtei-kenshu/portal/", {
      headers: { "User-Agent": userAgent },
    }),
    env,
  });

  assert.equal(response.status, 302);
  return new URL(response.headers.get("Location"));
}

test("desktop LINE Login keeps QR-code login as the fixed initial method", async () => {
  const authorizationUrl = await authorizationUrlFor(
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15",
  );

  assert.equal(authorizationUrl.hostname, "access.line.me");
  assert.equal(authorizationUrl.searchParams.get("bot_prompt"), "aggressive");
  assert.equal(authorizationUrl.searchParams.get("prompt"), "login");
  assert.equal(authorizationUrl.searchParams.get("initial_amr_display"), "lineqr");
  assert.equal(authorizationUrl.searchParams.get("switch_amr"), "false");
  assert.equal(authorizationUrl.searchParams.get("disable_auto_login"), "true");
});

test("mobile LINE Login allows LINE app launch and auto login instead of forcing QR code", async () => {
  const authorizationUrl = await authorizationUrlFor(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  );

  assert.equal(authorizationUrl.hostname, "access.line.me");
  assert.equal(authorizationUrl.searchParams.get("bot_prompt"), "aggressive");
  assert.equal(authorizationUrl.searchParams.has("prompt"), false);
  assert.equal(authorizationUrl.searchParams.has("initial_amr_display"), false);
  assert.equal(authorizationUrl.searchParams.has("switch_amr"), false);
  assert.equal(authorizationUrl.searchParams.has("disable_auto_login"), false);
});
