import { useMemo } from "react";
import Color from "colorjs.io";

import { computeApca } from "./contrastMetrics";

import type { ContrastResults, PickedColor } from "./types";

export function useContrastResults(
  foreground: PickedColor | null,
  background: PickedColor | null,
): ContrastResults | null {
  return useMemo(() => {
    if (!foreground || !background) {
      return null;
    }

    const wcagRatio = Color.contrast(background.hex, foreground.hex, "WCAG21");
    const apca = computeApca(foreground.srgb8bit, background.srgb8bit);

    return {
      wcagRatio,
      apca,
    };
  }, [foreground, background]);
}
