import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const portalSource = readFileSync(new URL("../src/pages/houtei-kenshu/portal.astro", import.meta.url), "utf8");
const installFabSource = readFileSync(new URL("../src/components/InstallFAB.astro", import.meta.url), "utf8");

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

test("certificate preview includes one fixed PDF print/save control at the jump target", () => {
  const previewSection = portalSource.match(/<section id="certificate-preview"[\s\S]*?<\/section>/)?.[0] || "";

  assert.match(previewSection, /id="certificate-preview-pdf-action"/);
  assert.match(previewSection, />\s*PDF印刷・保存\s*</);
  assert.doesNotMatch(previewSection, /id="certificate-preview-print"/);
  assert.doesNotMatch(previewSection, /id="certificate-preview-pdf"/);
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
  assert.match(tocSection, /toc-cube-terrazzo/);
  assert.match(tocSection, /toc-cube-wood/);
  assert.match(tocSection, /toc-tower-base/);
  assert.match(tocSection, /pattern id="toc-terrazzo"/);
  assert.match(tocSection, /pattern id="toc-wood"/);
  assert.match(portalSource, /@keyframes toc-tower-drop/);
  assert.match(portalSource, /@keyframes toc-tower-lift/);
  assert.match(portalSource, /@keyframes toc-tower-dock/);
  assert.match(portalSource, /@keyframes toc-orbit-a/);
  assert.match(portalSource, /@keyframes toc-orbit-e/);
  assert.match(reducedMotionStyles, /toc-tower-block/);
  assert.match(reducedMotionStyles, /toc-tower-lifter/);
  assert.match(reducedMotionStyles, /toc-tower-docker/);
  assert.match(reducedMotionStyles, /toc-tower-orbiter/);

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
  assert.match(portalSource, /\.certificate-sheet\s*{[\s\S]*height:\s*288mm;[\s\S]*min-height:\s*288mm;[\s\S]*max-height:\s*288mm;[\s\S]*padding:\s*0mm 16mm 0mm !important;/);
  assert.match(portalSource, /\.certificate-roster\s*{[\s\S]*display:\s*flex !important;[\s\S]*flex-direction:\s*column;[\s\S]*break-before:\s*page;[\s\S]*page-break-before:\s*always;[\s\S]*height:\s*288mm;[\s\S]*min-height:\s*288mm;[\s\S]*max-height:\s*288mm;[\s\S]*break-after:\s*avoid;[\s\S]*padding:\s*8mm 16mm 0mm !important;/);
  assert.match(portalSource, /\.certificate-sheet,\s*[\r\n]+\s*\.certificate-roster\s*{[\s\S]*border:\s*0 !important;[\s\S]*box-shadow:\s*inset 0 0 0 4px #14532d !important;/);
  assert.doesNotMatch(portalSource, /height:\s*260mm;\s*\n\s*min-height:\s*260mm;/);
  assert.match(portalSource, /#certificate-roster > \.overflow-hidden\s*{[\s\S]*flex:\s*1 1 auto;[\s\S]*display:\s*flex !important;/);
  assert.match(portalSource, /#certificate-roster table\s*{[\s\S]*height:\s*100% !important;/);
  assert.doesNotMatch(portalSource, /#certificate-roster tbody tr\s*{[\s\S]*height:\s*\d/);
  assert.match(portalSource, /\.certificate-roster th,\s*[\r\n]+\s*\.certificate-roster td\s*{[\s\S]*padding:\s*9px 10px !important;/);
});

test("print stylesheet has an iOS Safari fallback that fits two A4 pages", () => {
  const iosPrintFallback = portalSource.match(/@supports \(-webkit-touch-callout: none\) \{[\s\S]*?\n          \}/)?.[0] || "";

  assert.match(iosPrintFallback, /\.certificate-sheet,\s*[\r\n]+\s*\.certificate-roster\s*{[\s\S]*height:\s*220mm;[\s\S]*min-height:\s*220mm;[\s\S]*max-height:\s*220mm;/);
  assert.match(iosPrintFallback, /\.certificate-sheet\s*{[\s\S]*padding:\s*0mm 12mm 0mm !important;/);
  assert.match(iosPrintFallback, /\.certificate-roster\s*{[\s\S]*padding:\s*2mm 12mm 0mm !important;/);
  assert.match(iosPrintFallback, /\.certificate-roster th,\s*[\r\n]+\s*\.certificate-roster td\s*{[\s\S]*padding:\s*6px 8px !important;/);
});

test("certificate controls use the same fixed two-page PDF generator", () => {
  assert.match(portalSource, /generateCertificatePdfBlob/);
  assert.match(portalSource, /async function openCertificatePdf\(\)/);
  assert.match(portalSource, /const pdfWindow = window\.open\("", "_blank"\);/);
  assert.match(portalSource, /document\.getElementById\("certificate-preview-pdf-action"\)/);
  assert.match(portalSource, /addEventListener\("click", \(\) => openCertificatePdf\(\)\);/);
  assert.doesNotMatch(portalSource, /\["certificate-preview-print", "certificate-preview-pdf"\]\.forEach/);
  assert.doesNotMatch(portalSource, /function isIOSPrintEnvironment\(\)/);
  assert.doesNotMatch(portalSource, /function showIOSPrintGuidance\(\)/);
  assert.doesNotMatch(portalSource, /Safariの共有ボタンから印刷またはPDF保存/);
  assert.doesNotMatch(portalSource, /button\.addEventListener\("click", \(\) => window\.print\(\)\);/);
});

test("home screen install prompt is excluded from printed certificates", () => {
  assert.match(installFabSource, /id="install-fab"[\s\S]*class="[^"]*\bno-print\b/);
  assert.match(installFabSource, /id="ios-install-modal"[\s\S]*class="[^"]*\bno-print\b/);
  assert.match(portalSource, /header,\s*[\r\n]+\s*footer,\s*[\r\n]+\s*\.no-print,/);
});

test("completed modules expire after six months and reset quiz state", () => {
  assert.match(portalSource, /const COMPLETION_EXPIRY_MONTHS = 6;/);
  assert.match(portalSource, /completedAt: parsed\.completedAt && typeof parsed\.completedAt === "object" \? parsed\.completedAt : {}/);
  assert.match(portalSource, /state = expireCompletedModules\(state\);/);
  assert.match(portalSource, /sixMonthsAgo\.setMonth\(sixMonthsAgo\.getMonth\(\) - COMPLETION_EXPIRY_MONTHS\);/);
  assert.match(portalSource, /state\.completedAt\[moduleId\] = new Date\(\)\.toISOString\(\);/);
  assert.match(portalSource, /delete state\.answers\[moduleId\];/);
  assert.match(portalSource, /delete state\.results\[moduleId\];/);
  assert.match(portalSource, /delete state\.certificates\[moduleId\];/);
  assert.match(portalSource, /delete state\.completedAt\[moduleId\];/);
});
