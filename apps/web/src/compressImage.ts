// Same rules as the mobile app (apps/mobile/lib/attachments/compress-image.ts): long edge capped
// at 2048 px, PNG stays PNG (sharp screenshot text), GIF/SVG pass through, everything else becomes
// JPEG at 0.85. Re-encoding drops EXIF, including photo GPS.
export const MAX_IMAGE_EDGE = 2048;
const JPEG_QUALITY = 0.85;

export interface CompressedImage {
  blob: Blob;
  mime: string;
  filename: string;
}

function renamed(filename: string, mime: string): string {
  const extension = mime === 'image/png' ? '.png' : '.jpg';
  return /\.[^./]+$/.test(filename) ? filename.replace(/\.[^./]+$/, extension) : `${filename}${extension}`;
}

/** Returns a compressed copy, or null when the file should be sent as-is (or cannot be decoded). */
export async function compressImageFile(file: File): Promise<CompressedImage | null> {
  const type = file.type.toLowerCase();
  if (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const mime = type === 'image/png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, JPEG_QUALITY));
    if (!blob) return null;
    // Never make a small file bigger just to re-encode it.
    if (blob.size >= file.size && scale === 1) return null;
    return { blob, mime, filename: renamed(file.name, mime) };
  } catch {
    return null;
  }
}
