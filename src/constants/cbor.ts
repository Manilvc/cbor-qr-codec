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

/**
 * Tag numbers this codec recognizes on a CBOR tag (major type 6) item. Every other tag
 * number is rejected — this is not general tag support, just one internal, private-use
 * construct for {@link STRING_REF} (loosely inspired by, but not equivalent to, the
 * unfinished "CBOR tags for binary rounding and string references" draft; there is no
 * claim of interop with other CBOR implementations).
 */
export const TAG = {
  /** Tags an unsigned integer as an index into this document's string table. */
  STRING_REF: 25,
} as const;
