import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { avatarCropSchema, type AvatarCrop } from '../src/shared/avatars.ts';
import { AVATAR_CODEC_VERSION, avatarAdmissionSchema, avatarRecipeSchema, type AvatarAdmission, type AvatarRecipe } from './avatar-config.ts';

import { AvatarCodecError } from './avatar-codec-error.ts';

export interface AvatarNormalized { buffer: Buffer; bytes: number; sha256: string; mimeType: 'image/jpeg'; width: number; height: number }
let restricted = false;
/** Call only inside the dedicated codec process: loader restrictions are process-global. */
export function restrictAvatarCodec() {
  if (sharp.versions.sharp !== AVATAR_CODEC_VERSION) throw new AvatarCodecError('avatar_unavailable');
  if (restricted) return;
  sharp.cache(false); sharp.concurrency(1);
  sharp.block({ operation: ['VipsForeignLoad'] });
  sharp.unblock({ operation: ['VipsForeignLoadJpegBuffer', 'VipsForeignLoadPngBuffer'] });
  restricted = true;
}
export function avatarCropRectangle(width: number, height: number, crop: AvatarCrop) {
  const size = Math.max(1, Math.floor(Math.min(width, height) / crop.zoom));
  return { left: Math.max(0, Math.min(width - size, Math.round(crop.centerX * width - size / 2))),
    top: Math.max(0, Math.min(height - size, Math.round(crop.centerY * height - size / 2))), width: size, height: size };
}
function magic(input: Buffer): 'image/jpeg' | 'image/png' | null {
  if (input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) return 'image/jpeg';
  if (input.length >= 8 && input.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  return null;
}
/** Reject animation/multi-picture containers even when a decoder exposes only their first frame. */
function rejectAdditionalFrames(input: Buffer, mimeType: 'image/jpeg' | 'image/png') {
  if (mimeType === 'image/png') {
    let offset = 8;
    while (offset + 12 <= input.length) {
      const length = input.readUInt32BE(offset), type = input.subarray(offset + 4, offset + 8).toString('ascii');
      if (length > input.length - offset - 12) throw new AvatarCodecError('avatar_invalid_image');
      if (type === 'acTL' || type === 'fcTL' || type === 'fdAT') throw new AvatarCodecError('avatar_unsupported_format');
      offset += length + 12;
      if (type === 'IEND') {
        if (length !== 0 || offset !== input.length) throw new AvatarCodecError('avatar_invalid_image');
        return;
      }
    }
    throw new AvatarCodecError('avatar_invalid_image');
  }
  let offset = 2;
  while (offset + 1 < input.length) {
    if (input[offset++] !== 0xff) throw new AvatarCodecError('avatar_invalid_image');
    while (input[offset] === 0xff) offset++;
    const marker = input[offset++];
    if (marker === 0xda) return;
    if (marker === 0xd9 || marker === undefined || offset + 2 > input.length) throw new AvatarCodecError('avatar_invalid_image');
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) throw new AvatarCodecError('avatar_invalid_image');
    if (marker === 0xe2 && input.subarray(offset + 2, offset + 6).equals(Buffer.from([77, 80, 70, 0])))
      throw new AvatarCodecError('avatar_unsupported_format');
    offset += length;
  }
  throw new AvatarCodecError('avatar_invalid_image');
}
/** No EXIF/XMP/IPTC/ICC/comment/embedded thumbnail markers survive normalization. */
export function assertPrivateJpeg(buffer: Buffer) {
  if (magic(buffer) !== 'image/jpeg') throw new AvatarCodecError('avatar_integrity_failed');
  let offset = 2;
  while (offset + 1 < buffer.length) {
    if (buffer[offset++] !== 0xff) throw new AvatarCodecError('avatar_integrity_failed');
    while (buffer[offset] === 0xff) offset++;
    const marker = buffer[offset++];
    if (marker === 0xda) return;
    if (marker === 0xd9 || marker === undefined || offset + 2 > buffer.length) throw new AvatarCodecError('avatar_integrity_failed');
    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length || marker >= 0xe1 && marker <= 0xef || marker === 0xfe) throw new AvatarCodecError('avatar_integrity_failed');
    if (marker === 0xe0 && (size !== 16 || buffer.subarray(offset + 2, offset + 7).toString('ascii') !== 'JFIF\0'
      || buffer[offset + 14] !== 0 || buffer[offset + 15] !== 0)) throw new AvatarCodecError('avatar_integrity_failed');
    offset += size;
  }
  throw new AvatarCodecError('avatar_integrity_failed');
}

/** Full decoding is bounded and killed externally by the process supervisor; never run in the API process. */
export async function normalizeAvatar(input: Buffer, mimeType: 'image/jpeg' | 'image/png', cropInput: AvatarCrop,
  recipeInput: AvatarRecipe, admissionInput: AvatarAdmission): Promise<AvatarNormalized> {
  const recipe = avatarRecipeSchema.parse(recipeInput), admission = avatarAdmissionSchema.parse(admissionInput), crop = avatarCropSchema.parse(cropInput);
  if (!restricted) throw new AvatarCodecError('avatar_unavailable');
  if (!Buffer.isBuffer(input) || input.length < 1 || input.length > admission.maxInputBytes) throw new AvatarCodecError('avatar_input_too_large');
  if (magic(input) !== mimeType) throw new AvatarCodecError('avatar_unsupported_format');
  rejectAdditionalFrames(input, mimeType);
  if (crop.zoom > recipe.maxCropZoom) throw new AvatarCodecError('avatar_invalid_image');
  const options = { failOn: 'warning' as const, limitInputPixels: admission.maxInputPixels, limitInputChannels: admission.maxInputChannels,
    unlimited: false, sequentialRead: true };
  let pixels: Buffer | undefined;
  try {
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== (mimeType === 'image/jpeg' ? 'jpeg' : 'png')) throw new AvatarCodecError('avatar_unsupported_format');
    if ((metadata.pages ?? 1) !== 1 || metadata.pageHeight !== undefined || metadata.loop !== undefined || metadata.delay !== undefined)
      throw new AvatarCodecError('avatar_unsupported_format');
    const { width, height, channels } = metadata;
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width! < 1 || height! < 1
      || width! > admission.maxInputDimension || height! > admission.maxInputDimension
      || width! * height! > admission.maxInputPixels || !Number.isSafeInteger(width! * height! * channels!)
      || width! * height! * channels! > admission.maxDecodedBytes) throw new AvatarCodecError('avatar_decode_limit');
    const raw = await sharp(input, options).timeout({ seconds: Math.max(1, Math.ceil(admission.decodeTimeoutMs / 1000)) })
      .autoOrient().flatten({ background: recipe.background }).toColourspace(recipe.colourspace).removeAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    pixels = raw.data;
    const oriented = metadata.orientation !== undefined && metadata.orientation >= 5 && metadata.orientation <= 8;
    if (raw.info.width !== (oriented ? height : width) || raw.info.height !== (oriented ? width : height) || raw.info.channels !== 3
      || pixels.length !== raw.info.width * raw.info.height * raw.info.channels || pixels.length > admission.maxDecodedBytes)
      throw new AvatarCodecError('avatar_integrity_failed');
    const rectangle = avatarCropRectangle(raw.info.width, raw.info.height, crop);
    const buffer = await sharp(pixels, { raw: { width: raw.info.width, height: raw.info.height, channels: 3 } })
      .timeout({ seconds: Math.max(1, Math.ceil(admission.decodeTimeoutMs / 1000)) }).extract(rectangle)
      .resize(recipe.outputSize, recipe.outputSize, { fit: 'fill', kernel: 'lanczos3' })
      .toColourspace(recipe.colourspace).jpeg({ quality: recipe.quality, chromaSubsampling: recipe.chromaSubsampling, progressive: false, mozjpeg: false }).toBuffer();
    if (buffer.length > recipe.maxOutputBytes) throw new AvatarCodecError('avatar_decode_limit');
    assertPrivateJpeg(buffer);
    const output = await sharp(buffer, options).metadata();
    if (output.format !== 'jpeg' || output.width !== recipe.outputSize || output.height !== recipe.outputSize
      || output.exif || output.xmp || output.iptc || output.icc || output.orientation !== undefined)
      throw new AvatarCodecError('avatar_integrity_failed');
    return { buffer, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex'), mimeType: 'image/jpeg', width: recipe.outputSize, height: recipe.outputSize };
  } catch (error) {
    if (error instanceof AvatarCodecError) throw error;
    if (error instanceof Error && /pixel limit|timeout/i.test(error.message)) throw new AvatarCodecError('avatar_decode_limit');
    throw new AvatarCodecError('avatar_invalid_image');
  } finally { pixels?.fill(0); }
}
