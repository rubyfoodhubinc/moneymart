/**
 * MoneyMart mobile — turning a picked photograph into something the API accepts.
 *
 * This logic was written twice, once in the sell screen and once in the account
 * setup screen, and it is the part of photo capture that actually breaks. The bugs
 * are not in opening the picker; they are here:
 *
 *   • the picker reports a MIME type that does not match the bytes, and the API
 *     refuses a mismatch outright (`The image says image/png but contains image/jpeg`)
 *   • `image/jpg` is reported as often as `image/jpeg`, and the validator treats
 *     only the latter as canonical
 *   • base64 inflates a payload by about a third, so a file under the 3 MB ceiling
 *     can still exceed it once encoded
 *
 * Extracted so it can be tested against the real API without a device, because the
 * alternative is finding out on a phone after a store build.
 */

/**
 * Ceiling per image, in ENCODED characters.
 *
 * This is the API's own limit. It checks `value.length` on the submitted string —
 * the whole data URI — before decoding anything, so a client that measures RAW
 * bytes is measuring a smaller number and will happily send a photograph the server
 * then refuses. An earlier version of this module made exactly that mistake: a
 * 2.4 MB image is comfortably under 3 MB as bytes and 3.2 MB once base64 has added
 * its third, so it was accepted locally and rejected on the wire.
 */
export const MAX_IMAGE_BYTES = 3_000_000;

/**
 * The largest payload that survives encoding under the ceiling.
 *
 * Base64 is 4 characters per 3 bytes, plus a short `data:image/...;base64,` prefix,
 * so the usable raw budget is about three quarters of the limit.
 */
export function maxRawBytes(prefixLength = 32): number {
  return Math.floor(((MAX_IMAGE_BYTES - prefixLength) * 3) / 4);
}

/** The types the API's byte-sniffing validator accepts as canonical. */
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedMime = (typeof ALLOWED_MIME)[number];

/** The subset of an Expo picker asset this module needs. */
export interface PickedAsset {
  base64?: string | null;
  mimeType?: string | null;
  uri?: string | null;
}

export interface PreparedImage {
  ok: true;
  /** A data URI the API will accept, or a plain URI to pass through. */
  value: string;
  bytes: number;
}

export interface PrepareFailure {
  ok: false;
  /** Phrased for the user, because it is shown directly. */
  reason: string;
}

/**
 * Normalise a declared MIME type to the canonical spelling.
 *
 * `image/jpg` is not a registered type; it is what several pickers report for a
 * JPEG, and the API's magic-byte sniff returns `image/jpeg`, so passing it through
 * unchanged fails the declared-versus-actual check.
 */
export function canonicalMime(declared: string | null | undefined): AllowedMime {
  const value = (declared ?? '').toLowerCase().trim();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  if ((ALLOWED_MIME as readonly string[]).includes(value)) return value as AllowedMime;
  /**
   * An unknown type falls back to JPEG rather than being passed through: a wrong
   * guess is caught by the byte sniff, while an unsupported declared type is
   * refused before the bytes are even considered.
   */
  return 'image/jpeg';
}

/** Base64 length for a payload of `bytes` raw bytes, including padding. */
export function base64Length(bytes: number): number {
  return Math.ceil(bytes / 3) * 4;
}

/**
 * Prepare a picked asset for upload.
 *
 * Returns the encoded value and the RAW byte count, so a caller can apply the
 * ceiling to the same number the API does rather than to the inflated string.
 */
export function prepareImage(asset: PickedAsset | null | undefined): PreparedImage | PrepareFailure {
  if (!asset) return { ok: false, reason: 'No image was selected.' };

  /**
   * A picker on some platforms returns only a file URI. Passing it through is
   * correct: the API accepts an http(s) reference, and inventing a data URI from a
   * path we cannot read would be worse than forwarding it.
   */
  if (!asset.base64) {
    const uri = (asset.uri ?? '').trim();
    if (/^https?:\/\//.test(uri)) return { ok: true, value: uri, bytes: 0 };
    return {
      ok: false,
      reason: 'That image could not be read. Please choose another.',
    };
  }

  // Strip whitespace and any data-URI prefix a picker may already have applied.
  const base64 = asset.base64.replace(/^data:[^,]+,/, '').replace(/\s/g, '');
  if (!base64) return { ok: false, reason: 'That image could not be read. Please choose another.' };

  const mime = canonicalMime(asset.mimeType);
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes === 0) return { ok: false, reason: 'That image appears to be empty.' };

  const value = `data:${mime};base64,${base64}`;

  /**
   * Measured on the ENCODED value, because that is what the server measures. The
   * message reports the raw size, which is the number the user recognises from
   * their photo library.
   */
  if (value.length > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      reason: `That photo is about ${(bytes / 1_000_000).toFixed(1)} MB, over the ${MAX_IMAGE_BYTES / 1_000_000} MB limit once encoded. Try a smaller one or lower the resolution.`,
    };
  }

  return { ok: true, value, bytes };
}

/**
 * Guard the count, not just the size.
 *
 * The API accepts twenty images per listing; the screens must not invite a
 * twenty-first only for the request to be refused.
 */
export function canAddImage(currentCount: number, max = 20): boolean {
  return currentCount < max;
}

export const mobileImages = { prepareImage, canonicalMime, base64Length, canAddImage, MAX_IMAGE_BYTES };
export default mobileImages;
