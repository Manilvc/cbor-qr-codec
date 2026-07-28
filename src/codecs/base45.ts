import { CHARSET } from '../constants/base45.js';

const CHAR_TO_VALUE = new Map<string, number>();
for (let i = 0; i < CHARSET.length; i++) {
  CHAR_TO_VALUE.set(CHARSET.charAt(i), i);
}

/**
 * Encodes raw bytes to a Base45 (RFC 9285) string.
 */
export function encodeBase45(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let out = '';
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    let n = view.getUint16(i, false); // big-endian: bytes[i] * 256 + bytes[i + 1]
    const c = n % 45;
    n = Math.floor(n / 45);
    const d = n % 45;
    n = Math.floor(n / 45);
    const e = n;
    out += CHARSET.charAt(c) + CHARSET.charAt(d) + CHARSET.charAt(e);
  }
  if (i < bytes.length) {
    const n = view.getUint8(i);
    out += CHARSET.charAt(n % 45) + CHARSET.charAt(Math.floor(n / 45));
  }
  return out;
}

/**
 * Decodes a Base45 (RFC 9285) string back to raw bytes.
 *
 * @throws If `text` contains characters outside the Base45 charset, or its
 * length/values are otherwise inconsistent with a valid Base45 encoding.
 */
export function decodeBase45(text: string): Uint8Array {
  const out: number[] = [];
  let i = 0;
  for (; text.length - i >= 3; i += 3) {
    const c = charValue(text, i);
    const d = charValue(text, i + 1);
    const e = charValue(text, i + 2);
    const n = c + d * 45 + e * 45 * 45;
    if (n > 0xffff) {
      throw new Error(`cbor-qr-codec: invalid Base45 string - value ${n} exceeds 16 bits at position ${i}`);
    }
    out.push(Math.floor(n / 256), n % 256);
  }
  const remaining = text.length - i;
  if (remaining === 2) {
    const c = charValue(text, i);
    const d = charValue(text, i + 1);
    const n = c + d * 45;
    if (n > 0xff) {
      throw new Error(`cbor-qr-codec: invalid Base45 string - trailing value ${n} exceeds 8 bits`);
    }
    out.push(n);
  } else if (remaining !== 0) {
    throw new Error('cbor-qr-codec: invalid Base45 string - unexpected trailing length');
  }
  return Uint8Array.from(out);
}

function charValue(text: string, index: number): number {
  const ch = text.charAt(index);
  const value = CHAR_TO_VALUE.get(ch);
  if (value === undefined) {
    throw new Error(`cbor-qr-codec: invalid Base45 string - unrecognized character "${ch}" at position ${index}`);
  }
  return value;
}
