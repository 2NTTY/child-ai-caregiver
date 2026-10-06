import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalVoiceCapture } from "../src/components/agent/local-voice-capture.ts";

test("cancelled permission resolution stops late tracks and never creates a recorder", async () => {
  let resolve!: (stream: MediaStream) => void, stopped = 0, created = 0, ready = 0;
  const stream = { getTracks: () => [{ stop() { stopped++; } }] } as unknown as MediaStream;
  const controller = createLocalVoiceCapture({ requestStream: () => new Promise(value => { resolve = value; }),
    createRecorder: () => { created++; throw new Error("Must not be called"); }, createUrl: () => "local-only", revokeUrl: () => {} }, () => {}, () => ready++);
  const starting = controller.start(); controller.cancel(); resolve(stream); await starting;
  assert.equal(stopped, 1); assert.equal(created, 0); assert.equal(ready, 0);
});

test("explicit stop keeps the final dataavailable chunk, stops tracks and transfers only a local attachment", async () => {
  let stopped = 0, blobSize = 0, revoked = 0, result: any;
  const recorder: any = { state: "inactive", mimeType: "audio/webm", onstop: null, ondataavailable: null, onerror: null,
    start() { this.state = "recording"; }, stop() { this.state = "inactive"; } };
  const controller = createLocalVoiceCapture({ requestStream: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) as unknown as MediaStream,
    createRecorder: () => recorder, createUrl: blob => { blobSize = blob.size; return "blob:synthetic-only"; }, revokeUrl: () => revoked++ }, () => {}, item => { result = item; });
  await controller.start(); recorder.ondataavailable({ data: new Blob(["first"], { type: "audio/webm" }) });
  controller.stop(); assert.equal(stopped, 1); assert.equal(result, undefined);
  recorder.ondataavailable({ data: new Blob(["last"], { type: "audio/webm" }) }); recorder.onstop();
  assert.equal(blobSize, 9); assert.equal(result.kind, "voice"); assert.equal(result.bytes, 9);
  controller.cancel(); assert.equal(revoked, 0); result.dispose(); assert.equal(revoked, 1);
});

test("cancel while recording removes handlers, stops tracks and cannot publish a late result", async () => {
  let stopped = 0, ready = 0;
  const recorder: any = { state: "inactive", mimeType: "audio/webm", onstop: null, ondataavailable: null, onerror: null,
    start() { this.state = "recording"; }, stop() { this.state = "inactive"; } };
  const controller = createLocalVoiceCapture({ requestStream: async () => ({ getTracks: () => [{ stop() { stopped++; } }] }) as unknown as MediaStream,
    createRecorder: () => recorder, createUrl: () => "never", revokeUrl: () => {} }, () => {}, () => ready++);
  await controller.start(); const oldStop = recorder.onstop, oldData = recorder.ondataavailable;
  controller.cancel(); oldData({ data: new Blob(["late"]) }); oldStop();
  assert.equal(stopped, 1); assert.equal(ready, 0); assert.equal(recorder.ondataavailable, null);
});
