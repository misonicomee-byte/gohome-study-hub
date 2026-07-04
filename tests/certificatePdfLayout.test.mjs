import assert from "node:assert/strict";
import test from "node:test";

import {
  A4_PAGE,
  PDF_LAYOUT,
  ROSTER_ROW_COUNT,
  buildCertificatePdfPlan,
  fitTextBlock,
} from "../src/scripts/certificatePdfLayout.mjs";

const measureText = (text, fontSize) => Array.from(String(text)).length * fontSize * 0.58;

test("certificate PDF plan is always fixed to two A4 pages", () => {
  const plan = buildCertificatePdfPlan({
    name: "非常に長い受講者名".repeat(12),
    organization: "非常に長い所属名".repeat(16),
    moduleTitle: "他制度理解④ 難病患者等".repeat(16),
    displayNumber: "他制度理解④",
    issuedAt: "2026-07-03T00:00:00.000Z",
    serial: "GHC-HK-TEST-20260703-LONGTEXT",
  }, measureText);

  assert.equal(plan.pages.length, 2);
  assert.deepEqual(plan.pages.map((page) => page.size), [A4_PAGE, A4_PAGE]);
  assert.equal(plan.roster.rows.length, ROSTER_ROW_COUNT);
});

test("long certificate fields wrap, shrink, and never exceed their boxes", () => {
  const block = fitTextBlock({
    text: "ごうホームクリニック居宅介護支援事業所".repeat(18),
    maxWidth: 230,
    initialFontSize: 13,
    minFontSize: 8,
    maxLines: 2,
    measureText,
  });

  assert.equal(block.lines.length, 2);
  assert.ok(block.fontSize <= 13);
  assert.ok(block.fontSize >= 8);
  assert.ok(block.lines.every((line) => measureText(line, block.fontSize) <= 230));
  assert.equal(block.truncated, true);
});

test("short certificate fields keep their original size without truncation", () => {
  const block = fitTextBlock({
    text: "他制度理解④ 難病患者等",
    maxWidth: 280,
    initialFontSize: 13,
    minFontSize: 8,
    maxLines: 2,
    measureText,
  });

  assert.equal(block.fontSize, 13);
  assert.deepEqual(block.lines, ["他制度理解④ 難病患者等"]);
  assert.equal(block.truncated, false);
});

test("fixed PDF layout fills nearly the whole A4 page", () => {
  assert.equal(PDF_LAYOUT.frameMargin, 10);
  assert.ok(PDF_LAYOUT.frameMargin <= 12);
  assert.ok(PDF_LAYOUT.certificate.fieldValueWidth >= 390);
  assert.ok(PDF_LAYOUT.roster.table.x <= 30);
  assert.ok(PDF_LAYOUT.roster.table.y <= 32);
  assert.ok(PDF_LAYOUT.roster.table.width >= A4_PAGE.width - 60);
  assert.ok(PDF_LAYOUT.roster.table.height >= 610);
});
