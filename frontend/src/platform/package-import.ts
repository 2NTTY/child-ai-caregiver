import { HANDOVER_UPLOAD_MAX_BYTES } from '../../../src/shared/handover-uploads';
import type { SelectedPackage } from '../production/HandoverImportOwner';
import { packageHash } from './package-import-hash';
export const PACKAGE_IMPORT_MAX_BYTES = HANDOVER_UPLOAD_MAX_BYTES;
export async function pickImportPackage(signal: AbortSignal): Promise<SelectedPackage | null> {
  signal.throwIfAborted();
  const file = await new Promise<File | null>((resolve, reject) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.zip,application/zip';
    input.hidden = true; document.body.appendChild(input);
    const cleanup = () => { signal.removeEventListener('abort', abort); input.remove(); };
    const abort = () => { cleanup(); reject(new Error('session_changed')); };
    input.onchange = () => { const selected = input.files?.[0] ?? null; cleanup(); resolve(selected); };
    input.oncancel = () => { cleanup(); resolve(null); };
    signal.addEventListener('abort', abort, { once: true }); input.click();
  });
  if (!file) return null;
  if (!/\.zip$/iu.test(file.name) || file.size < 1 || file.size > PACKAGE_IMPORT_MAX_BYTES) throw new Error('invalid_package_file');
  const sha256 = await packageHash(file.stream(), file.size, signal);
  return { filename: file.name, bytes: file.size, sha256, body: file, release() {} };
}
