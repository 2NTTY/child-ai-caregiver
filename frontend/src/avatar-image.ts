import type { AvatarCrop, AvatarPolicy } from '../../src/shared/avatars.ts';

export const defaultAvatarCrop: AvatarCrop = { centerX: 0.5, centerY: 0.5, zoom: 1 };
export interface AvatarImage {
  uri: string; width: number; height: number; mimeType: 'image/jpeg' | 'image/png';
  bytes: Uint8Array<ArrayBuffer>; dispose(): void;
}
/** Coordinates are on the EXIF-oriented image, exactly as AVATAR-01. */
export function avatarCropRect(width: number, height: number, crop: AvatarCrop) {
  const size = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  return { size, left: Math.max(0, Math.min(width - size, Math.round(crop.centerX * width - size / 2))),
    top: Math.max(0, Math.min(height - size, Math.round(crop.centerY * height - size / 2))) };
}
export function boundedAvatarCrop(crop: AvatarCrop, maxZoom: number): AvatarCrop {
  const finite = (n: number, fallback: number) => Number.isFinite(n) ? n : fallback;
  return { centerX: Math.max(0, Math.min(1, finite(crop.centerX, .5))), centerY: Math.max(0, Math.min(1, finite(crop.centerY, .5))),
    zoom: Math.max(1, Math.min(maxZoom, finite(crop.zoom, 1))) };
}
/** Map the cropper's oriented percentage area into the existing Server crop contract. */
export function avatarCropFromArea(width: number, height: number, area: { x: number; y: number; width: number; height: number }, maxZoom: number): AvatarCrop {
  return boundedAvatarCrop({ centerX: (area.x + area.width / 2) / 100, centerY: (area.y + area.height / 2) / 100,
    zoom: Math.min(width, height) / (width * area.width / 100) }, maxZoom);
}
/** Header admission before browser/native decode; Server still verifies and normalizes every byte. */
export function avatarImageHeader(bytes: Uint8Array<ArrayBuffer>, policy: AvatarPolicy) {
  if (!bytes.length || bytes.length > policy.maxInputBytes) throw new Error('avatar_input_too_large');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0, height = 0, orientation = 1, mimeType: AvatarImage['mimeType'];
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((n, i) => bytes[i] === n)) {
    mimeType = 'image/png'; width = view.getUint32(16); height = view.getUint32(20);
    let at = 8;
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at);
      if (length > bytes.length - at - 12) throw new Error('avatar_invalid_image');
      if (String.fromCharCode(...bytes.subarray(at + 4, at + 8)) === 'acTL') throw new Error('avatar_unsupported_format');
      at += length + 12;
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = 'image/jpeg'; let at = 2;
    while (at + 4 <= bytes.length) {
      if (bytes[at++] !== 255) throw new Error('avatar_invalid_image');
      while (bytes[at] === 255) at++;
      const marker = bytes[at++]; if (marker === 218 || marker === 217) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at), end = at + length;
      if (length < 2 || end > bytes.length) throw new Error('avatar_invalid_image');
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 7) {
        height = view.getUint16(at + 3); width = view.getUint16(at + 5);
      }
      if (marker === 225 && length >= 16 && String.fromCharCode(...bytes.subarray(at + 2, at + 8)) === 'Exif\0\0') {
        const start = at + 8, little = view.getUint16(start) === 0x4949;
        if (view.getUint16(start, little) !== 0x4949 && view.getUint16(start, little) !== 0x4d4d || view.getUint16(start + 2, little) !== 42) throw new Error('avatar_invalid_image');
        const ifd = start + view.getUint32(start + 4, little);
        if (ifd + 2 > end || ifd < start + 8) throw new Error('avatar_invalid_image');
        const count = view.getUint16(ifd, little);
        if (count > Math.floor((end - ifd - 2) / 12)) throw new Error('avatar_invalid_image');
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (view.getUint16(entry, little) === 274 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) orientation = view.getUint16(entry + 8, little);
        }
      }
      at = end;
    }
  } else throw new Error('avatar_unsupported_format');
  if (!policy.acceptedMimeTypes.includes(mimeType) || !width || !height || orientation < 1 || orientation > 8) throw new Error('avatar_invalid_image');
  if (width > policy.maxInputDimension || height > policy.maxInputDimension || width * height > policy.maxInputPixels) throw new Error('avatar_decode_limit');
  return { mimeType, width: orientation >= 5 ? height : width, height: orientation >= 5 ? width : height };
}
