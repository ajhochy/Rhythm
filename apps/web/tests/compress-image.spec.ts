import { expect, test } from '@playwright/test';

// Composer uploads are downscaled in the renderer before they become a data: URL (the API then
// hosts the bytes as a media artifact). Runs the real module in Chromium via the Vite dev server.
test('compressImageFile caps photos at 2048px JPEG, keeps PNG, passes through GIF and undecodable files', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { compressImageFile } = await import('/src/compressImage.ts');
    const make = async (width: number, height: number, mime: string, name: string) => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d')!;
      for (let i = 0; i < 400; i += 1) {
        context.fillStyle = `hsl(${i}, 70%, 50%)`;
        context.fillRect((i * 97) % width, (i * 53) % height, 180, 120);
      }
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), mime, 1));
      return new File([blob], name, { type: mime });
    };
    const dims = async (blob: Blob) => {
      const bitmap = await createImageBitmap(blob);
      return [bitmap.width, bitmap.height];
    };
    const photo = await make(4000, 3000, 'image/jpeg', 'Chapel front.jpeg');
    const shot = await make(2400, 1600, 'image/png', 'screen.png');
    const compressedPhoto = await compressImageFile(photo);
    const compressedShot = await compressImageFile(shot);
    return {
      photo: compressedPhoto && { mime: compressedPhoto.mime, filename: compressedPhoto.filename, dims: await dims(compressedPhoto.blob), smaller: compressedPhoto.blob.size < photo.size },
      shot: compressedShot && { mime: compressedShot.mime, dims: await dims(compressedShot.blob) },
      gif: await compressImageFile(new File([new Uint8Array([71, 73, 70])], 'a.gif', { type: 'image/gif' })),
      broken: await compressImageFile(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'nonce.png', { type: 'image/png' })),
    };
  });
  expect(result.photo).toEqual({ mime: 'image/jpeg', filename: 'Chapel front.jpg', dims: [2048, 1536], smaller: true });
  expect(result.shot).toEqual({ mime: 'image/png', dims: [2048, 1365] });
  expect(result.gif).toBeNull();
  expect(result.broken).toBeNull();
});
