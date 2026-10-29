import { parse as parseMrzLib } from "mrz";
import { DOCUMENT_LAYOUT, MRZ_CHAR_HEIGHT_MM } from "../config.js";
import type { DocumentType, ResolvedConfig } from "../types.js";

/**
 * Pure parts of the MRZ branch (thesis 3.2.4, fig. 3.2): strip geometry,
 * grayscale + Otsu binarisation, and parsing/validation with the `mrz` lib.
 */

export type MrzFormat = "TD1" | "TD3";

export const EXPECTED_FORMAT: Record<DocumentType, MrzFormat> = { dni: "TD1", passport: "TD3" };

const FORMAT_SHAPE: Record<MrzFormat, { lines: number; length: number }> = {
  TD1: { lines: 3, length: 30 },
  TD3: { lines: 2, length: 44 },
};

export interface StripGeometry {
  /** Source rows of the bottom strip. */
  sy: number;
  sh: number;
  /** Estimated character height in the source image, in pixels. */
  charHeight: number;
  /** Resize factor applied before binarisation. */
  scale: number;
}

/**
 * The guide frame places the document edge-to-edge in the image, so the MRZ
 * lies in a bottom band of known physical height. The character height is
 * estimated from the strip height (OCR-B size 1 is ~2.4 mm tall in a band of
 * `stripMm`), then the strip is resized so characters land in the configured
 * range — up for small captures, down for very large ones.
 */
export function stripGeometry(
  imageHeight: number,
  docType: DocumentType,
  doc: Pick<ResolvedConfig["document"], "mrzCharHeightMin" | "mrzCharHeightMax">
): StripGeometry {
  const layout = DOCUMENT_LAYOUT[docType];
  const sh = Math.max(1, Math.round((imageHeight * layout.stripMm) / layout.heightMm));
  const charHeight = (sh * MRZ_CHAR_HEIGHT_MM) / layout.stripMm;
  const inRange = charHeight >= doc.mrzCharHeightMin && charHeight <= doc.mrzCharHeightMax;
  const target = (doc.mrzCharHeightMin + doc.mrzCharHeightMax) / 2;
  return { sy: imageHeight - sh, sh, charHeight, scale: inRange ? 1 : target / charHeight };
}

/** Luma (BT.601) of an RGBA buffer. */
export function toGray(rgba: Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    out[j] = Math.round(0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]);
  }
  return out;
}

/** Otsu's threshold: maximises the between-class variance. */
export function otsuThreshold(gray: Uint8Array | Uint8ClampedArray): number {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = -1, threshold = 0;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += i * hist[i];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > max) {
      max = between;
      threshold = i;
    }
  }
  return threshold;
}

/**
 * Splits OCR output into MRZ lines: strips whitespace, identifies the format
 * from line count and length (TD1 = 3 × 30, TD3 = 2 × 44), keeps the last
 * qualifying lines (the MRZ is the bottom of the strip) and trims them to the
 * exact length.
 */
export function extractMrzLines(text: string): { format: MrzFormat; lines: string[] } | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s+/g, ""))
    .filter((l) => l.length > 0);
  for (const format of ["TD3", "TD1"] as const) {
    const shape = FORMAT_SHAPE[format];
    const long = lines.filter((l) => l.length >= shape.length);
    if (long.length >= shape.lines) {
      return { format, lines: long.slice(-shape.lines).map((l) => l.slice(0, shape.length)) };
    }
  }
  return null;
}

const REQUIRED_CHECK_DIGITS = [
  "documentNumberCheckDigit",
  "birthDateCheckDigit",
  "expirationDateCheckDigit",
  "compositeCheckDigit",
] as const;

/**
 * Parses with `mrz` (autocorrect on: fixes O/0, I/1… by field type) and
 * accepts only if the format matches the document type and EVERY check digit
 * is valid, including the composite one. The extracted fields are returned
 * for the caller to validate and then discard; they never leave the SDK.
 */
export function parseMrz(
  text: string,
  docType: DocumentType
): { format: MrzFormat; fields: Record<string, string | null | undefined> } | null {
  const found = extractMrzLines(text);
  if (!found || found.format !== EXPECTED_FORMAT[docType]) return null;
  let result: ReturnType<typeof parseMrzLib>;
  try {
    result = parseMrzLib(found.lines, { autocorrect: true });
  } catch {
    return null;
  }
  if (result.format !== found.format) return null;
  const checkDigits = result.details.filter((d) => d.field?.endsWith("CheckDigit"));
  const present = new Set(checkDigits.map((d) => d.field));
  if (!REQUIRED_CHECK_DIGITS.every((f) => present.has(f))) return null;
  if (!checkDigits.every((d) => d.valid)) return null;
  return { format: found.format, fields: result.fields };
}
