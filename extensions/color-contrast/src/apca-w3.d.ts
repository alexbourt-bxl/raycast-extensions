declare module "apca-w3" {
  export function APCAcontrast(txtY: number, bgY: number, places?: number): number;

  export function sRGBtoY(rgb?: readonly [number, number, number]): number;
}
