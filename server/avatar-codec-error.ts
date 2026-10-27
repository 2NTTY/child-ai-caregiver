export class AvatarCodecError extends Error {
  readonly code: 'avatar_input_too_large' | 'avatar_unsupported_format' | 'avatar_invalid_image' | 'avatar_decode_limit' | 'avatar_integrity_failed' | 'avatar_unavailable' | 'avatar_busy';
  constructor(code: AvatarCodecError['code']) { super('Avatar image could not be processed'); this.name = 'AvatarCodecError'; this.code = code; }
}
