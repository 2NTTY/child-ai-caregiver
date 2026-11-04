import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { AvatarAsset } from '../src/shared/avatars.ts';
import type { AvatarCodec } from './avatar-codec.ts';
import { assertPrivateJpeg } from './avatar-codec-core.ts';
import { AvatarCodecError } from './avatar-codec-error.ts';

/** Internal adapter for an issuer-verified original, never an ordinary upload normalizer. */
export function selfRestoreCodec(owner: string, asset: AvatarAsset): Pick<AvatarCodec, 'normalize'> {
  return { async normalize(actor, bytes, mimeType, crop, recipe, signal) {
    if (signal.aborted) throw new AvatarCodecError('avatar_decode_limit');
    if (actor !== owner || mimeType !== 'image/jpeg' || bytes.length !== asset.bytes
      || createHash('sha256').update(bytes).digest('hex') !== asset.sha256 || bytes.length > recipe.maxOutputBytes
      || asset.width !== recipe.outputSize || asset.height !== recipe.outputSize
      || crop.centerX !== .5 || crop.centerY !== .5 || crop.zoom !== 1) throw new AvatarCodecError('avatar_integrity_failed');
    assertPrivateJpeg(bytes);
    try {
      // Inspect only the bounded, already normalized JPEG metadata; do not decode pixels or encode a second JPEG.
      const metadata = await sharp(bytes, { failOn: 'warning', limitInputPixels: recipe.outputSize ** 2 }).metadata();
      if (metadata.format !== 'jpeg' || metadata.width !== asset.width || metadata.height !== asset.height || metadata.channels !== 3
        || (metadata.pages ?? 1) !== 1 || metadata.pageHeight !== undefined || metadata.loop !== undefined || metadata.delay !== undefined
        || metadata.exif || metadata.xmp || metadata.iptc || metadata.icc || metadata.orientation !== undefined)
        throw new AvatarCodecError('avatar_integrity_failed');
      if (signal.aborted) throw new AvatarCodecError('avatar_decode_limit');
      return { buffer: Buffer.from(bytes), bytes: asset.bytes, sha256: asset.sha256, mimeType: 'image/jpeg', width: asset.width, height: asset.height };
    } catch (error) {
      if (error instanceof AvatarCodecError) throw error;
      throw new AvatarCodecError('avatar_integrity_failed');
    }
  } };
}
