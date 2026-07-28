import { describe, expect, it } from 'vitest';
import { decodeBase45, encodeBase45 } from './codecs/base45.js';
import { decode, encode } from './index.js';
import { FLAG } from './constants/flags.js';

const jsonLdFixture = {
  '@context': [
    'https://www.w3.org/ns/credentials/v2',
    'https://w3id.org/everycred/v1',
    'https://www.w3.org/2018/credentials/examples/v1',
  ],
  type: ['VerifiableCredential', 'EveryCREDCredential'],
  issuer: {
    id: 'did:evrc:issuer:polygon_amoy:f6a8018f-ad86-4be4-8615-5783cd15dff2',
    profile: 'https://staging-fractal.everycred.com/media/issuer/profile_link/441/did:evrc:issuer:polygon_amoy:f6a8018f-ad86-4be4-8615-5783cd15dff2.json',
  },
  issuanceDate: '2026-06-26T10:02:25Z',
  validFrom: '2026-06-26T10:02:20Z',
  id: 'urn:uuid:aaf33f83-862f-44ee-81ec-b50463a2e9d7',
  holder: {
    id: 'did:evrc:holder:c38e2c94-8bde-4b7b-8933-996a02f94edd',
    profile: 'https://staging-fractal.everycred.com/holder/profiles/did:evrc:holder:c38e2c94-8bde-4b7b-8933-996a02f94edd.json',
  },
  credentialSubject: {
    id: 'did:evrc:subject:f6797bc3-6bc8-4a0b-883b-549b528fc790',
    profile: 'https://staging-fractal.everycred.com/media/subject/profile_link/441/did:evrc:subject:f6797bc3-6bc8-4a0b-883b-549b528fc790.json',
    subjectMetaData: {
      name: 'Nikhil Sonawane',
      email: 'nikhil.sonawane@viitor.cloud',
      employees_id: 'VCEID-11111-1468114',
      designation: 'QA Engineer',
      personal_email_id: 'sonawanenikhil2805@gmail.com',
      personal_contact_number: '8788270435',
      joining_date: '2026-06-26',
      expiry_date: '2028-06-26T10:01:59Z',
      company_url: 'https://viitorcloud.com/',
      address: 'Ahmedabad, Gujarat'
    }
  },
  proof: {
    type: 'DataIntegrityProof',
    cryptosuite: 'Ed25519Signature2020',
    created: '2026-06-26T10:02:26.917943',
    proofPurpose: 'assertionMethod',
    verificationMethod: 'did:evrc:issuer:polygon_amoy:f6a8018f-ad86-4be4-8615-5783cd15dff2#qripMkR2QeI1Iqf44H4JR+eCIEhe5stidmg4F7cO2MI=',
    merkleProof: {
      type: 'MerkleProof2019',
      path: [],
      merkleRoot: 'ee11fca38fab8b57b97845a8a9b69eb04e4a7f0d91668ff089f3db809993aa1d',
      targetHash: 'ee11fca38fab8b57b97845a8a9b69eb04e4a7f0d91668ff089f3db809993aa1d',
      anchors: ['blink:poly:amoy:0x011f27d6aa9b12e231592b4502a5a81d9ec34892df2e4416cd0ec51b4dcf9bbe'],
    },
    proofValue: 'iQ9ypVmsyy9ZOcnsRwP5/pTgqmzvJentDC/TriQj9G9Qj0U6PpYf730VKzgbwnB/WUEqdnmOPr/01Yyxp8UUBA==',
  },
};

describe('cbor-qr-codec public API', () => {
  it('exposes encode and decode as functions', () => {
    expect(typeof encode).toBe('function');
    expect(typeof decode).toBe('function');
  });

  it.each([
    ['flat object', { id: 42, name: 'Ada' }],
    ['array of objects', [{ a: 1 }, { b: 2 }]],
    ['unicode strings', { text: 'héllo 🎉 world' }],
    ['large and negative numbers', { big: Number.MAX_SAFE_INTEGER, small: Number.MIN_SAFE_INTEGER, neg: -3.14 }],
    ['nested/mixed types', { a: [1, 'two', { three: [true, false, null] }] }],
    ['JSON-LD credential', jsonLdFixture],
  ])('round-trips: %s', (_label, value) => {
    expect(decode(encode(value))).toEqual(value);
  });

  it('decodes with compression "never" and sets the NONE flag', () => {
    const text = encode({ hello: 'world' }, { compression: 'never' });
    const framed = decodeBase45(text);
    expect(framed[0]).toBe(FLAG.NONE);
    expect(decode(text)).toEqual({ hello: 'world' });
  });

  it('decodes with compression "always" and sets the COMPRESSED flag even for tiny payloads', () => {
    const text = encode({ a: 1 }, { compression: 'always' });
    const framed = decodeBase45(text);
    expect(framed[0]).toBe(FLAG.COMPRESSED);
    expect(decode(text)).toEqual({ a: 1 });
  });

  it('with compression "auto" (default), only compresses when it shrinks the payload', () => {
    const tiny = encode({ a: 1 });
    expect(decodeBase45(tiny)[0]).toBe(FLAG.NONE);

    const large = encode({ text: 'abcabcabcabc'.repeat(200) });
    expect(decodeBase45(large)[0]).toBe(FLAG.COMPRESSED);
  });

  it('throws on unrecognized flag bits in strict mode (default)', () => {
    const text = encode({ a: 1 }, { compression: 'never' });
    const framed = decodeBase45(text);
    const tampered = Uint8Array.from(framed);
    tampered[0] = (tampered[0] as number) | 0b1000_0000; // set an unused high bit
    const tamperedText = encodeBase45(tampered);

    expect(() => decode(tamperedText)).toThrow(/unrecognized flag bits/);
  });

  it('ignores unrecognized flag bits when strict is false', () => {
    const text = encode({ a: 1 }, { compression: 'never' });
    const framed = decodeBase45(text);
    const tampered = Uint8Array.from(framed);
    tampered[0] = (tampered[0] as number) | 0b1000_0000;
    const tamperedText = encodeBase45(tampered);

    expect(decode(tamperedText, { strict: false })).toEqual({ a: 1 });
  });

  it('throws on an empty payload', () => {
    expect(() => decode(encodeBase45(new Uint8Array(0)))).toThrow(/empty payload/);
  });

  it('throws on invalid Base45 text', () => {
    expect(() => decode('!!!')).toThrow();
  });
});
