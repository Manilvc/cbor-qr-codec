import { encodeBase45 } from './codecs/base45.js';
import { encodeCbor } from './codecs/cbor.js';
import { compress } from './codecs/compression.js';
import { FLAG } from './constants/flags.js';
import type { EncodeOptions } from './types.js';

/**
 * Encodes a JSON-compatible value into a QR-safe Base45 string.
 *
 * Pipeline: value -> CBOR bytes -> optional compression -> flag byte -> Base45 text.
 */
export function encode(value: unknown, options: EncodeOptions = {}): string {
  const { compression = 'auto' } = options;
  const cbor = encodeCbor(value);

  let payload = cbor;
  let flag: number = FLAG.NONE;

  if (compression !== 'never') {
    const compressed = compress(cbor);
    if (compression === 'always' || compressed.length < cbor.length) {
      payload = compressed;
      flag = FLAG.COMPRESSED;
    }
  }

  const framed = new Uint8Array(payload.length + 1);
  framed[0] = flag;
  framed.set(payload, 1);

  return encodeBase45(framed);
}
