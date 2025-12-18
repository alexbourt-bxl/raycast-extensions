import { APCAcontrast, sRGBtoY } from "apca-w3";

export function computeApca(
  foregroundRgb8bit: readonly [number, number, number],
  backgroundRgb8bit: readonly [number, number, number],
): number {
  const txtY = sRGBtoY([foregroundRgb8bit[0], foregroundRgb8bit[1], foregroundRgb8bit[2]]);
  const bgY = sRGBtoY([backgroundRgb8bit[0], backgroundRgb8bit[1], backgroundRgb8bit[2]]);

  return APCAcontrast(txtY, bgY);
}

export function formatWcagRatio(ratio: number): string {
  const rounded = Math.round(ratio * 100) / 100;
  return rounded.toFixed(2).replace(/\.00$/, "");
}

export function summarizeWcag(ratio: number): {
  summary: string;
  details: string;
} {
  const aaNormal = ratio >= 4.5;
  const aaaNormal = ratio >= 7.0;
  const aaLarge = ratio >= 3.0;
  const aaaLarge = ratio >= 4.5;

  const summary = aaaNormal ? "AAA (normal)" : aaNormal ? "AA (normal)" : aaLarge ? "AA (large)" : "Fail";

  const details = [
    `AA normal: **${aaNormal ? "Pass" : "Fail"}**  ·  AAA normal: **${aaaNormal ? "Pass" : "Fail"}**`,
    `AA large: **${aaLarge ? "Pass" : "Fail"}**  ·  AAA large: **${aaaLarge ? "Pass" : "Fail"}**`,
  ].join("\n");

  return {
    summary,
    details,
  };
}

export function summarizeApca(lc: number): {
  rating: string;
  details: string;
} {
  const polarity = lc >= 0 ? "Dark text on light background (BoW)" : "Light text on dark background (WoB)";
  const rating = rateApca(Math.abs(lc));

  return {
    rating,
    details: `Polarity: ${polarity}`,
  };
}

function rateApca(absLc: number): string {
  if (absLc >= 90) {
    return "Very high";
  }

  if (absLc >= 75) {
    return "High";
  }

  if (absLc >= 60) {
    return "Good (typical body text)";
  }

  if (absLc >= 45) {
    return "Moderate (large text / UI)";
  }

  return "Low";
}
