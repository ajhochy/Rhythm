import { compressImageForUpload, MAX_IMAGE_EDGE, planImageCompression } from '@/lib/attachments/compress-image';

const mockResize = jest.fn();
const mockSave = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg', PNG: 'png' },
  ImageManipulator: {
    manipulate: () => ({
      resize: mockResize,
      renderAsync: async () => ({ saveAsync: mockSave }),
    }),
  },
}));

let mockSize = { width: 4032, height: 3024 };
jest.mock('react-native', () => ({
  Image: { getSize: (_uri: string, ok: (w: number, h: number) => void) => ok(mockSize.width, mockSize.height) },
}));

beforeEach(() => {
  mockResize.mockReset();
  mockSave.mockReset().mockResolvedValue({ uri: 'file:///cache/out' });
  mockSize = { width: 4032, height: 3024 };
});

describe('planImageCompression', () => {
  it('caps the long edge at 2048 and keeps aspect ratio', () => {
    expect(planImageCompression('image/jpeg', 4032, 3024)).toEqual({ width: 2048, height: 1536, format: 'jpeg' });
    expect(planImageCompression('image/heic', 3024, 4032)).toEqual({ width: 1536, height: 2048, format: 'jpeg' });
  });
  it('keeps small images at size but still re-encodes (drops EXIF); PNG stays PNG', () => {
    expect(planImageCompression('image/png', 1200, 800)).toEqual({ width: 1200, height: 800, format: 'png' });
  });
  it('passes through GIF, SVG and non-images', () => {
    expect(planImageCompression('image/gif', 4000, 4000)).toBeNull();
    expect(planImageCompression('image/svg+xml', 4000, 4000)).toBeNull();
    expect(planImageCompression('application/pdf', 4000, 4000)).toBeNull();
  });
});

describe('compressImageForUpload', () => {
  it('resizes a camera photo and returns a JPEG copy', async () => {
    const out = await compressImageForUpload({ uri: 'file:///p/IMG_1.HEIC', mime: 'image/heic', filename: 'IMG_1.HEIC' });
    expect(mockResize).toHaveBeenCalledWith({ width: MAX_IMAGE_EDGE, height: 1536 });
    expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.85 });
    expect(out).toEqual({ uri: 'file:///cache/out', mime: 'image/jpeg', filename: 'IMG_1.jpg' });
  });
  it('falls back to the original when the native module fails (older app build)', async () => {
    mockSave.mockRejectedValue(new Error('native module missing'));
    const original = { uri: 'file:///p/a.jpg', mime: 'image/jpeg', filename: 'a.jpg' };
    expect(await compressImageForUpload(original)).toBe(original);
  });
  it('does not touch PDFs', async () => {
    const pdf = { uri: 'file:///p/a.pdf', mime: 'application/pdf', filename: 'a.pdf' };
    expect(await compressImageForUpload(pdf)).toBe(pdf);
    expect(mockSave).not.toHaveBeenCalled();
  });
});
