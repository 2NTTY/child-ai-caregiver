import assert from "node:assert/strict";
import test from "node:test";
import { prepareWebPhoto } from "../src/components/photos/web-photo-file.ts";

test("JPEG and PNG keep their exact local bytes without decoding", async () => {
  for (const type of ["image/jpeg", "image/png"]) {
    const original = new File(["original"], "photo.jpg", { type });
    assert.equal(await prepareWebPhoto(original), original);
  }
});

test("decodable HEIC becomes a local JPEG with a matching name and releases its decode URL", async () => {
  const originalImage = globalThis.Image, originalDocument = globalThis.document;
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let decoded = false, drawn = false;
  try {
    globalThis.Image = class { naturalWidth = 100; naturalHeight = 80; onload!: () => void; onerror!: () => void;
      set src(uri: string) { if (uri) { decoded = true; queueMicrotask(() => this.onload()); } }
    } as any;
    globalThis.document = { createElement: () => ({ width: 0, height: 0,
      getContext: () => ({ drawImage() { drawn = true; } }),
      toBlob(callback: (value: Blob) => void, type: string) { assert.equal(type, "image/jpeg"); callback(new Blob(["jpeg-copy"], { type })); },
    }) } as any;
    URL.createObjectURL = () => "blob:local-heic";
    URL.revokeObjectURL = uri => { revoked.push(uri); };
    const result = await prepareWebPhoto(new File(["heic"], "phone.HEIC", { type: "" }));
    assert.equal(decoded && drawn, true);
    assert.equal(result.name, "phone.jpg"); assert.equal(result.type, "image/jpeg");
    assert.equal(await result.text(), "jpeg-copy"); assert.deepEqual(revoked, ["blob:local-heic"]);
  } finally { globalThis.Image = originalImage; globalThis.document = originalDocument; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test("unsupported HEIC decoding fails locally and releases the temporary URL", async () => {
  const originalImage = globalThis.Image, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  let revoked = 0;
  try {
    globalThis.Image = class { onerror!: () => void; set src(uri: string) { if (uri) queueMicrotask(() => this.onerror()); } } as any;
    URL.createObjectURL = () => "blob:local-heic"; URL.revokeObjectURL = () => { revoked++; };
    await assert.rejects(prepareWebPhoto(new File(["heic"], "phone.heif", { type: "image/heif" })), /HEIC/);
    assert.equal(revoked, 1);
  } finally { globalThis.Image = originalImage; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
});

test("oversize and unsupported files are rejected before reading or decoding", async () => {
  await assert.rejects(prepareWebPhoto(new File([new Uint8Array(4 * 1024 * 1024 + 1)], "phone.heic", { type: "image/heic" })), /4 MiB/);
  await assert.rejects(prepareWebPhoto(new File(["gif"], "phone.gif", { type: "image/gif" })), /JPEG/);
});
