import type { Readable } from "node:stream";
import type { FirebaseStorageMediaClient } from "../server/firebase-photo-objects.ts";
export function storageMediaFixture(name: string, read: (name: string, generation: string) => Readable,
  observe: (options: Parameters<FirebaseStorageMediaClient["request"]>[0]) => void) {
  return { name, storage: { authClient: { async request(options: Parameters<FirebaseStorageMediaClient["request"]>[0]) {
    observe(options);
    const objectName = decodeURIComponent(new URL(options.url).pathname.split("/o/")[1]);
    const stream = read(objectName, options.params.generation);
    return await new Promise<{ status: number; headers: unknown; data: Readable }>((resolve, reject) => {
      stream.once("error", reject);
      stream.once("response", response => resolve({ status: response.statusCode, headers: response.headers, data: stream }));
      stream.read(0);
    });
  } } } };
}
