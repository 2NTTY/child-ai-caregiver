const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const plist = require('@expo/plist').default;
const { compileModsAsync, withPlugins } = require('expo/config-plugins');

test('iOS prebuild embeds an extension-safe receiver with the same App Group as the main app', async t => {
  const { default: configure } = await import('../app.config.js');
  const root = path.resolve(__dirname, '..');
  const config = configure({ config: require('../app.json').expo });
  const sharing = config.plugins.find(entry => entry[0] === 'expo-sharing');
  assert.equal(sharing[1].ios.enabled, true);
  const group = 'group.org.yuyoufang.app';
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yuyoufang-share-prebuild-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  execFileSync('tar', ['-xf', path.join(path.dirname(require.resolve('expo/package.json')), 'template.tgz'),
    '-C', scratch, '--strip-components=1', 'package/ios']);
  const plugin = './plugins/with-ios-share-inbox.cjs';
  assert.ok(config.plugins.includes(plugin));
  const native = withPlugins({ ...config, _internal: { projectRoot: root } },
    config.plugins.filter(p => p === sharing || p === plugin));
  await compileModsAsync(native, { projectRoot: scratch, platforms: ['ios'] });
  const ios = path.join(scratch, 'ios');
  const target = path.join(ios, 'expo-sharing-extension');
  const info = plist.parse(fs.readFileSync(path.join(target, 'Info.plist'), 'utf8'));
  assert.equal(info.AppGroupId, group);
  assert.equal(info.CFBundleDisplayName, '育有方');
  assert.equal(info.NSExtension.NSExtensionPointIdentifier, 'com.apple.share-services');
  assert.equal(info.NSExtension.NSExtensionAttributes.NSExtensionActivationRule.NSExtensionActivationSupportsFileWithMaxCount, 20);
  for (const file of [path.join(target, 'expo-sharing-extension.entitlements'), path.join(ios, 'HelloWorld', 'HelloWorld.entitlements')]) {
    assert.ok(plist.parse(fs.readFileSync(file, 'utf8'))['com.apple.security.application-groups'].includes(group));
  }
  const project = require('xcode').project(path.join(ios, 'HelloWorld.xcodeproj', 'project.pbxproj')).parseSync();
  const sections = project.hash.project.objects;
  const extension = Object.values(sections.PBXNativeTarget).find(value => value.productType === '"com.apple.product-type.app-extension"');
  assert.ok(extension);
  const app = project.getFirstTarget().firstTarget;
  const embeds = app.buildPhases.map(ref => sections.PBXCopyFilesBuildPhase[ref.value]).filter(Boolean);
  assert.ok(embeds.some(phase => String(phase.dstSubfolderSpec) === '13' &&
    phase.files.some(ref => sections.PBXBuildFile[ref.value].fileRef === extension.productReference)));
  const builds = sections.XCConfigurationList[extension.buildConfigurationList].buildConfigurations;
  assert.ok(builds.every(ref => sections.XCBuildConfiguration[ref.value].buildSettings.APPLICATION_EXTENSION_API_ONLY === 'YES'));
  const swift = fs.readFileSync(path.join(target, 'ShareIntoViewController.swift'), 'utf8');
  assert.equal(swift, fs.readFileSync(path.join(root, 'plugins', 'ios-share', 'ShareIntoViewController.swift'), 'utf8'));
  assert.equal(native.ios.infoPlist.YuyoufangShareReceiverRevision, createHash('sha256').update(swift.replace(/\r\n/g, '\n')).digest('hex'));
  assert.doesNotMatch(swift, /UIApplication|openParentApp|openURL/);
});
