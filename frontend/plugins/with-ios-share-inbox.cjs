const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const plist = require('@expo/plist').default;
const { withFinalizedMod, withXcodeProject } = require('expo/config-plugins');

// Expo Sharing owns the target, signing entitlements, embedding and activation rules.
// Substitute its open-parent controller with the product's offline, return-to-host receiver.
module.exports = function withIosShareInbox(config) {
  const targetName = 'expo-sharing-extension';
  const source = path.join(__dirname, 'ios-share', 'ShareIntoViewController.swift');
  // Expo fingerprints the resolved app config and plugin JS. Include the Swift input as well.
  const revision = createHash('sha256').update(fs.readFileSync(source, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  config.ios = { ...config.ios, infoPlist: { ...config.ios?.infoPlist, YuyoufangShareReceiverRevision: revision } };
  config = withXcodeProject(config, mod => {
    const settings = Object.values(mod.modResults.pbxXCBuildConfigurationSection())
      .map(section => section.buildSettings)
      .filter(section => section?.CODE_SIGN_ENTITLEMENTS?.replaceAll('"', '') === `${targetName}/${targetName}.entitlements`);
    if (!settings.length) throw new Error('Missing Expo Sharing extension target');
    for (const section of settings) section.APPLICATION_EXTENSION_API_ONLY = 'YES';
    return mod;
  });
  return withFinalizedMod(config, ['ios', mod => {
    const target = path.join(mod.modRequest.platformProjectRoot, targetName);
    const plistPath = path.join(target, 'Info.plist');
    const info = plist.parse(fs.readFileSync(plistPath, 'utf8'));
    if (info.NSExtension?.NSExtensionPrincipalClass !== '$(PRODUCT_MODULE_NAME).ShareIntoViewController') {
      throw new Error('Unrecognized Expo Sharing receiver');
    }
    fs.copyFileSync(source, path.join(target, 'ShareIntoViewController.swift'));
    fs.writeFileSync(plistPath, plist.build({ ...info, CFBundleDisplayName: '育有方' }));
    return mod;
  }]);
};
