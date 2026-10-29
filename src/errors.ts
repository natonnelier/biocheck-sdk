import type { BiocheckErrorCode } from "./types.js";

/** Rejection reason of `verify` for failures that are not decisions. */
export class BiocheckError extends Error {
  readonly code: BiocheckErrorCode;

  constructor(code: BiocheckErrorCode, message: string = code) {
    super(message);
    this.name = "BiocheckError";
    this.code = code;
  }
}
