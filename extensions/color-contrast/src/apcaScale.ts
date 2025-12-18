export type ApcaScaleWord = "fail" | "discernible" | "minimum" | "large text" | "other text" | "body text" | "all text";

export type ApcaScaleColorKey = "red" | "orange" | "yellow" | "green" | "blue" | "purple";

export function getApcaScaleWord(absLc: number): ApcaScaleWord {
  if (absLc < 15) {
    return "fail";
  }

  if (absLc >= 90) {
    return "all text";
  }

  if (absLc >= 75) {
    return "body text";
  }

  if (absLc >= 60) {
    return "other text";
  }

  if (absLc >= 45) {
    return "large text";
  }

  if (absLc >= 30) {
    return "minimum";
  }

  return "discernible";
}

export function getApcaScaleColorKey(absLc: number): ApcaScaleColorKey {
  if (absLc >= 90) {
    return "purple";
  }

  if (absLc >= 75) {
    return "blue";
  }

  if (absLc >= 60) {
    return "green";
  }

  if (absLc >= 45) {
    return "yellow";
  }

  if (absLc >= 30) {
    return "orange";
  }

  return "red";
}
