import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const materialsSource = readFileSync(new URL("../src/data/materials.ts", import.meta.url), "utf8");

function familySectionSource() {
  const match = materialsSource.match(/\/\/ ===== ご家族向け =====([\s\S]*?)\/\/ ===== 連携医療機関向け =====/);
  assert.ok(match, "ご家族向け section should exist");
  return match[1];
}

test("clinic brochure is the top material in the family section", () => {
  const section = familySectionSource();
  const firstMaterial = section.match(/\{\s*slug:[\s\S]*?\n\s*\}/)?.[0] || "";

  assert.match(firstMaterial, /slug:\s*"clinic-brochure"/);
  assert.match(firstMaterial, /title:\s*"診療パンフレット"/);
  assert.match(firstMaterial, /filename:\s*"clinic-brochure\.pdf"/);
  assert.match(firstMaterial, /category:\s*"ご家族向け"/);
  assert.match(firstMaterial, /audience:\s*"patient"/);
});

test("clinic brochure pdf asset exists", () => {
  assert.equal(
    existsSync(new URL("../public/materials/clinic-brochure.pdf", import.meta.url)),
    true,
  );
});
