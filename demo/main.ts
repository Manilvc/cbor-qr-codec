import QRCode from 'qrcode';
import { decode, encode } from '../src/index.js';

const input = document.querySelector<HTMLTextAreaElement>('#input')!;
const compression = document.querySelector<HTMLSelectElement>('#compression')!;
const strict = document.querySelector<HTMLInputElement>('#strict')!;
const qrcode = document.querySelector<HTMLCanvasElement>('#qrcode')!;
const encodedMeta = document.querySelector<HTMLSpanElement>('#encodedMeta')!;
const decoded = document.querySelector<HTMLDivElement>('#decoded')!;
const errorBox = document.querySelector<HTMLDivElement>('#error')!;
const encodeButton = document.querySelector<HTMLButtonElement>('#encode')!;
const decodeButton = document.querySelector<HTMLButtonElement>('#decode')!;

const ERROR_CORRECTION_LEVEL = 'L';
// Max alphanumeric-mode characters a single QR code can hold at version 40 (the largest
// size), per error-correction level. Base45 output only uses QR alphanumeric-safe characters,
// so this is the real ceiling — no encoding option can raise it further.
const MAX_CHARS_BY_LEVEL: Record<string, number> = { L: 4296, M: 3391, Q: 2420, H: 1852 };

// Holds the Base45 text currently rendered as the QR code, so Decode can
// read back the exact payload without re-parsing it out of the canvas image.
let lastEncoded = '';

// --- SD-JWT credential-shape dedup (demo-only; deliberately NOT part of the generic
// codec in src/, since it depends on knowing this specific credential/DID shape) ---
//
// Two fields in this shape are fully recoverable from `credential.credential` (the
// compact SD-JWT string), so stripping them before encode() shrinks the QR payload
// with no data loss:
//  - `credential.disclosures` duplicates the disclosure strings the SD-JWT already
//    appends to `credential.credential` after each "~".
//  - `config.offlinePublicKey[].publicKey`'s base64 body duplicates the RSA key
//    material embedded in the JWT's own `kid` header claim (as `did:...#<PEM>`).
// Both are verified to reconstruct byte-for-byte before being stripped, so this never
// produces a lossy round-trip even if a real credential's formatting differs from what's
// assumed here (e.g. the sample credential's `offlinePublicKey` PEM header is missing a
// dash compared to the one embedded in `kid` — this keeps that quirk intact by storing
// each entry's own header/footer text and re-inserting only the verified-identical body).

interface PemParts {
  header: string;
  body: string;
  footer: string;
}

// Cheap in-place stand-in for `credential.disclosures` once it's verified reconstructible.
// Chosen to be unmistakably not a real disclosures array/string, so restore's check is safe.
const DISCLOSURES_PLACEHOLDER = '$derivedFromCredential' as const;

function base64UrlDecode(input: string): string {
  const padded = input + '='.repeat((4 - (input.length % 4)) % 4);
  return atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
}

function extractJwtDisclosures(jwtWithDisclosures: string): string[] {
  return jwtWithDisclosures.split('~').slice(1);
}

/** Pulls the PEM public key embedded in the JWT header's `kid` claim (as `did:...#<PEM>`), if any. */
function extractKidPem(jwtWithDisclosures: string): string | undefined {
  const jwt = jwtWithDisclosures.split('~')[0];
  const headerB64 = jwt.split('.')[0];
  try {
    const header = JSON.parse(base64UrlDecode(headerB64)) as { kid?: unknown };
    if (typeof header.kid !== 'string') return undefined;
    const hashIndex = header.kid.indexOf('#');
    if (hashIndex === -1) return undefined;
    return header.kid.slice(hashIndex + 1).replace(/\\n/g, '\n');
  } catch {
    return undefined;
  }
}

/** Splits a PEM string into its header line, base64 body (newlines stripped), and footer line. */
function splitPem(pem: string): PemParts | undefined {
  const match = /^(-+BEGIN [^-\n]+-+\n)([\s\S]*?)\n?(-+END [^-\n]+-+)$/.exec(pem);
  if (!match) return undefined;
  const [, header, body, footer] = match;
  return { header, body: body.replace(/\n/g, ''), footer };
}

/** Marker left in place of a `publicKey` string once its body has been verified-and-elided. */
interface DerivedPemMarker {
  $derivedFromKid: true;
  header: string;
  footer: string;
}

/**
 * Strips `credential.disclosures` and the base64 body of each `config.offlinePublicKey[]`
 * entry, but only when each is verified to exactly reconstruct from `credential.credential`
 * — so a payload that doesn't match this shape, or whose data doesn't actually line up
 * (e.g. a differently-keyed offline key), passes through untouched instead of corrupting.
 */
function stripRedundantCredentialFields(value: unknown): unknown {
  const jwtWithDisclosures = (value as { credential?: { credential?: unknown } })?.credential?.credential;
  if (typeof jwtWithDisclosures !== 'string') return value;

  const clone = structuredClone(value) as {
    credential: { disclosures?: unknown };
    config?: { offlinePublicKey?: Array<{ publicKey?: unknown }> };
  };

  const disclosures = clone.credential.disclosures;
  if (Array.isArray(disclosures)) {
    const reconstructed = extractJwtDisclosures(jwtWithDisclosures);
    if (JSON.stringify(reconstructed) === JSON.stringify(disclosures)) {
      // Overwrite in place rather than `delete` -- deleting and later reassigning this
      // key would move it to the end of the object's key order on restore, so the
      // "restored" value would differ from the original by key order alone.
      clone.credential.disclosures = DISCLOSURES_PLACEHOLDER;
    }
  }

  const offlineKeys = clone.config?.offlinePublicKey;
  if (Array.isArray(offlineKeys)) {
    const kidParts = extractKidPem(jwtWithDisclosures);
    const kid = kidParts ? splitPem(kidParts) : undefined;
    if (kid) {
      for (const entry of offlineKeys) {
        const parts = typeof entry.publicKey === 'string' ? splitPem(entry.publicKey) : undefined;
        if (parts && parts.body === kid.body) {
          const marker: DerivedPemMarker = { $derivedFromKid: true, header: parts.header, footer: parts.footer };
          entry.publicKey = marker;
        }
      }
    }
  }

  return clone;
}

/** Reverses {@link stripRedundantCredentialFields}. A no-op on anything it didn't touch. */
function restoreRedundantCredentialFields(value: unknown): unknown {
  const jwtWithDisclosures = (value as { credential?: { credential?: unknown } })?.credential?.credential;
  if (typeof jwtWithDisclosures !== 'string') return value;

  const clone = structuredClone(value) as {
    credential: { disclosures?: unknown };
    config?: { offlinePublicKey?: Array<{ publicKey?: unknown }> };
  };

  if (clone.credential.disclosures === DISCLOSURES_PLACEHOLDER) {
    clone.credential.disclosures = extractJwtDisclosures(jwtWithDisclosures);
  }

  const offlineKeys = clone.config?.offlinePublicKey;
  if (Array.isArray(offlineKeys)) {
    const kidPem = extractKidPem(jwtWithDisclosures);
    const kid = kidPem ? splitPem(kidPem) : undefined;
    if (kid) {
      for (const entry of offlineKeys) {
        const marker = entry.publicKey as Partial<DerivedPemMarker> | undefined;
        if (marker && marker.$derivedFromKid) {
          entry.publicKey = `${marker.header}${kid.body}\n${marker.footer}`;
        }
      }
    }
  }

  return clone;
}

function showError(err: unknown): void {
  errorBox.textContent = err instanceof Error ? err.message : String(err);
}

function clearError(): void {
  errorBox.textContent = '';
}

function clearQr(): void {
  const ctx = qrcode.getContext('2d');
  ctx?.clearRect(0, 0, qrcode.width, qrcode.height);
  lastEncoded = '';
}

encodeButton.addEventListener('click', async () => {
  clearError();
  try {
    const value: unknown = JSON.parse(input.value);
    const strippedValue = stripRedundantCredentialFields(value);
    const text = encode(strippedValue, {
      compression: compression.value as 'auto' | 'always' | 'never',
    });

    const maxChars = MAX_CHARS_BY_LEVEL[ERROR_CORRECTION_LEVEL];
    if (text.length > maxChars) {
      throw new Error(
        `Payload too large for a single QR code (${text.length} chars, max ${maxChars} at error-correction level ${ERROR_CORRECTION_LEVEL}). Reduce the data size to fit.`,
      );
    }

    await QRCode.toCanvas(qrcode, text, {
      errorCorrectionLevel: ERROR_CORRECTION_LEVEL,
      margin: 1,
      width: 320,
    });
    lastEncoded = text;
    encodedMeta.textContent = `${text.length} characters`;
  } catch (err) {
    clearQr();
    encodedMeta.textContent = '';
    showError(err);
  }
});

decodeButton.addEventListener('click', () => {
  clearError();
  try {
    if (!lastEncoded) {
      throw new Error('Nothing to decode yet — encode a value first.');
    }
    const value = decode(lastEncoded, { strict: strict.checked });
    const restoredValue = restoreRedundantCredentialFields(value);
    decoded.textContent = JSON.stringify(restoredValue, null, 2);
  } catch (err) {
    decoded.textContent = '';
    showError(err);
  }
});
