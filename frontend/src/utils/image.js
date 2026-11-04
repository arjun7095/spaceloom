// Resizes and re-encodes photos in the browser so uploads stay at or below ~1 MB.
export async function compressImage(file, maxDim = 1600) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400 * 1024) return file;
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  let q = 0.8;
  let blob;
  do {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q));
    q -= 0.1;
  } while (blob.size > 1024 * 1024 && q > 0.3);
  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
}
