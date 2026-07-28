import { deflateSync, inflateSync } from 'fflate';
import { COMPRESSION_LEVEL } from '../constants/compression.js';

/**
 * Opportunistically compresses bytes using raw DEFLATE (RFC 1951, no
 * zlib/gzip wrapper) via `fflate`. Synchronous so {@link encode} can stay
 * synchronous too.
 */
export function compress(bytes: Uint8Array): Uint8Array {
  try {
    return deflateSync(bytes, { level: COMPRESSION_LEVEL });
  } catch (error) {
    throw new Error(`cbor-qr-codec: failed to compress payload (${error instanceof Error ? error.message : String(error)})`);
  }
}

/**
 * Decompresses bytes previously produced by {@link compress}.
 */
export function decompress(bytes: Uint8Array): Uint8Array {
  try {
    return inflateSync(bytes);
  } catch (error) {
    throw new Error(`cbor-qr-codec: failed to decompress payload (${error instanceof Error ? error.message : String(error)})`);
  }
}
