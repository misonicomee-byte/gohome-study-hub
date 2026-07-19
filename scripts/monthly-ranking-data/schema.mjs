import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const CHANNELS = ["youtube", "blog", "instagram"];

export function validateManifest(value) {
  if (value?.schemaVersion !== 1) throw new Error("schemaVersion must be 1");
  if (!CHANNELS.includes(value.channel)) throw new Error("invalid channel");
  if (value.period?.timezone !== "Asia/Tokyo") throw new Error("timezone must be Asia/Tokyo");
  if (!Array.isArray(value.items) || value.items.length !== 3) {
    throw new Error("manifest must contain exactly 3 items");
  }
  if (value.items.map((item) => item.rank).join(",") !== "1,2,3") {
    throw new Error("items must have ranks 1,2,3");
  }
  for (const item of value.items) {
    if (!item.contentId || !item.title || !item.url || !Number.isFinite(item.metricValue)) {
      throw new Error(`invalid rank ${item.rank}`);
    }
  }
  return value;
}

export async function writeManifest(path, value) {
  validateManifest(value);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
