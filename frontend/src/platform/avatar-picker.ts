import type { AvatarPolicy } from '../../../src/shared/avatars.ts';
import { avatarImageHeader, type AvatarImage } from '../avatar-image';
const canceled = () => new Error('avatar_selection_canceled');

function readBytes(file: File, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(canceled()); return; }
    const reader = new FileReader();
    const release = () => { reader.onload = null; reader.onerror = null; reader.onabort = null; signal.removeEventListener('abort', abort); };
    const abort = () => { release(); reader.abort(); reject(canceled()); };
    reader.onload = () => { const result = reader.result; release(); result instanceof ArrayBuffer ? resolve(new Uint8Array(result)) : reject(new Error('avatar_invalid_image')); };
    reader.onerror = () => { release(); reject(new Error('avatar_invalid_image')); };
    reader.onabort = () => { release(); reject(canceled()); };
    signal.addEventListener('abort', abort, { once: true }); reader.readAsArrayBuffer(file);
  });
}
export async function readAvatarFile(file: File, policy: AvatarPolicy, signal: AbortSignal): Promise<AvatarImage> {
  if (signal.aborted) throw canceled();
  if (!policy.acceptedMimeTypes.includes(file.type as 'image/jpeg' | 'image/png') || !file.size || file.size > policy.maxInputBytes) throw new Error('avatar_unsupported_format');
  const bytes = await readBytes(file, signal);
  let uri: string | null = null;
  try {
    if (signal.aborted) throw canceled();
    const header = avatarImageHeader(bytes, policy);
    if (header.mimeType !== file.type) throw new Error('avatar_unsupported_format');
    uri = URL.createObjectURL(file); const previewUri = uri;
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(canceled()); return; }
      const image = new window.Image();
      const release = () => { image.onload = null; image.onerror = null; image.src = ''; signal.removeEventListener('abort', abort); };
      // Release the browser decoder and object URL immediately, not only when its late onload arrives.
      const abort = () => { release(); URL.revokeObjectURL(previewUri); uri = null; bytes.fill(0); reject(canceled()); };
      image.onload = () => { const valid = image.naturalWidth === header.width && image.naturalHeight === header.height; release(); valid ? resolve() : reject(new Error('avatar_orientation_unavailable')); };
      image.onerror = () => { release(); reject(new Error('avatar_invalid_image')); };
      signal.addEventListener('abort', abort, { once: true }); image.src = previewUri;
    });
    if (signal.aborted) throw canceled();
    let disposed = false;
    return { ...header, uri: previewUri, bytes, dispose() { if (!disposed) { disposed = true; URL.revokeObjectURL(previewUri); bytes.fill(0); } } };
  } catch (error) { if (uri) URL.revokeObjectURL(uri); bytes.fill(0); throw error; }
}
export async function pickAvatarImage(_policy: AvatarPolicy, _signal: AbortSignal): Promise<AvatarImage | null> { throw new Error('avatar_picker_unavailable'); }
