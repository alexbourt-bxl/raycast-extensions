import { useMemo } from "react";

import { parsePickedColor } from "./color";

import type { PickedColor } from "./types";

export function useColorParsing(hex: string): PickedColor | null {
  return useMemo(() => {
    const trimmed = hex.trim();
    if (!trimmed) {
      return null;
    }

    try {
      return parsePickedColor(trimmed);
    } catch {
      return null;
    }
  }, [hex]);
}
