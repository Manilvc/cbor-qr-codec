/**
 * Options controlling how a JSON-compatible value is encoded to a QR-safe string.
 */
export interface EncodeOptions {
  /**
   * Controls opportunistic compression before Base45 encoding.
   * - 'auto' (default): compress only when it reduces the final payload size.
   * - 'always': always compress, even if it doesn't shrink the payload.
   * - 'never': never compress.
   */
  compression?: 'auto' | 'always' | 'never';
}

/**
 * Options controlling how a QR-safe string is decoded back to a JSON-compatible value.
 */
export interface DecodeOptions {
  /**
   * When true (default), throws if the flag byte declares a codec feature this
   * version doesn't recognize, instead of silently ignoring it.
   */
  strict?: boolean;
}
