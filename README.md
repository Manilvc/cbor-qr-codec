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

## Runtime support

Targets Node.js ≥ 18 and modern browsers — the core has no `Buffer` or DOM
dependency, relying only on `Uint8Array`/`TextEncoder`/`TextDecoder`. The
package's sole runtime dependency, [`fflate`](https://github.com/101arrowz/fflate),
is itself pure JavaScript with no `Buffer`/DOM dependency, so this guarantee
holds transitively — the whole pipeline runs identically offline in Node, in
a browser, or in an embedded JS runtime with no network access.

## License

[MIT](./LICENSE)

