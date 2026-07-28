import { describe, expect, it } from 'vitest';
import { compress, decompress } from './compression.js';

describe('compress / decompress', () => {
  it('round-trips an empty buffer', () => {
    const bytes = new Uint8Array(0);
    expect(decompress(compress(bytes))).toEqual(bytes);
  });

  it('round-trips a small payload', () => {
    const bytes = new TextEncoder().encode('hello');
    expect(decompress(compress(bytes))).toEqual(bytes);
  });

  it('shrinks a large, repetitive payload', () => {
    const bytes = new TextEncoder().encode('a'.repeat(10_000));
    const compressed = compress(bytes);
    expect(compressed.length).toBeLessThan(bytes.length);
    expect(decompress(compressed)).toEqual(bytes);
  });

  it('still round-trips a low-compressibility payload', () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => (i * 97 + 13) % 256);
    expect(decompress(compress(bytes))).toEqual(bytes);
  });

  it('wraps decompress errors on corrupted input', () => {
    const garbage = Uint8Array.from([0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => decompress(garbage)).toThrow(/cbor-qr-codec: failed to decompress payload/);
  });
});
