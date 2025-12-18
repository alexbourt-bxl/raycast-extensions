export type PickedColor = {
  input: string;
  hex: string;
  srgb8bit: readonly [number, number, number];
};

export type ContrastResults = {
  wcagRatio: number;
  apca: number;
};

export type PixelPickResult = {
  foreground: {
    x: number;
    y: number;
    hex: string;
  };
  background: {
    x: number;
    y: number;
    hex: string;
  };
};

export type TagItem = {
  key: string;
  text: string;
  color?: string;
};

type PickedPixelData = {
  x: number;
  y: number;
  hex: string;
};

function isPickedPixelData(value: unknown): value is PickedPixelData {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return typeof obj.x === "number" && typeof obj.y === "number" && typeof obj.hex === "string";
}

export function isPixelPickResult(value: unknown): value is PixelPickResult {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  return isPickedPixelData(obj.foreground) && isPickedPixelData(obj.background);
}

export function isPartialPixelPickResult(value: unknown): value is Partial<PixelPickResult> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  const hasForeground = obj.foreground === undefined || isPickedPixelData(obj.foreground);
  const hasBackground = obj.background === undefined || isPickedPixelData(obj.background);

  return hasForeground && hasBackground;
}
