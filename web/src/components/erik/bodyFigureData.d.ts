// Type surface for the vendored muscle-path data module (bodyFigureData.js).
// The .js carries react-native-body-highlighter (MIT) path data; this declares
// what BodyMap.tsx consumes so the TS editor stays happy (vite build strips types).
export interface MusclePart {
  slug: string;
  color: string;
  path: { left?: string[]; right?: string[]; common?: string[] };
}
export const FRONT: MusclePart[];
export const BACK: MusclePart[];
export const FRONT_BOX: number[];
export const BACK_BOX: number[];
export const FRONT_ADDUCT_BOX: number[];
export const BACK_ADDUCT_BOX: number[];
export function render(stateByArea?: Record<string, string>, opts?: { interactive?: boolean }): string;
