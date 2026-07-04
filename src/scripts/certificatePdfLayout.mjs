export const A4_PAGE = Object.freeze({ width: 595.28, height: 841.89 });
export const ROSTER_ROW_COUNT = 12;
export const PDF_LAYOUT = Object.freeze({
  frameMargin: 10,
  certificate: {
    labelX: 48,
    valueX: 140,
    rowWidth: A4_PAGE.width - 96,
    rowStartY: A4_PAGE.height - 328,
    rowGap: 78,
    fieldValueWidth: 405,
  },
  roster: {
    meta: {
      moduleWidth: 230,
      organizationWidth: 165,
    },
    table: {
      x: 28,
      y: 30,
      width: A4_PAGE.width - 56,
      height: 612,
      headerHeight: 34,
    },
  },
});

const DEFAULT_MEASURE_TEXT = (text, fontSize) => Array.from(String(text)).length * fontSize * 0.58;

export function fitTextBlock({
  text,
  maxWidth,
  initialFontSize,
  minFontSize,
  maxLines,
  measureText = DEFAULT_MEASURE_TEXT,
}) {
  const normalized = normalizeText(text);
  const lowerBound = Math.min(initialFontSize, minFontSize);

  for (let size = initialFontSize; size >= lowerBound; size -= 0.5) {
    const fontSize = Number(size.toFixed(2));
    const lines = wrapTextToLines(normalized, maxWidth, fontSize, measureText);
    if (lines.length <= maxLines && lines.every((line) => measureText(line, fontSize) <= maxWidth)) {
      return { lines, fontSize, truncated: false };
    }
  }

  const fontSize = lowerBound;
  const wrapped = wrapTextToLines(normalized, maxWidth, fontSize, measureText);
  const lines = wrapped.slice(0, maxLines);
  if (wrapped.length > maxLines && lines.length > 0) {
    lines[lines.length - 1] = ellipsizeLine(lines[lines.length - 1], maxWidth, fontSize, measureText);
  }

  return { lines, fontSize, truncated: wrapped.length > maxLines };
}

export function wrapTextToLines(text, maxWidth, fontSize, measureText = DEFAULT_MEASURE_TEXT) {
  const source = normalizeText(text);
  if (!source) return [""];

  const lines = [];
  let current = "";
  for (const char of Array.from(source)) {
    if (char === "\n") {
      lines.push(current);
      current = "";
      continue;
    }

    const candidate = `${current}${char}`;
    if (current && measureText(candidate, fontSize) > maxWidth) {
      lines.push(current);
      current = char.trimStart();
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

export function buildCertificatePdfPlan(certificate, measureText = DEFAULT_MEASURE_TEXT) {
  const displayNumber = normalizeText(certificate.displayNumber);
  const moduleTitle = normalizeText(certificate.moduleTitle);
  const moduleName = normalizeText(`${displayNumber} ${moduleTitle}`.trim());
  const issuedDate = certificate.issuedAt
    ? new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(certificate.issuedAt))
    : "";

  const fields = {
    name: fitTextBlock({
      text: certificate.name || "",
      maxWidth: PDF_LAYOUT.certificate.fieldValueWidth,
      initialFontSize: 15,
      minFontSize: 8,
      maxLines: 2,
      measureText,
    }),
    organization: fitTextBlock({
      text: certificate.organization || "",
      maxWidth: PDF_LAYOUT.certificate.fieldValueWidth,
      initialFontSize: 14,
      minFontSize: 8,
      maxLines: 2,
      measureText,
    }),
    module: fitTextBlock({
      text: moduleName,
      maxWidth: PDF_LAYOUT.certificate.fieldValueWidth,
      initialFontSize: 14,
      minFontSize: 8,
      maxLines: 2,
      measureText,
    }),
    rosterModule: fitTextBlock({
      text: moduleName,
      maxWidth: PDF_LAYOUT.roster.meta.moduleWidth,
      initialFontSize: 11,
      minFontSize: 7,
      maxLines: 2,
      measureText,
    }),
    rosterOrganization: fitTextBlock({
      text: certificate.organization || "",
      maxWidth: PDF_LAYOUT.roster.meta.organizationWidth,
      initialFontSize: 11,
      minFontSize: 7,
      maxLines: 2,
      measureText,
    }),
  };

  return {
    pages: [
      { type: "certificate", size: A4_PAGE },
      { type: "roster", size: A4_PAGE },
    ],
    certificate: {
      ...certificate,
      issuedDate,
      moduleName,
      fields,
    },
    roster: {
      rows: Array.from({ length: ROSTER_ROW_COUNT }, (_, index) => index + 1),
      moduleName,
      issuedDate,
      fields,
    },
  };
}

function ellipsizeLine(line, maxWidth, fontSize, measureText) {
  const suffix = "...";
  let output = String(line || "");
  while (output && measureText(`${output}${suffix}`, fontSize) > maxWidth) {
    output = Array.from(output).slice(0, -1).join("");
  }
  return `${output}${suffix}`;
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
