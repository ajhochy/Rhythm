import { Image } from 'react-native';

// Images are compressed on the phone before upload: it saves the cellular upload, and the Mac
// stores the result as a media artifact that transcripts reference (never inline in chat).
export const MAX_IMAGE_EDGE = 2048;
export const JPEG_QUALITY = 0.85;

export interface CompressionPlan {
  width: number;
  height: number;
  format: 'jpeg' | 'png';
}

/**
 * PNG stays PNG (screenshots keep sharp text); GIF passes through (animation); every other
 * image becomes JPEG. Re-encoding also drops EXIF, including photo GPS. HEIC becomes JPEG,
 * which every model provider accepts.
 */
export function planImageCompression(mime: string, width: number, height: number): CompressionPlan | null {
  const type = mime.toLowerCase();
  if (!type.startsWith('image/') || type === 'image/gif' || type === 'image/svg+xml') return null;
  if (!(width > 0 && height > 0)) return null;
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
    format: type === 'image/png' ? 'png' : 'jpeg',
  };
}

export interface CompressedImage {
  uri: string;
  mime: string;
  filename?: string;
}

function renamed(filename: string | undefined, format: CompressionPlan['format']): string | undefined {
  if (!filename) return filename;
  const extension = format === 'png' ? '.png' : '.jpg';
  return /\.[^./]+$/.test(filename) ? filename.replace(/\.[^./]+$/, extension) : `${filename}${extension}`;
}

function imageSize(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => Image.getSize(uri, (width, height) => resolve({ width, height }), reject));
}

/**
 * Returns a compressed local copy, or the original when the file is not a compressible image
 * or the native module is missing (an app build older than this change).
 */
export async function compressImageForUpload(image: CompressedImage): Promise<CompressedImage> {
  try {
    const { width, height } = await imageSize(image.uri);
    const plan = planImageCompression(image.mime, width, height);
    if (!plan) return image;
    // Required lazily: on an app build without this native module the require throws here,
    // inside the try, instead of crashing at startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ImageManipulator, SaveFormat } = require('expo-image-manipulator') as typeof import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(image.uri);
    if (plan.width !== width || plan.height !== height) {
      context.resize({ width: plan.width, height: plan.height });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: plan.format === 'png' ? SaveFormat.PNG : SaveFormat.JPEG,
      compress: JPEG_QUALITY,
    });
    return {
      uri: saved.uri,
      mime: plan.format === 'png' ? 'image/png' : 'image/jpeg',
      filename: renamed(image.filename, plan.format),
    };
  } catch {
    return image;
  }
}
