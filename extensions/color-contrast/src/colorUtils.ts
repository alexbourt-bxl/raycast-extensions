export function normalizeHex6(hex: string): string {
  const trimmed = hex.trim();
  if (trimmed.length === 4 && trimmed.startsWith("#")) {
    const r = trimmed[1];
    const g = trimmed[2];
    const b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  return trimmed.toUpperCase();
}
