import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createStorageCipher, openBuffer, sealBuffer } from "../server/storage-crypto.ts";

test("encrypted text preserves raw Unicode, hides plaintext and uses a fresh nonce", () => {
  const cipher = createStorageCipher(randomBytes(32));
  const value = "  合成原文：大約 3 點。\n🙂  ";
  const first = cipher.encrypt(value, "chat:1:owner"), second = cipher.encrypt(value, "chat:1:owner");
  assert.notEqual(first, second);
  assert.ok(!first.includes(value));
  assert.equal(cipher.decrypt(first, "chat:1:owner"), value);
  assert.equal(cipher.decrypt(second, "chat:1:owner"), value);
});

test("wrong key, owner/context, plaintext and modified ciphertext fail closed", () => {
  const cipher = createStorageCipher(randomBytes(32));
  const encrypted = cipher.encrypt("private synthetic text", "row:1:owner");
  assert.throws(() => createStorageCipher(randomBytes(32)).decrypt(encrypted, "row:1:owner"));
  assert.throws(() => cipher.decrypt(encrypted, "row:1:other"));
  assert.throws(() => cipher.decrypt("legacy plaintext", "row:1:owner"));
  const bytes = Buffer.from(encrypted.slice(4), "base64"); bytes[bytes.length - 1]! ^= 1;
  assert.throws(() => cipher.decrypt(`yb1.${bytes.toString("base64")}`, "row:1:owner"));
});

test("backup authentication covers the entire binary archive before it is released", () => {
  const key = randomBytes(32), input = Buffer.concat([Buffer.from("PGDMP"), randomBytes(256)]);
  const encrypted = sealBuffer(input, key, "backup:v1");
  assert.deepEqual(openBuffer(encrypted, key, "backup:v1"), input);
  for (const index of [0, 4, 16, encrypted.length - 1]) {
    const damaged = Buffer.from(encrypted); damaged[index]! ^= 1;
    assert.throws(() => openBuffer(damaged, key, "backup:v1"));
  }
  assert.throws(() => openBuffer(encrypted.subarray(0, 24), key, "backup:v1"));
});
