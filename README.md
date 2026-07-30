# cbor-qr-codec

Bidirectional codec for encoding JSON documents to QR-safe CBOR and decoding them back — CBOR encoding, opportunistic compression, and Base45 (RFC 9285) text encoding with a self-describing flag byte, so payloads survive lossy UTF-8 decoding by mobile QR scanners (ML Kit, Vision).

This package only produces/consumes the Base45 *text* payload — it does not
render or scan QR images. Feed the string returned by `encode()` into
whatever QR-rendering library fits your platform (e.g. `qrcode` on Node/web,
a native library on mobile), and pass whatever text your QR scanner reads
back into `decode()`.

## Install

```sh
npm install cbor-qr-codec
```

## Usage

```ts
import { encode, decode } from 'cbor-qr-codec';

const text = encode({ id: 42, name: 'Ada' });
// -> QR-safe Base45 string, ready to render as a QR code

const value = decode<{ id: number; name: string }>(text);
// -> { id: 42, name: 'Ada' }
```

## Implementing it: generating and reading an actual QR code

`encode()`/`decode()` only handle the text payload — pairing them with a QR
library looks like this (using [`qrcode`](https://www.npmjs.com/package/qrcode),
the same one the `demo/` playground uses):

```ts
import QRCode from 'qrcode';
import { encode, decode } from 'cbor-qr-codec';

// --- Generate ---
const text = encode({ id: 42, name: 'Ada' });
await QRCode.toCanvas(document.querySelector('canvas'), text, {
  errorCorrectionLevel: 'M', // see "QR code capacity" below before changing this
  margin: 1,
  width: 320,
});

// --- Read back (after your scanner reads `text` off the rendered QR) ---
const value = decode<{ id: number; name: string }>(text);
```

On Node, swap `QRCode.toCanvas` for `QRCode.toFile`/`QRCode.toDataURL`; on
mobile, feed `text` into your platform's native QR encoder instead — the
Base45 string is the only thing that has to cross that boundary.

### QR code capacity

A QR code has a hard ceiling on how much text it can hold, and no encoding
option in this package can raise it — only the actual data size can. The
maximum, in alphanumeric mode (what Base45 output uses) at version 40 (the
largest QR size), per error-correction level:

| Level | Max characters | Damage resilience |
| ----- | --------------: | ------------------ |
| L     | 4,296            | ~7%                 |
| M (`qrcode`'s default) | 3,391 | ~15%          |
| Q     | 2,420            | ~25%                |
| H     | 1,852            | ~30%                |

Check `text.length` against the level you're using *before* calling into
your QR library, and fail with a clear message instead of letting an
oversized payload throw the library's raw error:

```ts
const MAX_CHARS_BY_LEVEL = { L: 4296, M: 3391, Q: 2420, H: 1852 } as const;
const level = 'M';

if (text.length > MAX_CHARS_BY_LEVEL[level]) {
  throw new Error(
    `Payload too large for a single QR code (${text.length} chars, max ${MAX_CHARS_BY_LEVEL[level]} at level ${level}).`,
  );
}
```

If your payload doesn't fit, the options are: reduce the source data (drop
fields recoverable from other fields already in the payload — e.g. this
package's `encode()` already dedupes repeated string values/keys for you),
lower the error-correction level for more headroom, or split the encoded
text across multiple QR codes and reassemble it before calling `decode()`.
See `demo/main.ts` for a worked single-QR-with-size-check example.

## API

### `encode(value: unknown, options?: EncodeOptions): string`

Encodes a JSON-compatible value into a QR-safe Base45 string.

Pipeline: value → CBOR bytes → optional compression → flag byte → Base45 text.

| Option        | Type                              | Default  | Description                                          |
| ------------- | ---------------------------------- | -------- | ----------------------------------------------------- |
| `compression` | `'auto' \| 'always' \| 'never'`     | `'auto'` | `'auto'` compresses only when it shrinks the payload. |

`value` must be JSON-compatible: `null`, `boolean`, `number`, `string`,
arrays, and plain objects with string keys. Unlike `JSON.stringify`,
`encode()` never silently drops or coerces unsupported values — it throws on
`undefined` (including inside objects/arrays), `bigint`, functions, symbols,
and non-plain objects (`Date`, `Map`, `Set`, class instances).

### `decode<T = unknown>(text: string, options?: DecodeOptions): T`

Decodes a QR-safe Base45 string produced by `encode` back into its original value.

| Option   | Type      | Default | Description                                                     |
| -------- | --------- | ------- | ----------------------------------------------------------------- |
| `strict` | `boolean` | `true`  | Throw if the flag byte declares an unrecognized codec feature.    |

## Development

```sh
npm install        # install dependencies
npm run typecheck  # tsc --noEmit
npm test           # run the Vitest suite
npm run build      # emit dist/ (ESM + CJS + .d.ts) via tsup
npm run dev        # tsup in watch mode
```

## Publishing (maintainers)

1. Bump `"version"` in `package.json` (semver: patch for fixes, minor for
   backward-compatible additions, major for breaking changes to the public
   `encode`/`decode` API or the wire format).
2. Commit the version bump along with the change it ships, and push it:
   ```sh
   git add <changed files>
   git commit -m "..."
   git push origin <branch>
   ```
3. Log in to npm if you haven't already on this machine (interactive; can't
   be scripted):
   ```sh
   npm login
   npm whoami   # confirm you're authenticated as the right account
   ```
4. Publish. `prepublishOnly` already runs `typecheck` + `test` + `build`
   automatically, so a broken or unbuilt package can't ship:
   ```sh
   npm publish
   ```
5. Tag the release in git so the npm version and the commit it came from
   stay traceable:
   ```sh
   git tag v<version>
   git push origin v<version>
   ```

## Runtime support

Targets Node.js ≥ 18 and modern browsers — the core has no `Buffer` or DOM
dependency, relying only on `Uint8Array`/`TextEncoder`/`TextDecoder`. The
package's sole runtime dependency, [`fflate`](https://github.com/101arrowz/fflate),
is itself pure JavaScript with no `Buffer`/DOM dependency, so this guarantee
holds transitively — the whole pipeline runs identically offline in Node, in
a browser, or in an embedded JS runtime with no network access.

## License

[MIT](./LICENSE)

