import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../gas/public-content-ranking-api/", import.meta.url);

test("public GAS is an anonymous JSON-only deployment", async () => {
  const manifest = JSON.parse(await readFile(new URL("appsscript.json", ROOT), "utf8"));
  const source = await readFile(new URL("Code.js", ROOT), "utf8");

  assert.deepEqual(manifest.webapp, {
    executeAs: "USER_DEPLOYING",
    access: "ANYONE_ANONYMOUS",
  });
  assert.match(source, /function doGet\(/);
  assert.doesNotMatch(source, /HtmlService|google\.script\.run|getAdsToken|sendToChatWork|ScriptApp|setProperty\(/);
  assert.doesNotMatch(source, /access_token=/);

  const publicFunctions = [...source.matchAll(/^function\s+([A-Za-z0-9_]+)\s*\(/gm)]
    .map((match) => match[1])
    .filter((name) => !name.endsWith("_"));
  assert.deepEqual(publicFunctions, ["doGet"]);
});

test("public GAS reads only the three required read-only property names", async () => {
  const source = await readFile(new URL("Code.js", ROOT), "utf8");
  const names = [...source.matchAll(/getProperty\("([A-Z0-9_]+)"\)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(names)].sort(), [
    "CONTENT_SNAPSHOT_SPREADSHEET_ID",
    "META_PAGE_ACCESS_TOKEN",
    "PODCAST_SPREADSHEET_ID",
  ]);
});

test("public GAS preserves the existing podcast portal route without management code", async () => {
  const source = await readFile(new URL("Code.js", ROOT), "utf8");
  assert.match(source, /api === "podcast-list"/);
  assert.match(source, /function getPodcastList_\(/);
  assert.doesNotMatch(source, /appendRow|setValues|insertSheet|createTrigger|newTrigger/);
});

test("public GAS keeps errors allowlisted and never serializes caught upstream details", async () => {
  const source = await readFile(new URL("Code.js", ROOT), "utf8");
  assert.match(source, /PUBLIC_ERROR_CODES_/);
  assert.doesNotMatch(source, /error\.toString\(\)|err\.message|error\.message/);
});
