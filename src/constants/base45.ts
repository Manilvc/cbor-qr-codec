/**
 * Base45 (RFC 9285) charset — also QR's "alphanumeric mode" charset, so text
 * encoded with it packs into a QR code more densely than base64 would,
 * despite producing more characters per input byte. It's also a pure
 * ASCII/UTF-8 subset, so it survives the lossy UTF-8 decode mobile QR
 * scanners apply to scanned content.
 */
export const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
