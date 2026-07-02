import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalSource = readFileSync(new URL("../src/pages/houtei-kenshu/portal.astro", import.meta.url), "utf8");

test("portal learner fields collect only name and organization", () => {
  assert.match(portalSource, /受講者名/);
  assert.match(portalSource, /所属/);
  assert.doesNotMatch(portalSource, /職種/);
  assert.doesNotMatch(portalSource, /learner-role/);
  assert.doesNotMatch(portalSource, /certificate-preview-role/);
});

test("portal certificate creation does not require learner name", () => {
  assert.doesNotMatch(portalSource, /受講者名を入力してください/);
  assert.doesNotMatch(portalSource, /state\.learner\.name\?\.trim\(\)/);
});

test("certificate preview includes print and pdf controls at the jump target", () => {
  const previewSection = portalSource.match(/<section id="certificate-preview"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(previewSection, /id="certificate-preview-print"/);
  assert.match(previewSection, />\s*印刷\s*</);
  assert.match(previewSection, /id="certificate-preview-pdf"/);
  assert.match(previewSection, />\s*PDF保存\s*</);
});

test("certificate preview includes a simple attendee roster as the second sheet", () => {
  const previewSection = portalSource.match(/<section id="certificate-preview"[\s\S]*?<\/section>/)?.[0] || "";
  const rosterSection = portalSource.match(/<section id="certificate-roster"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(previewSection, /id="certificate-roster"/);
  assert.match(rosterSection, /受講者名簿/);
  assert.match(rosterSection, /No\./);
  assert.match(rosterSection, /受講者名/);
  assert.match(rosterSection, /所属/);
  assert.match(rosterSection, /受講日/);
  assert.doesNotMatch(rosterSection, /受講確認署名/);
  assert.doesNotMatch(rosterSection, /<(input|textarea|select)\b/);
});

test("module cards do not include print or pdf controls", () => {
  const beforePreview = portalSource.slice(0, portalSource.indexOf('<section id="certificate-preview"'));

  assert.doesNotMatch(beforePreview, /data-print-certificate/);
  assert.doesNotMatch(beforePreview, />\s*印刷・PDF保存\s*</);
});

test("training table of contents uses a colorful animated link grid", () => {
  const tocSection = portalSource.match(/<nav class="training-toc-stage[\s\S]*?<\/nav>/)?.[0] || "";

  assert.match(tocSection, /研修を選ぶ/);
  assert.match(tocSection, /training-toc-card/);
  assert.match(tocSection, /data-toc-status/);
  assert.match(tocSection, /href={`#module-\$\{item\.id\}`}/);
  assert.match(portalSource, /--color-mint-pulse:\s*#d1ffca;/);
  assert.match(portalSource, /--color-electric-yellow:\s*#fff100;/);
  assert.match(portalSource, /@keyframes toc-tower-drop/);
  assert.match(portalSource, /prefers-reduced-motion:\s*reduce/);
});

test("training toc puts a single playful block tower on a flat canvas", () => {
  const tocSection = portalSource.match(/<nav class="training-toc-stage[\s\S]*?<\/nav>/)?.[0] || "";
  const reducedMotionStyles = portalSource.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(tocSection, /class="training-toc-tower"/);
  assert.match(tocSection, /aria-hidden="true"/);
  assert.match(tocSection, /toc-iso-block/);
  assert.match(tocSection, /toc-tower-base/);
  assert.match(tocSection, /pattern id="toc-terrazzo"/);
  assert.match(tocSection, /pattern id="toc-wood"/);
  assert.match(portalSource, /@keyframes toc-tower-drop/);
  assert.match(portalSource, /@keyframes toc-tower-lift/);
  assert.match(portalSource, /@keyframes toc-tower-dock/);
  assert.match(portalSource, /@keyframes toc-tower-float/);
  assert.match(reducedMotionStyles, /toc-tower-block/);
  assert.match(reducedMotionStyles, /toc-tower-lifter/);
  assert.match(reducedMotionStyles, /toc-tower-docker/);
  assert.match(reducedMotionStyles, /toc-tower-floater/);

  // The decorative background layers must stay gone.
  assert.doesNotMatch(portalSource, /training-toc-build-layer/);
  assert.doesNotMatch(portalSource, /training-toc-frame-part/);
  assert.doesNotMatch(portalSource, /training-toc-grid-beam/);
});

test("training toc surfaces stay flat per the Swiss editorial reference", () => {
  const stageStyles = portalSource.match(/\.training-toc-stage\s*{[\s\S]*?}/)?.[0] || "";
  const cardStyles = portalSource.match(/\.training-toc-card\s*{[\s\S]*?}/)?.[0] || "";
  const statusTones = portalSource.match(/\.training-toc-card\[data-status-tone[\s\S]*?review"\]\s*{[\s\S]*?}/)?.[0] || "";

  assert.match(stageStyles, /background:\s*var\(--color-canvas-mist\)/);
  assert.doesNotMatch(stageStyles, /box-shadow/);
  assert.doesNotMatch(stageStyles, /gradient/);
  assert.doesNotMatch(cardStyles, /box-shadow/);
  assert.doesNotMatch(cardStyles, /gradient/);
  assert.doesNotMatch(statusTones, /gradient/);
  assert.match(cardStyles, /background:\s*var\(--color-pure-white\)/);
});

test("training table of contents animates the visible card accent planes", () => {
  assert.match(portalSource, /@keyframes toc-card-accent-build/);
  assert.match(portalSource, /\.training-toc-card__accent\s*{[\s\S]*animation:\s*toc-card-accent-build/);
  assert.match(portalSource, /--toc-accent-delay:/);
  assert.match(portalSource, /animation-delay:\s*var\(--toc-accent-delay\)/);
});

test("training table of contents keeps mobile cards readable", () => {
  const mobileStyles = portalSource.match(/@media \(max-width: 640px\) \{[\s\S]*?\n    \}/)?.[0] || "";

  assert.match(mobileStyles, /\.training-toc-card\s*{[\s\S]*flex-direction:\s*column;/);
  assert.match(mobileStyles, /\.training-toc-card__main\s*{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\);/);
  assert.match(mobileStyles, /\.training-toc-copy\s*{[\s\S]*display:\s*contents;/);
  assert.match(mobileStyles, /\.training-toc-meta\s*{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(mobileStyles, /\.training-toc-card__side\s*{[\s\S]*display:\s*flex;[\s\S]*justify-content:\s*flex-start;/);
  assert.match(mobileStyles, /\.training-toc-title\s*{[\s\S]*overflow-wrap:\s*break-word;[\s\S]*word-break:\s*normal;/);
  assert.match(mobileStyles, /\.training-toc-meta span\s*{[\s\S]*white-space:\s*normal;/);
});

test("print stylesheet outputs the certificate without browser page margins", () => {
  assert.match(portalSource, /@page\s*{\s*size:\s*A4 portrait;\s*margin:\s*0;\s*}/);
  assert.match(portalSource, /body\s*{[\s\S]*margin:\s*0 !important;/);
  assert.match(portalSource, /\.certificate-print\s*{[\s\S]*display:\s*block !important;[\s\S]*padding:\s*0 !important;/);
  assert.match(portalSource, /break-after:\s*avoid;/);
  assert.doesNotMatch(portalSource, /height:\s*260mm;/);
  assert.match(portalSource, /\.certificate-sheet\s*{[\s\S]*height:\s*297mm;[\s\S]*padding:\s*18mm 16mm !important;/);
  assert.match(portalSource, /\.certificate-roster\s*{[\s\S]*break-before:\s*page;[\s\S]*page-break-before:\s*always;[\s\S]*height:\s*297mm;[\s\S]*padding:\s*16mm 14mm !important;/);
});
