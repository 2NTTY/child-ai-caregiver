import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAvatarCodec } from '../server/avatar-codec.ts';
import { readAvatarConfig } from '../server/avatar-config.ts';
import { AvatarCodecError } from '../server/avatar-codec-error.ts';

test('Linux codec normalizes oriented private JPEG and transparent PNG, then releases a cancelled child',
  { skip: process.platform !== 'linux', timeout: 30_000 }, async t => {
    assert.equal(process.arch, 'x64');
    const { default: sharp } = await import('sharp');
    const config = readAvatarConfig({}), codec = createAvatarCodec(config.admission);
    const crop = { centerX: .5, centerY: .5, zoom: 1 }, marker = 'Synthetic avatar platform metadata';
    const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
    const width = 64, height = 32, pixels = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 3;
      pixels[offset] = x < width / 2 ? 240 : 10;
      pixels[offset + 1] = 10;
      pixels[offset + 2] = x < width / 2 ? 10 : 240;
    }
    const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .withExif({ IFD0: { Artist: marker } }).withMetadata({ orientation: 6 }).jpeg({ quality: 95 }).toBuffer();
    const png = await sharp({ create: { width: 16, height: 16, channels: 4, background: { r: 240, g: 10, b: 10, alpha: 0 } } }).png().toBuffer();
    const outputs: Buffer[] = [];
    try {
      const source = await sharp(jpeg).metadata();
      assert.equal(source.orientation, 6);assert.ok(source.exif);assert.ok(source.exif.includes(Buffer.from(marker)));
      const normalized = await codec.normalize('synthetic-jpeg', jpeg, 'image/jpeg', crop, config.recipe, new AbortController().signal);
      outputs.push(normalized.buffer);
      assert.equal(normalized.width, 256);assert.equal(normalized.height, 256);assert.equal(normalized.mimeType, 'image/jpeg');
      assert.equal(normalized.bytes, normalized.buffer.length);assert.equal(normalized.sha256, digest(normalized.buffer));
      const metadata = await sharp(normalized.buffer).metadata();
      assert.equal(metadata.width, 256);assert.equal(metadata.height, 256);
      for (const key of ['exif', 'xmp', 'iptc', 'icc', 'orientation'] as const) assert.equal(metadata[key], undefined, key);
      assert.equal(normalized.buffer.includes(Buffer.from(marker)), false);
      const raw = await sharp(normalized.buffer).raw().toBuffer({ resolveWithObject: true });
      const sample = (x: number, y: number) => [...raw.data.subarray((y * raw.info.width + x) * raw.info.channels, (y * raw.info.width + x) * raw.info.channels + 3)];
      const top = sample(128, 64), bottom = sample(128, 192);
      assert.ok(top[0]! > 200 && top[2]! < 50, 'Orientation 6 puts the original left red half at the top');
      assert.ok(bottom[2]! > 200 && bottom[0]! < 50, 'Orientation 6 puts the original right blue half at the bottom');
      raw.data.fill(0);

      const flattened = await codec.normalize('synthetic-png', png, 'image/png', crop, config.recipe, new AbortController().signal);
      outputs.push(flattened.buffer);
      assert.equal(flattened.width, 256);assert.equal(flattened.height, 256);assert.equal(flattened.sha256, digest(flattened.buffer));
      const white = await sharp(flattened.buffer).raw().toBuffer({ resolveWithObject: true });
      const centre = [...white.data.subarray((128 * white.info.width + 128) * white.info.channels, (128 * white.info.width + 128) * white.info.channels + 3)];
      assert.equal(white.info.channels, 3);assert.ok(centre.every(channel => channel >= 250));white.data.fill(0);

      const abort = new AbortController();
      const cancelled = codec.normalize('synthetic-cancel', jpeg, 'image/jpeg', crop, config.recipe, abort.signal);
      assert.deepEqual(codec.state(), { active: 1, queued: 0, actors: 1 });
      abort.abort();
      assert.deepEqual(codec.state(), { active: 1, queued: 0, actors: 1 }, 'Admission stays held until child close');
      const closing = codec.close();
      await assert.rejects(cancelled, error => error instanceof AvatarCodecError && error.code === 'avatar_decode_limit');
      await closing;
      assert.deepEqual(codec.state(), { active: 0, queued: 0, actors: 0 });
      t.diagnostic(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, sharp: sharp.versions.sharp,
        vips: sharp.versions.vips, jpegSha256: normalized.sha256, pngSha256: flattened.sha256, top, bottom, white: centre, cancelledChildClosed: true, codecClosed: true }));
    } finally {
      await codec.close();pixels.fill(0);jpeg.fill(0);png.fill(0);outputs.forEach(buffer => buffer.fill(0));
    }
  });
