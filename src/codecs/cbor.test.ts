import { describe, expect, it } from 'vitest';
import { decodeCbor, encodeCbor } from './cbor.js';

function roundTrip(value: unknown): unknown {
  return decodeCbor(encodeCbor(value));
}

describe('encodeCbor / decodeCbor - round trip', () => {
  it('round-trips primitives', () => {
    expect(roundTrip(null)).toBe(null);
    expect(roundTrip(true)).toBe(true);
    expect(roundTrip(false)).toBe(false);
  });

  it('round-trips -0 as +0 (matches JSON.stringify\'s loss of sign)', () => {
    expect(roundTrip(-0)).toBe(0);
    expect(Object.is(roundTrip(-0), -0)).toBe(false);
  });

  it.each([0, 1, -1, 42, -42, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 255, 256, 65535, 65536])(
    'round-trips the safe integer %i',
    (value) => {
      expect(roundTrip(value)).toBe(value);
    },
  );

  it.each([3.14, -2.5, 0.1, 1e300, -1e-300])('round-trips the float %p', (value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it('round-trips NaN', () => {
    expect(Number.isNaN(roundTrip(NaN) as number)).toBe(true);
  });

  it.each([Infinity, -Infinity])('round-trips %p', (value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it.each(['', 'hello', 'héllo 🎉', 'a'.repeat(500)])('round-trips the string %p', (value) => {
    expect(roundTrip(value)).toBe(value);
  });

  it('round-trips empty and nested arrays/objects', () => {
    expect(roundTrip([])).toEqual([]);
    expect(roundTrip({})).toEqual({});
    expect(roundTrip([1, 'two', [3, 4], { five: 5 }, null, true])).toEqual([1, 'two', [3, 4], { five: 5 }, null, true]);
  });

  it('round-trips a deeply nested structure', () => {
    let value: unknown = { leaf: true };
    for (let i = 0; i < 50; i++) {
      value = { child: value, index: i };
    }
    expect(roundTrip(value)).toEqual(value);
  });

  it('round-trips a JSON-LD-shaped document', () => {
    const doc = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
      id: 'urn:uuid:1234',
      type: ['VerifiableCredential', 'ExampleCredential'],
      issuer: 'did:example:issuer',
      credentialSubject: {
        id: 'did:example:subject',
        name: 'Ada Lovelace',
        age: 36,
        verified: true,
        scores: [1, 2.5, -3],
        metadata: null,
      },
    };
    expect(roundTrip(doc)).toEqual(doc);
  });
});

describe('encodeCbor - unsupported input', () => {
  it.each([
    ['top-level undefined', undefined],
    ['a function', () => {}],
    ['a symbol', Symbol('x')],
    ['a bigint', 123n],
    ['a Date', new Date()],
    ['a Map', new Map()],
    ['a Set', new Set()],
  ])('throws on %s', (_label, value) => {
    expect(() => encodeCbor(value)).toThrow();
  });

  it('throws on undefined inside an object value', () => {
    expect(() => encodeCbor({ a: undefined })).toThrow();
  });

  it('throws on undefined inside an array element', () => {
    expect(() => encodeCbor([1, undefined, 3])).toThrow();
  });

  it('throws on a sparse array hole', () => {
    // eslint-disable-next-line no-sparse-arrays
    expect(() => encodeCbor([1, , 3])).toThrow();
  });
});

describe('decodeCbor - malformed/unsupported input', () => {
  it('throws on empty input', () => {
    expect(() => decodeCbor(new Uint8Array(0))).toThrow(/empty/);
  });

  it('throws on truncated input', () => {
    // Head for a text string of length 5, but no bytes follow.
    expect(() => decodeCbor(Uint8Array.from([0x65]))).toThrow(/unexpected end/);
  });

  it('throws on trailing bytes after a complete value', () => {
    const value = encodeCbor(1);
    const withTrailingGarbage = Uint8Array.from([...value, 0xff]);
    expect(() => decodeCbor(withTrailingGarbage)).toThrow(/trailing bytes/);
  });

  it('throws on a CBOR byte string (major type 2)', () => {
    expect(() => decodeCbor(Uint8Array.from([0x41, 0x00]))).toThrow(/byte strings/);
  });

  it('throws on a CBOR tag (major type 6)', () => {
    expect(() => decodeCbor(Uint8Array.from([0xc0, 0x00]))).toThrow(/tags/);
  });

  it('throws on an indefinite-length array', () => {
    expect(() => decodeCbor(Uint8Array.from([0x9f, 0xff]))).toThrow(/indefinite-length/);
  });

  it('throws on a reserved additional-info value', () => {
    expect(() => decodeCbor(Uint8Array.from([0x1c]))).toThrow(/reserved/);
  });

  it('throws on a map with a non-string key', () => {
    // Map of length 1 (0xa1), key = unsigned int 1 (0x01), value = unsigned int 2 (0x02).
    expect(() => decodeCbor(Uint8Array.from([0xa1, 0x01, 0x02]))).toThrow(/must be text strings/);
  });

  it('throws on CBOR undefined (0xf7)', () => {
    expect(() => decodeCbor(Uint8Array.from([0xf7]))).toThrow(/undefined/);
  });

  it('throws on a float16 value (0xf9)', () => {
    expect(() => decodeCbor(Uint8Array.from([0xf9, 0x00, 0x00]))).toThrow(/float16/);
  });

  it('throws on an integer exceeding the safe range', () => {
    // Unsigned int (major type 0, info 27) with an 8-byte argument of 2^63 - 1.
    expect(() => decodeCbor(Uint8Array.from([0x1b, 0x7f, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow(
      /exceeds safely representable range/,
    );
  });

  it('throws on invalid UTF-8 inside a text string', () => {
    // Text string of length 1 (0x61) containing an invalid UTF-8 continuation byte (0x80).
    expect(() => decodeCbor(Uint8Array.from([0x61, 0x80]))).toThrow(/invalid UTF-8/);
  });
});
