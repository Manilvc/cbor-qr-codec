/**
 * Minimal RFC 8949 CBOR codec covering exactly the JSON data model: `null`,
 * `boolean`, `number`, `string`, arrays, and plain objects with string keys.
 * There is no support for CBOR byte strings, indefinite-length items, or
 * non-string map keys — this codec is intentionally scoped to values that
 * originated as JSON-compatible data, not arbitrary CBOR. The one exception is
 * a private-use tag (see {@link TAG.STRING_REF}) this codec emits itself to
 * deduplicate repeated string values/keys; every other tag is still rejected.
 */

import { MAJOR, SIMPLE, TAG } from '../constants/cbor.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

// Strings shorter than this never enter the dedup table: a back-reference costs at
// least 3 bytes (2-byte tag head + >=1-byte index), so deduping anything shorter can
// only ever add overhead, never remove it.
const MIN_DEDUPE_LENGTH = 8;

// Scratch buffer for packing/unpacking multi-byte big-endian integers and
// IEEE754 floats. Every use fully drains it (write then immediately read, or
// vice versa) before any nested call can run, so sharing one instance across
// calls is safe despite recursion through encodeValue/decodeValue.
const scratch8 = new DataView(new ArrayBuffer(8));

/**
 * Encodes an arbitrary JSON-compatible value to CBOR-encoded bytes (RFC 8949).
 *
 * @throws If `value` (or anything nested inside it) is `undefined`, a
 * `bigint`, a `function`, a `symbol`, or a non-plain object (e.g. `Date`,
 * `Map`, `Set`, a class instance) — unlike `JSON.stringify`, these are never
 * silently dropped or coerced.
 */
export function encodeCbor(value: unknown): Uint8Array {
  const bytes: number[] = [];
  encodeValue(bytes, value, new Map());
  return Uint8Array.from(bytes);
}

/**
 * Decodes CBOR-encoded bytes (RFC 8949) back to a JSON-compatible value.
 *
 * @throws If `bytes` is empty, truncated, has trailing data after a complete
 * value, or contains a CBOR construct this codec doesn't support (byte
 * strings, any tag other than its own {@link TAG.STRING_REF}, indefinite-length
 * items, non-string map keys, float16, invalid UTF-8, or an integer exceeding
 * `Number.MAX_SAFE_INTEGER`).
 */
export function decodeCbor<T = unknown>(bytes: Uint8Array): T {
  if (bytes.length === 0) {
    throw new Error('cbor-qr-codec: cannot decode empty CBOR data');
  }
  const reader = new CborReader(bytes);
  const value = decodeValue(reader, []);
  if (reader.position !== bytes.length) {
    throw new Error('cbor-qr-codec: trailing bytes after CBOR value');
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function encodeValue(bytes: number[], value: unknown, table: Map<string, number>): void {
  if (value === null) {
    bytes.push((MAJOR.SIMPLE_OR_FLOAT << 5) | SIMPLE.NULL);
    return;
  }
  if (value === true) {
    bytes.push((MAJOR.SIMPLE_OR_FLOAT << 5) | SIMPLE.TRUE);
    return;
  }
  if (value === false) {
    bytes.push((MAJOR.SIMPLE_OR_FLOAT << 5) | SIMPLE.FALSE);
    return;
  }

  const type = typeof value;
  if (type === 'number') {
    encodeNumber(bytes, value as number);
    return;
  }
  if (type === 'string') {
    encodeString(bytes, value as string, table);
    return;
  }
  if (Array.isArray(value)) {
    encodeArray(bytes, value, table);
    return;
  }
  if (type === 'object') {
    encodeMap(bytes, value as object, table);
    return;
  }

  // undefined, bigint, function, symbol
  throw new Error(`cbor-qr-codec: cannot encode value of type "${type}"`);
}

function encodeNumber(bytes: number[], value: number): void {
  if (Number.isSafeInteger(value)) {
    if (value >= 0) {
      writeHead(bytes, MAJOR.UNSIGNED_INT, BigInt(value));
    } else {
      writeHead(bytes, MAJOR.NEGATIVE_INT, BigInt(-1 - value));
    }
    return;
  }

  // Non-integer, NaN, ±Infinity, or an integer magnitude beyond the safe
  // range: encode as a float64 bit pattern, which round-trips all of these
  // exactly via DataView.
  bytes.push((MAJOR.SIMPLE_OR_FLOAT << 5) | SIMPLE.FLOAT64);
  scratch8.setFloat64(0, value, false);
  for (let i = 0; i < 8; i++) bytes.push(scratch8.getUint8(i));
}

/**
 * Encodes a string, transparently replacing repeat occurrences of the same
 * value (once it's reached {@link MIN_DEDUPE_LENGTH}) with a compact
 * {@link TAG.STRING_REF} back-reference into `table` instead of re-emitting
 * the literal bytes. `table` is shared for the whole document (keys and
 * values alike), populated in the exact traversal order {@link decodeValue}
 * replays, so encode/decode indices always line up.
 */
function encodeString(bytes: number[], value: string, table: Map<string, number>): void {
  if (value.length >= MIN_DEDUPE_LENGTH) {
    const existingIndex = table.get(value);
    if (existingIndex !== undefined) {
      writeHead(bytes, MAJOR.TAG, BigInt(TAG.STRING_REF));
      writeHead(bytes, MAJOR.UNSIGNED_INT, BigInt(existingIndex));
      return;
    }
    table.set(value, table.size);
  }

  const utf8 = textEncoder.encode(value);
  writeHead(bytes, MAJOR.TEXT_STRING, BigInt(utf8.length));
  for (const byte of utf8) bytes.push(byte);
}

function encodeArray(bytes: number[], value: unknown[], table: Map<string, number>): void {
  writeHead(bytes, MAJOR.ARRAY, BigInt(value.length));
  for (let i = 0; i < value.length; i++) {
    encodeValue(bytes, value[i], table);
  }
}

function encodeMap(bytes: number[], value: object, table: Map<string, number>): void {
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const ctorName = (value as { constructor?: { name?: string } }).constructor?.name ?? 'unknown';
    throw new Error(
      `cbor-qr-codec: cannot encode object of type "${ctorName}" (only plain objects, arrays, and primitives are supported)`,
    );
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  writeHead(bytes, MAJOR.MAP, BigInt(keys.length));
  for (const key of keys) {
    encodeString(bytes, key, table);
    encodeValue(bytes, obj[key], table);
  }
}

/** Writes a CBOR head (major type + minimal-width argument) per RFC 8949 §3. */
function writeHead(bytes: number[], majorType: number, argument: bigint): void {
  const mt = majorType << 5;
  if (argument < 24n) {
    bytes.push(mt | Number(argument));
  } else if (argument <= 0xffn) {
    bytes.push(mt | 24, Number(argument));
  } else if (argument <= 0xffffn) {
    scratch8.setUint16(0, Number(argument), false);
    bytes.push(mt | 25, scratch8.getUint8(0), scratch8.getUint8(1));
  } else if (argument <= 0xffffffffn) {
    scratch8.setUint32(0, Number(argument), false);
    bytes.push(mt | 26, scratch8.getUint8(0), scratch8.getUint8(1), scratch8.getUint8(2), scratch8.getUint8(3));
  } else {
    scratch8.setBigUint64(0, argument, false);
    bytes.push(mt | 27);
    for (let i = 0; i < 8; i++) bytes.push(scratch8.getUint8(i));
  }
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

interface CborHead {
  majorType: number;
  info: number;
  /** The additional-info bytes, as a raw, unvalidated bit pattern. */
  raw: bigint;
}

class CborReader {
  private pos = 0;
  private readonly view: DataView;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get position(): number {
    return this.pos;
  }

  readBytes(n: number): Uint8Array {
    this.ensure(n);
    const slice = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return slice;
  }

  readHead(): CborHead {
    this.ensure(1);
    const initial = this.view.getUint8(this.pos);
    this.pos += 1;
    const majorType = initial >> 5;
    const info = initial & 0x1f;

    if (info < 24) return { majorType, info, raw: BigInt(info) };
    if (info === 24) {
      this.ensure(1);
      const v = this.view.getUint8(this.pos);
      this.pos += 1;
      return { majorType, info, raw: BigInt(v) };
    }
    if (info === 25) {
      this.ensure(2);
      const v = this.view.getUint16(this.pos, false);
      this.pos += 2;
      return { majorType, info, raw: BigInt(v) };
    }
    if (info === 26) {
      this.ensure(4);
      const v = this.view.getUint32(this.pos, false);
      this.pos += 4;
      return { majorType, info, raw: BigInt(v) };
    }
    if (info === 27) {
      this.ensure(8);
      const v = this.view.getBigUint64(this.pos, false);
      this.pos += 8;
      return { majorType, info, raw: v };
    }
    if (info === 31) {
      throw new Error('cbor-qr-codec: indefinite-length items are not supported');
    }
    throw new Error(`cbor-qr-codec: reserved CBOR additional information value (${info})`);
  }

  private ensure(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new Error('cbor-qr-codec: unexpected end of CBOR data');
    }
  }
}

/**
 * `table` mirrors the encoder's dedup table: every literal text string at or
 * above {@link MIN_DEDUPE_LENGTH} is appended here in the same order the
 * encoder assigned indices, so a {@link TAG.STRING_REF} can look its value
 * back up by index.
 */
function decodeValue(reader: CborReader, table: string[]): unknown {
  const { majorType, info, raw } = reader.readHead();
  switch (majorType) {
    case MAJOR.UNSIGNED_INT:
      return toSafeNumber(raw);
    case MAJOR.NEGATIVE_INT:
      return -1 - toSafeNumber(raw);
    case MAJOR.BYTE_STRING:
      throw new Error('cbor-qr-codec: CBOR byte strings (major type 2) are not supported');
    case MAJOR.TEXT_STRING: {
      const value = decodeUtf8(reader.readBytes(toSafeNumber(raw)));
      if (value.length >= MIN_DEDUPE_LENGTH) table.push(value);
      return value;
    }
    case MAJOR.ARRAY:
      return decodeArray(reader, toSafeNumber(raw), table);
    case MAJOR.MAP:
      return decodeMap(reader, toSafeNumber(raw), table);
    case MAJOR.TAG:
      return decodeTag(reader, raw, table);
    case MAJOR.SIMPLE_OR_FLOAT:
      return decodeSimpleOrFloat(info, raw);
    default:
      throw new Error(`cbor-qr-codec: unsupported CBOR major type (${majorType})`);
  }
}

function decodeTag(reader: CborReader, tagNumber: bigint, table: string[]): string {
  if (tagNumber !== BigInt(TAG.STRING_REF)) {
    throw new Error(`cbor-qr-codec: CBOR tags (major type 6) are not supported (tag ${tagNumber})`);
  }
  const inner = reader.readHead();
  if (inner.majorType !== MAJOR.UNSIGNED_INT) {
    throw new Error('cbor-qr-codec: a string-reference tag must wrap an unsigned integer');
  }
  const index = toSafeNumber(inner.raw);
  const value = table[index];
  if (value === undefined) {
    throw new Error(`cbor-qr-codec: string reference index ${index} is out of range`);
  }
  return value;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch (error) {
    throw new Error(`cbor-qr-codec: invalid UTF-8 in CBOR text string (${error instanceof Error ? error.message : String(error)})`);
  }
}

function decodeArray(reader: CborReader, length: number, table: string[]): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    result.push(decodeValue(reader, table));
  }
  return result;
}

function decodeMap(reader: CborReader, length: number, table: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < length; i++) {
    const key = decodeValue(reader, table);
    if (typeof key !== 'string') {
      throw new Error('cbor-qr-codec: CBOR map keys must be text strings');
    }
    result[key] = decodeValue(reader, table);
  }
  return result;
}

function decodeSimpleOrFloat(info: number, raw: bigint): unknown {
  switch (info) {
    case SIMPLE.FALSE:
      return false;
    case SIMPLE.TRUE:
      return true;
    case SIMPLE.NULL:
      return null;
    case SIMPLE.UNDEFINED:
      throw new Error('cbor-qr-codec: CBOR "undefined" is not supported');
    case SIMPLE.FLOAT16:
      throw new Error('cbor-qr-codec: half-precision floats (float16) are not supported');
    case SIMPLE.FLOAT32:
      scratch8.setUint32(0, Number(raw), false);
      return scratch8.getFloat32(0, false);
    case SIMPLE.FLOAT64:
      scratch8.setBigUint64(0, raw, false);
      return scratch8.getFloat64(0, false);
    default:
      throw new Error(`cbor-qr-codec: unsupported CBOR simple value (${info})`);
  }
}

function toSafeNumber(raw: bigint): number {
  if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`cbor-qr-codec: integer ${raw} exceeds safely representable range`);
  }
  return Number(raw);
}
