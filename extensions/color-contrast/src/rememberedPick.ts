import { LocalStorage } from "@raycast/api";

import type { PixelPickResult } from "./types";

const key = "rememberedPick";

export async function loadRememberedPick(): Promise<PixelPickResult | null> {
  const raw = await LocalStorage.getItem<string>(key);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as PixelPickResult;
  } catch {
    return null;
  }
}

export async function saveRememberedPick(value: PixelPickResult): Promise<void> {
  await LocalStorage.setItem(key, JSON.stringify(value));
}

export async function clearRememberedPick(): Promise<void> {
  await LocalStorage.removeItem(key);
}
