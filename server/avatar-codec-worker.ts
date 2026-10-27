import { z } from 'zod';
import { avatarCropSchema } from '../src/shared/avatars.ts';
import { avatarAdmissionSchema, avatarRecipeSchema } from './avatar-config.ts';
import { normalizeAvatar, restrictAvatarCodec } from './avatar-codec-core.ts';
import { AvatarCodecError } from './avatar-codec-error.ts';

// Fixed executable, no URL/path inputs, no credentials or network clients in this process.
const headerSchema = z.object({ bytes: z.number().int().positive(), mimeType: z.enum(['image/jpeg', 'image/png']),
  crop: avatarCropSchema, recipe: avatarRecipeSchema, admission: avatarAdmissionSchema }).strict();
let raw: Buffer | undefined;
try {
  let headerBuffer = Buffer.alloc(0), header: z.infer<typeof headerSchema> | null = null, size = 0;
  const parts: Buffer[] = [];
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (header === null) {
      const newline = chunk.indexOf(10);
      if (headerBuffer.length + (newline < 0 ? chunk.length : newline) > 16_384) throw new AvatarCodecError('avatar_invalid_image');
      if (newline < 0) { headerBuffer = Buffer.concat([headerBuffer, chunk]); continue; }
      headerBuffer = Buffer.concat([headerBuffer, chunk.subarray(0, newline)]);
      header = headerSchema.parse(JSON.parse(headerBuffer.toString('utf8')));
      if (header.bytes > header.admission.maxInputBytes) throw new AvatarCodecError('avatar_input_too_large');
      const rest = chunk.subarray(newline + 1); size += rest.length; parts.push(rest);
    } else { size += chunk.length; parts.push(chunk); }
    if (size > header.bytes) throw new AvatarCodecError('avatar_invalid_image');
  }
  if (!header || size !== header.bytes) throw new AvatarCodecError('avatar_invalid_image');
  raw = Buffer.concat(parts, size); parts.length = 0;
  restrictAvatarCodec();
  const normalized = await normalizeAvatar(raw, header.mimeType, header.crop, header.recipe, header.admission);
  process.stdout.write(JSON.stringify({ bytes: normalized.bytes, sha256: normalized.sha256, mimeType: normalized.mimeType,
    width: normalized.width, height: normalized.height }) + '\n');
  process.stdout.write(normalized.buffer);
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error instanceof AvatarCodecError ? error.code : 'avatar_invalid_image' }) + '\n');
  process.exitCode = 1;
} finally { raw?.fill(0); }
