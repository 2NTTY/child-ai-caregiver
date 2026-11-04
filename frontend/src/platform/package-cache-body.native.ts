import { Directory, File, Paths } from 'expo-file-system';
import { requireNativeModule } from 'expo-modules-core';

type CacheBody = { path: string; uri: string; bytes: number };
const bodies = new WeakMap<File, CacheBody | null>();
export function supportsPackageCacheBody(): boolean {
  try { return requireNativeModule<{ supportsCacheFileBody?: boolean }>('ExpoFetchModule').supportsCacheFileBody === true; }
  catch { return false; }
}
/** Only the package picker registers a hashed, app-owned file; no URI enters the transport API. */
export function registerPackageCacheBody(file: File): () => void {
  const expected = new File(new Directory(Paths.cache, 'yuyoufang-package-imports'), file.name);
  if (!supportsPackageCacheBody() || !file.exists || file.uri !== expected.uri
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/u.test(file.name))
    throw new Error('invalid_package_file');
  bodies.set(file, { path: `yuyoufang-package-imports/${file.name}`, uri: file.uri, bytes: file.size });
  // Keep a weak revoked marker so released File objects cannot fall through to Blob buffering.
  return () => { bodies.set(file, null); };
}
export function packageCacheBodyPath(body: BodyInit | null | undefined): string | null {
  if (!(body instanceof File) || !bodies.has(body)) return null;
  const saved = bodies.get(body);
  if (!saved || !supportsPackageCacheBody() || !body.exists || body.uri !== saved.uri || body.size !== saved.bytes)
    throw new Error('package_local_file_missing');
  return saved.path;
}
