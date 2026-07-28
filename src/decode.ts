import { decodeBase45 } from './codecs/base45.js';
import { decodeCbor } from './codecs/cbor.js';
import { decompress } from './codecs/compression.js';
import { FLAG, KNOWN_FLAGS } from './constants/flags.js';
import type { DecodeOptions } from './types.js';

/**
 * Decodes a QR-safe Base45 string produced by {@link encode} back into its
 * original value.
 *
 * @typeParam T - The caller-asserted shape of the decoded value. Defaults to
 * `unknown` since the codec cannot verify the original value's shape at runtime.
 */
export function decode<T = unknown>(text: string, options: DecodeOptions = {}): T {
  const { strict = true } = options;
  const framed = decodeBase45(text);

  if (framed.length === 0) {
    throw new Error('cbor-qr-codec: empty payload');
  }

  const flag = framed[0] as number;
  const payload = framed.subarray(1);

  if (strict && (flag & ~KNOWN_FLAGS) !== 0) {
    throw new Error(`cbor-qr-codec: unrecognized flag bits (0x${flag.toString(16)})`);
  }

  const cbor = (flag & FLAG.COMPRESSED) !== 0 ? decompress(payload) : payload;
  return decodeCbor<T>(cbor);
}
