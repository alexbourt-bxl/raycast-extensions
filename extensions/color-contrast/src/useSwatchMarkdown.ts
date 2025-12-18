import { useMemo } from "react";
import { environment } from "@raycast/api";

import { buildSwatchMarkdown } from "./swatchMarkdown";
import { normalizeHex6 } from "./colorUtils";

import type { PickedColor } from "./types";

export function useSwatchMarkdown(foreground: PickedColor | null, background: PickedColor | null): string {
  return useMemo(() => {
    const isDark = environment.appearance === "dark";
    const placeholderFg = isDark ? "#b0b0b0" : "#6a6a6a";
    const placeholderBg = isDark ? "#2a2a2a" : "#f2f2f2";

    if (!foreground && !background) {
      const borderColor = isDark ? "#ffffff10" : "#00000010";
      return buildSwatchMarkdown({
        foregroundHex: placeholderFg,
        backgroundHex: placeholderBg,
        label: "Aa",
        size: 140,
        borderColor,
        footerBadges: {
          foregroundHex: placeholderFg,
          backgroundHex: placeholderBg,
          foregroundText: "Pick foreground",
          backgroundText: "Pick background",
        },
        width: 420,
      });
    }

    const borderColor = isDark ? "#ffffff10" : "#00000008";
    const fgHex = foreground ? normalizeHex6(foreground.hex) : placeholderFg;
    const bgHex = background ? normalizeHex6(background.hex) : placeholderBg;

    const fgText = foreground ? `${fgHex}` : "Pick foreground";
    const bgText = background ? `${bgHex}` : "Pick background";

    return buildSwatchMarkdown({
      foregroundHex: fgHex,
      backgroundHex: bgHex,
      label: "Aa",
      size: 140,
      borderColor,
      footerBadges: {
        foregroundHex: fgHex,
        backgroundHex: bgHex,
        foregroundText: fgText,
        backgroundText: bgText,
      },
      width: 420,
    });
  }, [foreground, background]);
}
