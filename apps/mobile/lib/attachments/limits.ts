export const MOBILE_ATTACHMENT_LIMIT_BYTES = 10 * 1024 * 1024;
// Photos are compressed before upload (lib/attachments/compress-image.ts), so a larger original
// is accepted at pick time; the 10 MB limit still applies to what is actually sent.
export const MOBILE_IMAGE_SOURCE_LIMIT_BYTES = 50 * 1024 * 1024;

export function attachmentPickLimitBytes(mime: string | null | undefined): number {
  return mime?.toLowerCase().startsWith('image/') ? MOBILE_IMAGE_SOURCE_LIMIT_BYTES : MOBILE_ATTACHMENT_LIMIT_BYTES;
}
