import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './base45.js';

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 37 + 11) % 256);
}

describe('encodeBase45 / decodeBase45', () => {
  it('round-trips an empty buffer', () => {
    const bytes = new Uint8Array(0);
    expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
  });

  it.each([1, 2, 3, 5, 7, 16, 100])('round-trips a %i-byte buffer', (length) => {
    const bytes = deterministicBytes(length);
    expect(decodeBase45(encodeBase45(bytes))).toEqual(bytes);
  });

  it('encodes the RFC 9285 example ("AB" -> "BB8")', () => {
    expect(encodeBase45(new TextEncoder().encode('AB'))).toBe('BB8');
  });

  it('decodes an empty string to an empty buffer', () => {
    expect(decodeBase45('')).toEqual(new Uint8Array(0));
  });

  it('throws on an unrecognized character', () => {
    expect(() => decodeBase45('ab')).toThrow(/unrecognized character/);
  });

  it('throws when a 3-char group exceeds 16 bits', () => {
    // 'Z' = 44, so "ZZZ" decodes to 44 + 44*45 + 44*45*45 = 91124, which is > 0xffff.
    expect(() => decodeBase45('ZZZ')).toThrow(/exceeds 16 bits/);
  });

  it('throws when a trailing 2-char group exceeds 8 bits', () => {
    // 'Z' = 44, so "ZZ" decodes to 44 + 44*45 = 2024, which is > 0xff.
    expect(() => decodeBase45('ZZ')).toThrow(/exceeds 8 bits/);
  });

  it('throws on an unexpected trailing length', () => {
    expect(() => decodeBase45('A')).toThrow(/unexpected trailing length/);
    expect(() => decodeBase45('AAAA')).toThrow(/unexpected trailing length/);
  });
});
