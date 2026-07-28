/**
 * Self-describing flag byte prepended to the CBOR payload before Base45 encoding.
 * Bits are additive so a decoder can detect and reject (in strict mode) flags it
 * doesn't recognize, instead of silently misinterpreting the payload.
 *
 * Modeled as a `const` object + derived union (not a TS `enum`) so it stays
 * tree-shakeable and has no runtime footprint beyond a plain object literal.
 */
export const FLAG = {
  NONE: 0b0000_0000,
  COMPRESSED: 0b0000_0001,
} as const;

export type Flag = (typeof FLAG)[keyof typeof FLAG];

/** Bitwise OR of every flag bit this version of the codec understands. */
export const KNOWN_FLAGS: number = Object.values(FLAG).reduce<number>((acc, bit) => acc | bit, 0);
