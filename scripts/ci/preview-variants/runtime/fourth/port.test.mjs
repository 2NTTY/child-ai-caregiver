import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {realm,binding,owner} from './realm.mjs';
const root=resolve(process.env.PROJECT_UNDER_TEST);
const runtime=await import(pathToFileURL(resolve(process.env.RUNTIME_UNDER_TEST)));
test('Fourth profile admits its real photo-owner shape and keeps all other unknown roles refused',()=>{
 const {r}=realm(),c=runtime.createSyntheticPreviewRuntime(r,{variant:'fourth',case:'normal'});c.install();
 const b=binding('fourth');c.observeBinding(b);c.registerOwner(owner().o,b);
 assert.equal(c.snapshot().variant,'fourth');assert.equal(c.snapshot().ownerProfile,'fourth-native-photo-owner-v1');
 for(const variant of ['original','harbour','unknown'])assert.throws(()=>runtime.createSyntheticPreviewRuntime(realm().r,{variant,case:'normal'}),/CONTROL_CONFIG/);
});
test('Fourth entry preserves router ordering while selecting the long-lived prelude and native root',()=>{
 const src=readFileSync(resolve(root,'frontend/index.js'),'utf8');
 assert.ok(src.includes('import "./src/preview/synthetic-preview-entry.mjs";'));
 assert.ok(src.includes('import "./src/preview/synthetic-preview-root.mjs";'));
 assert.ok(src.indexOf('synthetic-preview-entry.mjs')<src.indexOf('./src/platform/runtime'));
 assert.ok(src.indexOf('@expo/metro-runtime')<src.indexOf('synthetic-preview-root.mjs'));
 assert.ok(src.indexOf('synthetic-preview-root.mjs')<src.indexOf('import "expo-router/entry"'));
 assert.equal(src.includes('workbench-normal-source-entry.mjs'),false);
});
