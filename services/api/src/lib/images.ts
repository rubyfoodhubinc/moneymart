/**
 * MoneyMart — image input validation.
 *
 * Listing images accepted any string verbatim. Measured before this existed: a
 * script-bearing SVG was stored and served back to every visitor, and a 1.5 MB
 * data URI was accepted and echoed on every read.
 *
 * Being precise about severity, because overstating it would be dishonest: I
 * could not get the SVG payload to EXECUTE. Chrome blocks SVG scripting in
 * `<img>`, `<object>` and `<iframe>`, so this is not a demonstrated XSS. It is
 * unvalidated input — a script payload is stored and redistributed — which is
 * one refactor away from being an XSS the moment anything renders a stored value
 * through `innerHTML`, a CSS `url()`, or a WebView with scripting enabled. The
 * size half is unambiguous: an unbounded data URI inflates the store and every
 * client that renders the lot.
 *
 * Policy:
 *   • **SVG is refused.** It is the one image format that can carry script, and
 *     no legitimate listing photo needs it.
 *   • **Scheme is allowlisted**, not blocklisted. A blocklist of `javascript:`
 *     would miss `vbscript:`, `blob:`, `filesystem:` and whatever comes next.
 *   • **Declared type must match the actual bytes.** A payload claiming
 *     `image/png` while starting with `<svg` is rejected, so the declared MIME
 *     cannot be used to smuggle a document type past the format check.
 *   • **Count and size are bounded**, so one listing cannot inflate the store.
 */
import type { Item } from '@moneymart/types';

/** Twenty photos is the blueprint's ceiling (§5.2). */
export const MAX_IMAGES = 20;
/**
 * Per-image ceiling.
 *
 * Generous enough for a high-resolution photograph as a data URI (a 2 MB JPEG
 * becomes roughly 2.7 MB base64), tight enough that a handful of listings cannot
 * exhaust memory. Real deployments should pre-sign an object-storage upload
 * instead of accepting base64 at all; this bound exists because the API accepts
 * it today.
 */
export const MAX_IMAGE_BYTES = 3_000_000;

/** Formats accepted for listing photography. SVG is deliberately absent. */
const ALLOWED_DATA_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif'];

/** Magic-number prefixes, so the declared type can be checked against reality. */
const MAGIC: { type: string; test: (bytes: Buffer) => boolean }[] = [
  { type: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a' },
  { type: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  {
    type: 'image/avif',
    test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && /avif|avis/.test(b.subarray(8, 12).toString('ascii')),
  },
];

export interface ImageValidationResult {
  ok: boolean;
  /** The accepted, possibly normalised reference. */
  value?: string;
  /** Why it was refused, phrased for a client. */
  reason?: string;
}

/**
 * Detect the true type from the leading bytes.
 * Returns null for anything that is not one of the accepted formats — which is
 * how an SVG dressed as a PNG is caught.
 */
export function sniffImageType(bytes: Buffer): string | null {
  // SVG is text; recognise it explicitly so the refusal can say why.
  const head = bytes.subarray(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || head.startsWith('<?xml')) return 'image/svg+xml';
  for (const entry of MAGIC) {
    if (entry.test(bytes)) return entry.type;
  }
  return null;
}

/** Validate a single image reference. */
export function validateImage(input: unknown): ImageValidationResult {
  if (typeof input !== 'string' || !input.trim()) {
    return { ok: false, reason: 'An image must be a non-empty string.' };
  }
  const value = input.trim();

  if (value.length > MAX_IMAGE_BYTES) {
    return { ok: false, reason: `An image may not exceed ${Math.round(MAX_IMAGE_BYTES / 1_000_000)} MB.` };
  }

  /**
   * Data URI. Parsed by hand rather than with a regex, because a permissive
   * pattern is exactly how a `javascript:` payload slips through.
   */
  if (value.startsWith('data:')) {
    const comma = value.indexOf(',');
    if (comma < 0) return { ok: false, reason: 'A data URI must contain a comma.' };

    const header = value.slice(5, comma);
    const body = value.slice(comma + 1);
    const [type, ...params] = header.split(';');
    const declared = (type ?? '').toLowerCase().trim();
    // `data:,` with an empty type is a valid document — never an image.
    if (!declared) return { ok: false, reason: 'A data URI image must declare a type.' };

    if (declared === 'image/svg+xml') {
      return { ok: false, reason: 'SVG images are not accepted. Upload a PNG, JPEG or WebP instead.' };
    }
    if (!ALLOWED_DATA_TYPES.includes(declared)) {
      return { ok: false, reason: `Unsupported image type: ${declared}.` };
    }

    const isBase64 = params.some((param) => param.trim().toLowerCase() === 'base64');
    let bytes: Buffer;
    if (isBase64) {
      // Reject anything outside the base64 alphabet before decoding, so a
      // malformed payload fails here rather than producing a partial buffer.
      if (!/^[A-Za-z0-9+/=\s]*$/.test(body)) {
        return { ok: false, reason: 'The image data is not valid base64.' };
      }
      bytes = Buffer.from(body, 'base64');
    } else {
      // Percent-encoded (utf8) form; only used for tiny images.
      try {
        bytes = Buffer.from(decodeURIComponent(body), 'utf8');
      } catch {
        return { ok: false, reason: 'The image data is not valid percent-encoding.' };
      }
    }

    if (!bytes.length) return { ok: false, reason: 'The image data is empty.' };
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `An image may not exceed ${Math.round(MAX_IMAGE_BYTES / 1_000_000)} MB.` };
    }

    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      return { ok: false, reason: 'The image data is not a recognised image format.' };
    }
    if (sniffed === 'image/svg+xml') {
      return { ok: false, reason: 'SVG images are not accepted.' };
    }
    // The declared type must match the bytes. This is what stops a payload from
    // claiming an allowed type while carrying something else.
    const normalisedDeclared = declared === 'image/jpg' ? 'image/jpeg' : declared;
    if (sniffed !== normalisedDeclared) {
      return { ok: false, reason: `The image says ${declared} but contains ${sniffed}.` };
    }

    return { ok: true, value };
  }

  /**
   * Remote reference. Only http and https are accepted: the scheme is
   * allowlisted so `javascript:`, `data:` variants, `blob:` and `file:` cannot
   * arrive through this branch.
   */
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'An image must be an https URL or an uploaded image.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, reason: `Unsupported image scheme: ${url.protocol}` };
  }
  return { ok: true, value };
}

/** Validate an array of images, refusing the request rather than silently dropping. */
export function validateImages(input: unknown): { ok: true; values: string[] } | { ok: false; reason: string } {
  if (input === undefined || input === null) return { ok: true, values: [] };
  if (!Array.isArray(input)) return { ok: false, reason: 'images must be an array.' };
  if (input.length > MAX_IMAGES) {
    return { ok: false, reason: `A listing may carry at most ${MAX_IMAGES} images.` };
  }

  const values: string[] = [];
  const seen = new Set<string>();
  for (const [index, candidate] of input.entries()) {
    const result = validateImage(candidate);
    if (!result.ok) {
      // Reported with its position so a client can fix it rather than guess.
      return { ok: false, reason: `Image ${index + 1}: ${result.reason}` };
    }
    // Duplicates waste storage and render identically.
    if (seen.has(result.value!)) continue;
    seen.add(result.value!);
    values.push(result.value!);
  }

  const total = values.reduce((sum, value) => sum + value.length, 0);
  if (total > MAX_IMAGE_BYTES * 4) {
    return { ok: false, reason: 'The combined image payload for a listing is too large.' };
  }

  return { ok: true, values };
}

export const images = {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_DATA_TYPES,
  validateImage,
  validateImages,
  sniffImageType,
};

export default images;
