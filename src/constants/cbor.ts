/** CBOR major types (RFC 8949 §3.1). */
export const MAJOR = {
  UNSIGNED_INT: 0,
  NEGATIVE_INT: 1,
  BYTE_STRING: 2,
  TEXT_STRING: 3,
  ARRAY: 4,
  MAP: 5,
  TAG: 6,
  SIMPLE_OR_FLOAT: 7,
} as const;

/** CBOR major-type-7 simple values and float-width markers (RFC 8949 §3.3). */
export const SIMPLE = {
  FALSE: 20,
  TRUE: 21,
  NULL: 22,
  UNDEFINED: 23,
  FLOAT16: 25,
  FLOAT32: 26,
  FLOAT64: 27,
} as const;
