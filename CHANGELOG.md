# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffolding: `package.json`, `tsconfig.json`, `tsup` dual ESM/CJS
  build, Vitest test setup, and the public `encode`/`decode` API skeleton (with
  stubbed CBOR, Base45, and compression internals pending implementation).
- Implemented the CBOR codec (`encodeCbor`/`decodeCbor`), a minimal RFC 8949
  encoder/decoder covering the JSON data model (`null`, `boolean`, `number`,
  `string`, array, plain object). Throws a clear error on encode for
  unsupported input (`undefined`, `bigint`, functions, symbols,
  `Date`/`Map`/`Set`/other class instances) and on decode for
  unsupported/malformed CBOR (byte strings, tags, indefinite-length items,
  non-string map keys, float16, truncated or trailing data).
- Implemented the Base45 (RFC 9285) codec (`encodeBase45`/`decodeBase45`),
  ported from a proven production implementation to operate on `Uint8Array`
  instead of Node `Buffer`.
- Implemented opportunistic compression (`compress`/`decompress`) using
  `fflate`'s raw-DEFLATE `deflateSync`/`inflateSync`.
- Added `fflate` as the package's sole runtime dependency (pure JS, no
  `Buffer`/DOM dependency, isomorphic across Node and browsers).
- Added unit tests for all three primitives plus end-to-end `encode`/`decode`
  round-trip tests covering compression modes and strict-mode flag handling.

### Changed

- `encode`/`decode` are now fully functional end-to-end (previously threw
  "not implemented" errors).
