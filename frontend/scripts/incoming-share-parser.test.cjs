const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('pinned raw Android parser prioritizes streams and never classifies a stream as text', () => {
  const pkg = require.resolve('expo-sharing/package.json');
  assert.equal(JSON.parse(fs.readFileSync(pkg, 'utf8')).version, '57.0.21');
  const source = fs.readFileSync(path.join(path.dirname(pkg), 'android/src/main/java/expo/modules/sharing/dataParsers/SimpleShareIntentDataParser.kt'), 'utf8');
  const single = source.slice(source.indexOf('private fun handleSendAction'), source.indexOf('private fun handleSendMultipleAction'));
  assert.match(single, /getParcelableExtraCompat<Uri>\(Intent.EXTRA_STREAM\)[\s\S]*if \(uri != null\) return listOf\(createUriPayload\(context, uri, type\)\)[\s\S]*type == "text\/plain"/);
  assert.match(source, /ShareType.fromMimeType\(specificType\)\.let \{ if \(it == ShareType.Text\) ShareType.File else it \}/);
  assert.doesNotMatch(source, /HttpURLConnection|resolveUrlContext/);
});
