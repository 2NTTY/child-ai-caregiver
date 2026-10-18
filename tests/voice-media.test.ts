import test from "node:test";
import assert from "node:assert/strict";
import { Input, BufferSource, WEBM, Output, BufferTarget, WebMOutputFormat, EncodedAudioPacketSource, EncodedPacket } from "mediabunny";
import { validateVoiceFile, decodeVoiceBase64, VoiceFileError } from "../server/voice-files.ts";
import { Readable } from "node:stream";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { createVoiceObjects, VoiceObjectError } from "../server/firebase-voice-objects.ts";
import type { FirebasePhotoBucketPort } from "../server/firebase-photo-objects.ts";
import { createFirebaseVoiceRecovery } from "../server/firebase-voice-recovery.ts";
import { VOICE_LIMITS } from "../src/shared/voice.ts";

function wave(seconds: number) {
  const size = Math.round(seconds * 8000) * 2, bytes = Buffer.alloc(44 + size);
  bytes.write("RIFF"); bytes.writeUInt32LE(36 + size, 4); bytes.write("WAVEfmt ", 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(size, 40);
  return bytes.toString("base64");
}
test("voice validation measures packet duration without trusting filename or missing WebM metadata", async () => {
  const target = new BufferTarget(), source = new EncodedAudioPacketSource("opus");
  const output = new Output({ format: new WebMOutputFormat({ appendOnly: true }), target });
  output.addAudioTrack(source); await output.start();
  for (let i = 0; i < 5; i++) await source.add(new EncodedPacket(new Uint8Array([0xf8, 0xff, 0xfe]), "key", i * 0.02, 0.02),
    i === 0 ? { decoderConfig: { codec: "opus", sampleRate: 48000, numberOfChannels: 1 } } : undefined);
  await output.finalize();
  const body = Buffer.from(target.buffer!), input = new Input({ formats: [WEBM], source: new BufferSource(body) });
  assert.equal(await input.getDurationFromMetadata(undefined, { skipLiveWait: true }), null); input.dispose();
  const accepted = await validateVoiceFile(body.toString("base64"), "audio/webm;codecs=opus");
  assert.equal(accepted.metadata.mimeType, "audio/webm"); assert.ok(accepted.metadata.durationMs >= 100 && accepted.metadata.durationMs < 150);
  assert.equal(accepted.metadata.bytes, body.length);
  assert.equal((await validateVoiceFile(wave(1), "audio/x-wav")).metadata.durationMs, 1000);
  await assert.rejects(validateVoiceFile(wave(120.2), "audio/wav"), (e: unknown) => e instanceof VoiceFileError && e.code === "voice_too_long");
  await assert.rejects(validateVoiceFile(wave(1), "audio/mp4"), (e: unknown) => e instanceof VoiceFileError && e.code === "invalid_voice");
  assert.throws(() => decodeVoiceBase64(Buffer.alloc(VOICE_LIMITS.bytes + 1).toString("base64")), VoiceFileError);
});

test("private voice storage resolves a lost upload reply at the same generation and isolates its scope", async () => {
  const config = { projectId: "synthetic-voice-project", namespace: "voice_test", bucketName: "synthetic-voice-bucket" };
  const scope = { ownerUserId: "voice-owner", workspaceId: "10000000-0000-4000-8000-000000000001",
    childId: "20000000-0000-4000-8000-000000000001", storageEpoch: "30000000-0000-4000-8000-000000000001" };
  const id = "40000000-0000-4000-8000-000000000001", generation = "9007199254740993123";
  let stored: { bytes: Buffer; meta: Record<string, unknown> } | null = null, writes = 0;
  const bucket: FirebasePhotoBucketPort = {
    async writeNew(name, bytes, options) {
      writes++; assert.equal(options.preconditionOpts?.ifGenerationMatch, 0);
      stored = { bytes: Buffer.from(bytes), meta: { name, bucket: config.bucketName, generation,
        size: String(bytes.length), metadata: options.metadata?.metadata } };
      throw new Error("synthetic lost response");
    },
    async metadata(name, pinned) {
      if (!stored) throw Object.assign(new Error("missing"), { code: 404 });
      assert.equal(name, stored.meta.name); if (pinned) assert.equal(pinned, generation); return stored.meta;
    },
    readPinned(_name, pinned) {
      assert.equal(pinned, generation); let sent = false;
      return new Readable({ read() { if (sent) return; sent = true;
        this.emit("response", { statusCode: 200, headers: { "x-goog-generation": generation } });
        this.push(stored!.bytes); this.push(null); } });
    },
    async removePinned(_name, pinned) { assert.equal(pinned, generation); stored = null; },
  };
  const port = createVoiceObjects({ config, bucket, cipher: createStorageCipher(Buffer.alloc(32, 17)) });
  const descriptor = await port.write(scope, id, wave(1), "audio/wav");
  assert.equal(writes, 1); assert.equal(descriptor.generation, generation);
  assert.equal((await port.read(scope, id, descriptor)).base64, wave(1));
  await assert.rejects(port.read({ ...scope, ownerUserId: "other-owner" }, id, descriptor), VoiceObjectError);
  const backupName='synthetic-independent-backups',cipher=createStorageCipher(Buffer.alloc(32,17));
  let backupWrites=0,backupBody:Buffer|null=null,backupMeta:any;
  const backupBucket:FirebasePhotoBucketPort={
    async writeNew(name,body,options){backupWrites++;assert.equal(options.preconditionOpts?.ifGenerationMatch,0);
      backupBody=Buffer.from(body);backupMeta={name,bucket:backupName,generation,size:String(body.length),
        temporaryHold:options.metadata?.temporaryHold,metadata:options.metadata?.metadata};throw Error('synthetic lost backup reply');},
    async metadata(name,pinned){assert.equal(name,backupMeta.name);if(pinned)assert.equal(pinned,generation);return backupMeta;},
    readPinned(name,pinned){assert.equal(name,backupMeta.name);assert.equal(pinned,generation);let sent=false;
      return new Readable({read(){if(sent)return;sent=true;this.emit('response',{statusCode:200,headers:{'x-goog-generation':generation}});
        this.push(backupBody);this.push(null);}});}
  };
  const now=Date.now(),recovery=createFirebaseVoiceRecovery({config:{projectId:config.projectId,namespace:config.namespace,backupBucketName:backupName},
    cipher,backupBucket,objects:port,serverClock:()=>now});
  const backupId='50000000-0000-4000-8000-000000000001',retainedUntil=new Date(now+14*86400000).toISOString();
  const backup=await recovery.backupVoice({backupId,scope,voiceId:id,descriptor,retainedUntil});
  assert.equal(backupWrites,1);assert.ok(!backupBody!.includes(Buffer.from(wave(1),'base64')));
  await port.remove(scope,id,descriptor);assert.equal(await port.inspect(scope,id),null);
  const targetScope={...scope,storageEpoch:'60000000-0000-4000-8000-000000000001'};
  await assert.rejects(recovery.restoreVoice({backupId,voiceId:id,scope,descriptor,backup,targetScope:{...targetScope,ownerUserId:'other'}}));
  const restored=await recovery.restoreVoice({backupId,voiceId:id,scope,descriptor,backup,targetScope});
  assert.notEqual(restored.objectName,descriptor.objectName);assert.equal(restored.sha256,descriptor.sha256);
  assert.equal((await port.read(targetScope,id,restored)).base64,wave(1));assert.equal(writes,2);
  await port.remove(targetScope,id,restored);
});
