import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, copyFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import sharp from 'sharp';

const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const app=JSON.parse(readFileSync(join(root,'frontend/app.json'),'utf8')).expo;

test('Android notification mods produce separate monochrome small and local colour large icons without a service', async () => {
  const notifications=app.plugins.find(value=>Array.isArray(value)&&value[0]==='expo-notifications')[1];
  assert.equal(notifications.icon,'./assets/brand/notification-small.png');
  assert.equal(notifications.defaultChannel,'yuyoufang-reminders');
  const custom=app.plugins.find(value=>Array.isArray(value)&&value[0]==='./plugins/with-android-notification-large-icon.cjs');
  assert.ok(custom,'The local large icon must be configured for the installed Expo 57 builder');
  assert.equal(custom[1].largeIcon,app.android.icon);
  const pixels=await sharp(join(root,'frontend',notifications.icon)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  assert.deepEqual([pixels.info.width,pixels.info.height],[96,96]);
  let visible=0,transparent=0;
  for(let index=0;index<pixels.data.length;index+=4) {
    if(pixels.data[index+3]) { visible++;assert.deepEqual([...pixels.data.subarray(index,index+3)],[255,255,255]); }
    else transparent++;
  }
  assert.ok(visible>100&&transparent>100,'The small icon must be a transparent glyph, not an opaque square');
  const cache=join(root,'.cache/native-notification-icons-check');await mkdir(cache,{recursive:true});
  const project=await mkdtemp(join(cache,'project-')),main=join(project,'android/app/src/main');
  await mkdir(join(main,'res/values'),{recursive:true});
  await writeFile(join(project,'package.json'),JSON.stringify({name:'notification-icons-fixture',version:'1.0.0'}));
  await writeFile(join(main,'AndroidManifest.xml'),'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="org.yuyoufang.app"><application android:name=".MainApplication" /></manifest>');
  await writeFile(join(main,'res/values/colors.xml'),'<resources />');
  for(const path of [notifications.icon,custom[1].largeIcon]) {
    const target=join(project,path);await mkdir(dirname(target),{recursive:true});await copyFile(join(root,'frontend',path),target);
  }
  const {compileModsAsync,AndroidConfig}=require('expo/config-plugins');
  const {withNotificationsAndroid,dpiValues}=require('expo-notifications/plugin/build/withNotificationsAndroid.js');
  const withLargeIcon=require(join(root,'frontend',custom[0]));
  let config={name:'Notification icons fixture',slug:'notification-icons-fixture',android:{package:app.android.package}};
  config=withNotificationsAndroid(config,notifications);config=withLargeIcon(config,custom[1]);
  // Expo's icon generator resolves its relative src from the prebuild command's project cwd.
  const previousDirectory=process.cwd();
  try { process.chdir(project);await compileModsAsync(config,{projectRoot:project,platforms:['android']}); }
  finally { process.chdir(previousDirectory); }
  const manifest=await AndroidConfig.Manifest.readAndroidManifestAsync(join(main,'AndroidManifest.xml'));
  const application=AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  const metadata=Object.fromEntries(application['meta-data'].map(item=>[item.$['android:name'],item.$]));
  for(const key of ['com.google.firebase.messaging.default_notification_icon','expo.modules.notifications.default_notification_icon'])
    assert.equal(metadata[key]['android:resource'],'@drawable/notification_icon');
  assert.equal(metadata['com.google.firebase.messaging.default_notification_channel_id']['android:value'],'yuyoufang-reminders');
  assert.equal(metadata['expo.modules.notifications.large_notification_icon']['android:resource'],'@drawable/yuyoufang_notification_large_icon');
  assert.equal(application.service,undefined,'Config must reuse the existing Expo service');
  for(const {folderName}of Object.values(dpiValues)) {
    const resource=await sharp(join(main,'res',folderName.replace('mipmap','drawable'),'notification_icon.png')).metadata();
    assert.equal(resource.format,'png');
  }
  const large=join(main,'res/drawable-nodpi/yuyoufang_notification_large_icon.png');
  const largeMeta=await sharp(large).metadata(),largeStats=await sharp(large).stats();
  assert.deepEqual([largeMeta.width,largeMeta.height],[256,256]);
  assert.ok(largeStats.channels.some(channel=>channel.min<150&&channel.max>200),'The large icon must retain brand colours');
  assert.ok((await readdir(join(main,'res/drawable-nodpi'))).includes('yuyoufang_notification_large_icon.png'));
});
