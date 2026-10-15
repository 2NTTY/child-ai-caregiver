import { parentPort, workerData } from "node:worker_threads";

// This worker accepts a bounded in-memory file only. No URL, decoder or model is involved.
let input;
try {
  const { Input, BufferSource, MP4, WEBM, OGG, WAVE, MP3, EncodedPacketSink } = await import(workerData.parserUrl);
  input = new Input({ formats: [MP4, WEBM, OGG, WAVE, MP3], source: new BufferSource(workerData.bytes) });
  const tracks = await input.getTracks();
  if (tracks.length !== 1 || tracks[0].type !== "audio") throw new Error("invalid_tracks");
  const track = tracks[0], sink = new EncodedPacketSink(track);
  const first = await sink.getFirstPacket({ skipLiveWait: true });
  let end = await input.computeDuration(tracks, { skipLiveWait: true });
  const format = await input.getFormat();
  if (format === WEBM) {
    if (await track.getCodec() !== "opus") throw new Error("unsupported_webm_codec");
    // MediaRecorder WebM omits DefaultDuration/last BlockDuration. Mediabunny 1.61.5
    // then reports a zero-length final packet. RFC 6716 section 3 supplies its duration.
    let previous = -Infinity, count = 0;
    for await (const packet of sink.packets(undefined, undefined, { skipLiveWait: true })) {
      if (++count > 50_000 || packet.timestamp <= previous || !packet.data.length) throw new Error("invalid_packets");
      previous = packet.timestamp;
      const config = packet.data[0] >> 3, code = packet.data[0] & 3;
      if (code === 3 && packet.data.length < 2) throw new Error("invalid_opus");
      const frames = code === 0 ? 1 : code === 3 ? packet.data[1] & 63 : 2;
      const frameMs = config >= 16 ? 2.5 * 2 ** (config & 3) : config >= 12 ? 10 * 2 ** (config & 1) : [10, 20, 40, 60][config & 3];
      const duration = frames * frameMs;
      if (duration < 2.5 || duration > 120) throw new Error("invalid_opus");
      end = Math.max(end, packet.timestamp + duration / 1000);
    }
  }
  const channels = await track.getNumberOfChannels(), sampleRate = await track.getSampleRate();
  if (!first || !Number.isFinite(first.timestamp) || Math.abs(first.timestamp) > 0.25
    || !Number.isFinite(end) || end <= 0 || channels < 1 || channels > 2 || sampleRate < 8000 || sampleRate > 192000)
    throw new Error("invalid_audio");
  const mimeType = format === MP4 ? "audio/mp4" : format === WEBM ? "audio/webm" : format === OGG ? "audio/ogg"
    : format === WAVE ? "audio/wav" : format === MP3 ? "audio/mpeg" : null;
  if (!mimeType) throw new Error("unsupported_audio");
  // Count any negative codec pre-roll conservatively; never trust a declared container duration.
  parentPort.postMessage({ mimeType, durationMs: Math.ceil((end - Math.min(0, first.timestamp)) * 1000) });
} catch {
  parentPort.postMessage({ invalid: true });
} finally { input?.dispose(); }
