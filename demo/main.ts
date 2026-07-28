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

// Holds the Base45 text currently rendered as the QR code, so Decode can
// read back the exact payload without re-parsing it out of the canvas image.
let lastEncoded = '';

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
    const text = encode(value, {
      compression: compression.value as 'auto' | 'always' | 'never',
    });
    await QRCode.toCanvas(qrcode, text, { margin: 1, width: 320 });
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
    decoded.textContent = JSON.stringify(value, null, 2);
  } catch (err) {
    decoded.textContent = '';
    showError(err);
  }
});
