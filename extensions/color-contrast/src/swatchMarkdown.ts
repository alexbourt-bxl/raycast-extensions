export function buildSwatchMarkdown(params: {
  foregroundHex: string;
  backgroundHex: string;
  label: string;
  size?: number;
  borderColor?: string;
  footerText?: string;
  footerColor?: string;
  footerBadges?: {
    foregroundHex: string;
    backgroundHex: string;
    foregroundText?: string;
    backgroundText?: string;
  };
  width?: number;
}): string {
  const size = params.size ?? 128;
  const fontSize = Math.round(size * 0.36);
  const borderColor = params.borderColor;
  const footerText = params.footerText ?? "";
  const footerColor = params.footerColor;
  const footerBadges = params.footerBadges;

  const width = Math.max(params.width ?? size, size);
  const padding = 10;
  const footerFontSize = 14;
  const footerLineHeight = 18;

  const footerLines = footerBadges ? [] : footerText ? footerText.split(/\r?\n/g) : [];

  const badgesBlockHeight = footerBadges
    ? calculateBadgesBlockHeight({
        padding,
      })
    : 0;

  const footerTextBlockHeight = footerLines.length > 0 ? padding + footerLines.length * footerLineHeight + padding : 0;

  const footerBlockHeight = footerBadges ? badgesBlockHeight : footerTextBlockHeight;
  const height = size + footerBlockHeight;

  const swatchX = Math.round((width - size) / 2);
  const swatchCenterX = swatchX + size / 2;
  const swatchCenterY = size * 0.55;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="${swatchX + 0.5}" y="0.5" width="${size - 1}" height="${size - 1}" rx="14" fill="${params.backgroundHex}"${borderColor ? ` stroke="${borderColor}" stroke-width="1"` : ""}/>
  <text x="${swatchCenterX}" y="${swatchCenterY}"
        dominant-baseline="middle"
        text-anchor="middle"
        font-family="-apple-system, Segoe UI, Arial"
        font-size="${fontSize}"
        font-weight="500"
        fill="${params.foregroundHex}">
    ${escapeXml(params.label)}
  </text>
  ${
    footerBadges
      ? buildFooterBadgesSvg({
          width,
          y: size + padding,
          padding,
          fontSize: footerFontSize,
          foregroundHex: footerBadges.foregroundHex,
          backgroundHex: footerBadges.backgroundHex,
          foregroundText: footerBadges.foregroundText ?? footerBadges.foregroundHex,
          backgroundText: footerBadges.backgroundText ?? footerBadges.backgroundHex,
        })
      : ""
  }
  ${
    footerLines.length > 0
      ? buildFooterSvg({
          lines: footerLines,
          x: width / 2,
          y: size + padding + footerFontSize,
          fontSize: footerFontSize,
          lineHeight: footerLineHeight,
          color: footerColor,
          textAnchor: "middle",
        })
      : ""
  }
</svg>`;

  const uri = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return `![swatch](${uri})`;
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildFooterSvg(params: {
  lines: string[];
  x: number;
  y: number;
  fontSize: number;
  lineHeight: number;
  color?: string;
  textAnchor?: "start" | "middle" | "end";
}): string {
  const lines = params.lines.map((line) => escapeXml(line));

  const tspans = lines
    .map((line, idx) => {
      const dy = idx === 0 ? 0 : params.lineHeight;
      return `<tspan x="${params.x}" dy="${dy}">${line}</tspan>`;
    })
    .join("");

  const colorAttr = params.color ? ` fill="${params.color}"` : "";
  const anchor = params.textAnchor ?? "start";

  return `<text x="${params.x}" y="${params.y}" font-family="SF Mono, Menlo, Consolas, monospace" font-size="${params.fontSize}" text-anchor="${anchor}"${colorAttr}>${tspans}</text>`;
}

function calculateBadgesBlockHeight(params: { padding: number }): number {
  const badgeHeight = 28;
  const gap = 10;
  return params.padding + badgeHeight + gap + badgeHeight + params.padding;
}

function buildFooterBadgesSvg(params: {
  width: number;
  y: number;
  padding: number;
  fontSize: number;
  foregroundHex: string;
  backgroundHex: string;
  foregroundText: string;
  backgroundText: string;
}): string {
  const badgeHeight = 28;
  const gap = 10;
  const badgeWidth = Math.min(params.width - params.padding * 2, 180);
  const x = Math.round((params.width - badgeWidth) / 2);
  const rx = 8;

  const fgTextColor = getBadgeTextColor(params.foregroundHex);
  const bgTextColor = getBadgeTextColor(params.backgroundHex);

  const fgY = params.y;
  const bgY = params.y + badgeHeight + gap;

  const fgLabelY = fgY + Math.round(badgeHeight / 2);
  const bgLabelY = bgY + Math.round(badgeHeight / 2);

  const fgText = escapeXml(params.foregroundText);
  const bgText = escapeXml(params.backgroundText);

  return [
    `<rect x="${x}" y="${fgY}" width="${badgeWidth}" height="${badgeHeight}" rx="${rx}" fill="${params.foregroundHex}"/>`,
    `<text x="50%" y="${fgLabelY}" dominant-baseline="middle" text-anchor="middle" font-family="SF Mono, Menlo, Consolas, monospace" font-size="${params.fontSize}" font-weight="600" fill="${fgTextColor}">${fgText}</text>`,
    `<rect x="${x}" y="${bgY}" width="${badgeWidth}" height="${badgeHeight}" rx="${rx}" fill="${params.backgroundHex}"/>`,
    `<text x="50%" y="${bgLabelY}" dominant-baseline="middle" text-anchor="middle" font-family="SF Mono, Menlo, Consolas, monospace" font-size="${params.fontSize}" font-weight="600" fill="${bgTextColor}">${bgText}</text>`,
  ].join("");
}

function getBadgeTextColor(hex: string): string {
  const rgb = parseHexRgb(hex);
  if (!rgb) {
    return "#000";
  }

  const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
  return lum < 0.5 ? "#fff" : "#000";
}

function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const trimmed = hex.trim();
  if (!trimmed.startsWith("#")) {
    return null;
  }

  const raw = trimmed.slice(1);
  if (raw.length === 3) {
    const r = parseInt(raw[0] + raw[0], 16);
    const g = parseInt(raw[1] + raw[1], 16);
    const b = parseInt(raw[2] + raw[2], 16);
    return {
      r,
      g,
      b,
    };
  }

  if (raw.length === 6) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    return {
      r,
      g,
      b,
    };
  }

  return null;
}

function relativeLuminance(r8: number, g8: number, b8: number): number {
  const r = srgbToLinear(r8 / 255);
  const g = srgbToLinear(g8 / 255);
  const b = srgbToLinear(b8 / 255);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
