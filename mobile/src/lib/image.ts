import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const TARGET_UPLOAD_BYTES = 2 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export type PreparedImage = {
  uri: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  size: number;
  /** Keep the browser Blob so uploading does not have to fetch a blob: URL. */
  webBlob?: Blob;
};

function mimeTypeForAsset(asset: ImagePickerAsset): PreparedImage['mimeType'] {
  const mimeType = (asset.mimeType ?? asset.file?.type)?.toLowerCase();
  if (!mimeType || !ACCEPTED_MIME_TYPES.has(mimeType)) {
    throw new Error('Unsupported image type. Choose a JPEG, PNG, or WebP image.');
  }
  return mimeType as PreparedImage['mimeType'];
}

async function imageSize(uri: string): Promise<number> {
  if (typeof window !== 'undefined') {
    const blob = await fetch(uri).then((response) => response.blob());
    if (blob.size === 0) throw new Error('Could not read the prepared image. Please choose it again.');
    return blob.size;
  }
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || typeof info.size !== 'number') {
    throw new Error('Could not read the prepared image. Please choose it again.');
  }
  return info.size;
}

async function canvasEncode(source: Blob, maxDimension: number, quality: number): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Your browser cannot prepare this image. Choose another photo.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error('Your browser could not compress this image. Choose another photo.'));
    }, 'image/jpeg', quality);
  });
}

async function prepareWebImage(asset: ImagePickerAsset): Promise<PreparedImage> {
  // Expo ImagePicker exposes the selected browser File on web. Using it directly
  // avoids a second fetch of the temporary blob: URL, which can remain pending
  // in some browsers and makes submission look like it is stuck forever.
  const source: Blob = asset.file ?? await fetch(asset.uri).then((response) => {
    if (!response.ok) throw new Error('The selected web image is no longer available. Choose it again.');
    return response.blob();
  });
  let output = await canvasEncode(source, 1600, 0.82);
  if (output.size > TARGET_UPLOAD_BYTES) output = await canvasEncode(source, 1600, 0.62);
  if (output.size > MAX_UPLOAD_BYTES) throw new Error('Image is larger than the 5 MB upload limit after compression. Choose a smaller image.');
  return { uri: URL.createObjectURL(output), mimeType: 'image/jpeg', size: output.size, webBlob: output };
}

export async function prepareImage(asset: ImagePickerAsset): Promise<PreparedImage> {
  mimeTypeForAsset(asset);
  if (!asset.uri) throw new Error('The selected image has no readable file URI.');

  if (typeof window !== 'undefined') return prepareWebImage(asset);

  const scale = Math.min(1, 1600 / Math.max(asset.width, asset.height));
  const actions = scale < 1 ? [{ resize: { width: Math.round(asset.width * scale), height: Math.round(asset.height * scale) } }] : [];
  const first = await ImageManipulator.manipulateAsync(asset.uri, actions, {
    compress: 0.82,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  let size = await imageSize(first.uri);

  if (size > TARGET_UPLOAD_BYTES) {
    const smaller = await ImageManipulator.manipulateAsync(first.uri, [], {
      compress: 0.62,
      format: ImageManipulator.SaveFormat.JPEG,
    });
    size = await imageSize(smaller.uri);
    if (size <= MAX_UPLOAD_BYTES) {
      return { uri: smaller.uri, mimeType: 'image/jpeg', size };
    }
  }

  if (size > MAX_UPLOAD_BYTES) {
    throw new Error('Image is larger than the 5 MB upload limit after compression. Choose a smaller image.');
  }
  return { uri: first.uri, mimeType: 'image/jpeg', size };
}
