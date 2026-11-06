'use strict';
// Resolves installed entry points and reads package metadata only. No package import.
const {createRequire}=require('node:module');
const fs=require('node:fs');
const project=createRequire('/project/package.json');
const frontend=createRequire('/project/frontend/package.json');
const expo=createRequire(frontend.resolve('expo/package.json'));
const requests=[
  ['typescript',project],['expo',frontend],['react',frontend],
  ['react-native',frontend],['@expo/metro-config',expo],['@expo/cli',expo],
];
const output={};
for(const [name,resolver] of requests){
  const packageJson=resolver.resolve(name+'/package.json');
  const entry=resolver.resolve(name);
  const data=JSON.parse(fs.readFileSync(packageJson,'utf8'));
  output[name]={packageJson,entry,version:data.version};
}
process.stdout.write(JSON.stringify(output)+'\n');
