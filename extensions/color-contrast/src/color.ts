import Color from "colorjs.io";

import type { PickedColor } from "./types";

export function parsePickedColor(input: string): PickedColor {
  const color = new Color(input).to("srgb");
  const srgb = color.srgb;
  const srgb8bit = [
    clamp8bit(Math.round(srgb[0] * 255)),
    clamp8bit(Math.round(srgb[1] * 255)),
    clamp8bit(Math.round(srgb[2] * 255)),
  ] as const;

  return {
    input,
    hex: color
      .toString({
        format: "hex",
      })
      .toUpperCase(),
    srgb8bit,
  };
}

function clamp8bit(value: number): number {
  return Math.max(0, Math.min(255, value));
}
