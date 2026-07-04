import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";

import { A4_PAGE, PDF_LAYOUT, buildCertificatePdfPlan } from "./certificatePdfLayout.mjs";

const FONT_PATHS = {
  regular: "/fonts/IPAexGothic.ttf",
  bold: "/fonts/IPAexGothic.ttf",
};

const COLORS = {
  brand: rgb(0.08, 0.32, 0.22),
  brandLight: rgb(0.73, 0.85, 0.78),
  rosterFill: rgb(0.94, 0.98, 0.96),
  black: rgb(0.04, 0.10, 0.08),
};

export async function generateCertificatePdfBlob(certificate) {
  const bytes = await generateCertificatePdfBytes(certificate);
  return new Blob([bytes], { type: "application/pdf" });
}

export async function generateCertificatePdfBytes(certificate, options = {}) {
  const [regularFontBytes, boldFontBytes] = await Promise.all([
    options.regularFontBytes || fetchFontBytes(FONT_PATHS.regular),
    options.boldFontBytes || fetchFontBytes(FONT_PATHS.bold),
  ]);

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const regularFont = await pdfDoc.embedFont(regularFontBytes, { subset: true });
  const boldFont = await pdfDoc.embedFont(boldFontBytes, { subset: true });
  const measureText = (text, fontSize) => regularFont.widthOfTextAtSize(String(text || ""), fontSize);
  const plan = buildCertificatePdfPlan(certificate, measureText);

  drawCertificatePage(pdfDoc.addPage([A4_PAGE.width, A4_PAGE.height]), plan.certificate, { regularFont, boldFont });
  drawRosterPage(pdfDoc.addPage([A4_PAGE.width, A4_PAGE.height]), plan.roster, { regularFont, boldFont });

  return pdfDoc.save();
}

async function fetchFontBytes(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Font load failed: ${path}`);
  }
  return response.arrayBuffer();
}

function drawCertificatePage(page, certificate, fonts) {
  const { width, height } = page.getSize();
  drawFrame(page, PDF_LAYOUT.frameMargin);

  drawCenteredText(page, "CERTIFICATE", width / 2, height - 112, {
    font: fonts.boldFont,
    size: 15,
    color: COLORS.brand,
    characterSpacing: 6,
  });
  drawCenteredText(page, "修了証", width / 2, height - 168, {
    font: fonts.boldFont,
    size: 40,
    color: COLORS.black,
  });

  drawCenteredLines(page, ["以下の者は、下記の研修を受講し、", "小テストに全問正解したことを証明します。"], width / 2, height - 250, {
    font: fonts.regularFont,
    size: 17,
    lineHeight: 32,
    color: COLORS.brand,
  });

  const {
    labelX,
    valueX,
    rowWidth,
    rowStartY,
    rowGap,
  } = PDF_LAYOUT.certificate;
  const rows = [
    ["受講者", certificate.fields.name],
    ["所属", certificate.fields.organization],
    ["研修名", certificate.fields.module],
    ["受講日", { lines: [certificate.issuedDate], fontSize: 15 }],
  ];

  rows.forEach(([label, value], index) => {
    const y = rowStartY - index * rowGap;
    drawFieldRow(page, { label, value, labelX, valueX, y, rowWidth, fonts });
  });

  drawCenteredText(page, "ごうホームクリニック 訪問診療情報資料室", width / 2, 124, {
    font: fonts.boldFont,
    size: 18,
    color: COLORS.black,
  });
  drawCenteredText(page, `証明書番号: ${certificate.serial || ""}`, width / 2, 96, {
    font: fonts.regularFont,
    size: 10,
    color: COLORS.brand,
  });
}

function drawRosterPage(page, roster, fonts) {
  const { width, height } = page.getSize();
  drawFrame(page, PDF_LAYOUT.frameMargin);

  drawCenteredText(page, "ATTENDANCE ROSTER", width / 2, height - 50, {
    font: fonts.boldFont,
    size: 14,
    color: COLORS.brand,
    characterSpacing: 6,
  });
  drawCenteredText(page, "受講者名簿", width / 2, height - 92, {
    font: fonts.boldFont,
    size: 31,
    color: COLORS.black,
  });
  drawCenteredText(page, "サーバーには保存されません。PDF印刷・保存後、各自で記入してください。", width / 2, height - 132, {
    font: fonts.regularFont,
    size: 12,
    color: COLORS.brand,
  });

  const metaY = height - 154;
  drawMetaBlock(page, "研修名", roster.fields.rosterModule, 32, metaY, PDF_LAYOUT.roster.meta.moduleWidth, fonts);
  drawMetaBlock(page, "実施日", { lines: [roster.issuedDate], fontSize: 12 }, 282, metaY, 92, fonts);
  drawMetaBlock(page, "事業所名", roster.fields.rosterOrganization, 394, metaY, PDF_LAYOUT.roster.meta.organizationWidth, fonts);

  drawRosterTable(page, PDF_LAYOUT.roster.table, roster.rows, fonts);
}

function drawFrame(page, margin) {
  const { width, height } = page.getSize();
  page.drawRectangle({
    x: margin,
    y: margin,
    width: width - margin * 2,
    height: height - margin * 2,
    borderColor: COLORS.brand,
    borderWidth: 3,
  });
}

function drawFieldRow(page, { label, value, labelX, valueX, y, rowWidth, fonts }) {
  page.drawText(label, {
    x: labelX,
    y,
    size: 13,
    font: fonts.boldFont,
    color: COLORS.brand,
  });

  drawTextBlock(page, value, valueX, y + 3, {
    font: fonts.boldFont,
    lineHeight: 17,
    color: COLORS.black,
  });

  page.drawLine({
    start: { x: labelX, y: y - 14 },
    end: { x: labelX + rowWidth, y: y - 14 },
    thickness: 0.7,
    color: COLORS.brandLight,
  });
}

function drawMetaBlock(page, label, value, x, y, width, fonts) {
  page.drawText(label, {
    x,
    y,
    size: 11,
    font: fonts.boldFont,
    color: COLORS.brand,
  });
  drawTextBlock(page, value, x, y - 21, {
    font: fonts.boldFont,
    lineHeight: 13,
    color: COLORS.black,
  });
  page.drawLine({
    start: { x, y: y - 38 },
    end: { x: x + width, y: y - 38 },
    thickness: 0.6,
    color: COLORS.brandLight,
  });
}

function drawRosterTable(page, table, rows, fonts) {
  const columnWidths = [40, 214, 190, table.width - 40 - 214 - 190];
  const rowHeight = (table.height - table.headerHeight) / rows.length;
  const headers = ["No.", "受講者名", "所属", "受講日"];
  const topY = table.y + table.height;

  page.drawRectangle({
    x: table.x,
    y: topY - table.headerHeight,
    width: table.width,
    height: table.headerHeight,
    color: COLORS.rosterFill,
  });

  let x = table.x;
  headers.forEach((header, index) => {
    page.drawText(header, {
      x: x + 8,
      y: topY - 22,
      size: 10,
      font: fonts.boldFont,
      color: COLORS.black,
    });
    x += columnWidths[index];
  });

  for (let index = 0; index <= rows.length + 1; index += 1) {
    const y = index === 0
      ? topY
      : topY - table.headerHeight - (index - 1) * rowHeight;
    page.drawLine({
      start: { x: table.x, y },
      end: { x: table.x + table.width, y },
      thickness: index === 0 || index === rows.length + 1 ? 1.1 : 0.7,
      color: COLORS.brand,
    });
  }

  let currentX = table.x;
  for (const columnWidth of columnWidths) {
    page.drawLine({
      start: { x: currentX, y: table.y },
      end: { x: currentX, y: topY },
      thickness: 0.7,
      color: COLORS.brand,
    });
    currentX += columnWidth;
  }
  page.drawLine({
    start: { x: table.x + table.width, y: table.y },
    end: { x: table.x + table.width, y: topY },
    thickness: 0.7,
    color: COLORS.brand,
  });

  rows.forEach((row, index) => {
    const y = topY - table.headerHeight - rowHeight * index - rowHeight / 2 - 5;
    drawCenteredText(page, String(row), table.x + columnWidths[0] / 2, y, {
      font: fonts.boldFont,
      size: 11,
      color: COLORS.black,
    });
  });
}

function drawTextBlock(page, block, x, y, options) {
  const lines = Array.isArray(block?.lines) ? block.lines : [String(block || "")];
  const fontSize = block?.fontSize || options.size || 11;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * options.lineHeight,
      size: fontSize,
      font: options.font,
      color: options.color,
    });
  });
}

function drawCenteredLines(page, lines, centerX, y, options) {
  lines.forEach((line, index) => {
    drawCenteredText(page, line, centerX, y - index * options.lineHeight, options);
  });
}

function drawCenteredText(page, text, centerX, y, options) {
  const width = options.font.widthOfTextAtSize(text, options.size);
  page.drawText(text, {
    x: centerX - width / 2,
    y,
    size: options.size,
    font: options.font,
    color: options.color,
    characterSpacing: options.characterSpacing || 0,
  });
}
