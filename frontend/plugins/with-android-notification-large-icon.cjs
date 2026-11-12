const fs = require('node:fs/promises');
const path = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { generateImageAsync } = require('@expo/image-utils');

// Expo 57's native builder supports this metadata; its bundled config plugin does not emit it.
module.exports = function withAndroidNotificationLargeIcon(config, { largeIcon } = {}) {
  if (typeof largeIcon !== 'string' || !largeIcon.endsWith('.png')) throw new Error('A local PNG notification large icon is required');
  config = withAndroidManifest(config, mod => {
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults),
      'expo.modules.notifications.large_notification_icon',
      '@drawable/yuyoufang_notification_large_icon',
      'resource'
    );
    return mod;
  });
  return withDangerousMod(config, ['android', async mod => {
    const { source } = await generateImageAsync({
      projectRoot: mod.modRequest.projectRoot,
      cacheType: 'yuyoufang-notification-large-icon',
    }, {
      src: path.resolve(mod.modRequest.projectRoot, largeIcon),
      width: 256,
      height: 256,
      resizeMode: 'contain',
    });
    const target = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/drawable-nodpi');
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(path.join(target, 'yuyoufang_notification_large_icon.png'), source);
    return mod;
  }]);
};
