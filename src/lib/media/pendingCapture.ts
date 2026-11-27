import type { ImagePickerAsset } from 'expo-image-picker';

/**
 * Android can destroy the activity while the OS camera is open. The recovered
 * result is stashed here in memory between the layout bootstrap and Create,
 * which are separate screens in the same JS process.
 */
let pending: ImagePickerAsset | null = null;

export function setPendingCapture(asset: ImagePickerAsset) {
  pending = asset;
}

export function takePendingCapture(): ImagePickerAsset | null {
  const asset = pending;
  pending = null;
  return asset;
}
