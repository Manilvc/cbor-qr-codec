/**
 * Minimal RFC 8949 CBOR codec covering exactly the JSON data model: `null`,
 * `boolean`, `number`, `string`, arrays, and plain objects with string keys.
 * There is no support for CBOR byte strings, tags, indefinite-length items,
 * or non-string map keys — this codec is intentionally scoped to values that
 * originated as JSON-compatible data, not arbitrary CBOR.
 */

import { MAJOR, SIMPLE } from '../constants/cbor.js';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

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
  encodeValue(bytes, value);
  return Uint8Array.from(bytes);
}

/**
 * Decodes CBOR-encoded bytes (RFC 8949) back to a JSON-compatible value.
 *
 * @throws If `bytes` is empty, truncated, has trailing data after a complete
 * value, or contains a CBOR construct this codec doesn't support (byte
 * strings, tags, indefinite-length items, non-string map keys, float16,
 * invalid UTF-8, or an integer exceeding `Number.MAX_SAFE_INTEGER`).
 */
export function decodeCbor<T = unknown>(bytes: Uint8Array): T {
  if (bytes.length === 0) {
    throw new Error('cbor-qr-codec: cannot decode empty CBOR data');
  }
  const reader = new CborReader(bytes);
  const value = decodeValue(reader);
  if (reader.position !== bytes.length) {
    throw new Error('cbor-qr-codec: trailing bytes after CBOR value');
  }
  return value as T;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function encodeValue(bytes: number[], value: unknown): void {
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
    encodeString(bytes, value as string);
    return;
  }
  if (Array.isArray(value)) {
    encodeArray(bytes, value);
    return;
  }
  if (type === 'object') {
    encodeMap(bytes, value as object);
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

function encodeString(bytes: number[], value: string): void {
  const utf8 = textEncoder.encode(value);
  writeHead(bytes, MAJOR.TEXT_STRING, BigInt(utf8.length));
  for (const byte of utf8) bytes.push(byte);
}

function encodeArray(bytes: number[], value: unknown[]): void {
  writeHead(bytes, MAJOR.ARRAY, BigInt(value.length));
  for (let i = 0; i < value.length; i++) {
    encodeValue(bytes, value[i]);
  }
}

function encodeMap(bytes: number[], value: object): void {
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
    encodeString(bytes, key);
    encodeValue(bytes, obj[key]);
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

function decodeValue(reader: CborReader): unknown {
  const { majorType, info, raw } = reader.readHead();
  switch (majorType) {
    case MAJOR.UNSIGNED_INT:
      return toSafeNumber(raw);
    case MAJOR.NEGATIVE_INT:
      return -1 - toSafeNumber(raw);
    case MAJOR.BYTE_STRING:
      throw new Error('cbor-qr-codec: CBOR byte strings (major type 2) are not supported');
    case MAJOR.TEXT_STRING:
      return decodeUtf8(reader.readBytes(toSafeNumber(raw)));
    case MAJOR.ARRAY:
      return decodeArray(reader, toSafeNumber(raw));
    case MAJOR.MAP:
      return decodeMap(reader, toSafeNumber(raw));
    case MAJOR.TAG:
      throw new Error('cbor-qr-codec: CBOR tags (major type 6) are not supported');
    case MAJOR.SIMPLE_OR_FLOAT:
      return decodeSimpleOrFloat(info, raw);
    default:
      throw new Error(`cbor-qr-codec: unsupported CBOR major type (${majorType})`);
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return textDecoder.decode(bytes);
  } catch (error) {
    throw new Error(`cbor-qr-codec: invalid UTF-8 in CBOR text string (${error instanceof Error ? error.message : String(error)})`);
  }
}

function decodeArray(reader: CborReader, length: number): unknown[] {
  const result: unknown[] = [];
  for (let i = 0; i < length; i++) {
    result.push(decodeValue(reader));
  }
  return result;
}

function decodeMap(reader: CborReader, length: number): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (let i = 0; i < length; i++) {
    const key = decodeValue(reader);
    if (typeof key !== 'string') {
      throw new Error('cbor-qr-codec: CBOR map keys must be text strings');
    }
    result[key] = decodeValue(reader);
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
