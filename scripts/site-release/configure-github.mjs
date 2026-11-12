// One-time operator bootstrap. Normal releases cannot edit environments or repository settings.
import { execFileSync } from 'node:child_process';
const repo = '2NTTY/child-ai-caregiver';
function gh(args, input) {
  return execFileSync('gh', args, { input, encoding:'utf8', stdio:['pipe','pipe','inherit'] }).trim();
}
const api = (path) => JSON.parse(gh(['api', 'repos/'+repo+path]));
const send = (method, path, data) => gh(['api','--method',method,'repos/'+repo+path,'--input','-'],JSON.stringify(data));
const action = process.argv[2];
if (!['init','enable-schedule'].includes(action)) throw Error('Expected init or enable-schedule');
if (api('').id !== 1377602504 || !api('/branches/master').protected) throw Error('Expected protected master on the official repository');
if (action === 'init') {
  const envs=api('/environments?per_page=100').environments;
  for (const name of ['site-observe','site-publish']) {
    const path='/environments/'+name;
    const existing=envs.find(env=>env.name===name);
    if (!existing) send('PUT',path,{deployment_branch_policy:{protected_branches:false,custom_branch_policies:true}});
    const config=api(path);
    if (!config.deployment_branch_policy?.custom_branch_policies) throw Error('Existing environment needs master-only deployment branch policy: '+name);
    const rules=api(path+'/deployment-branch-policies').branch_policies;
    if (rules.some(p=>p.name!=='master' || p.type!=='branch')) throw Error('Review other branch rules in '+name);
    if (!rules.length) send('POST',path+'/deployment-branch-policies',{name:'master',type:'branch'});
  }
  for (const key of ['EXPO_PUBLIC_FIREBASE_API_KEY','EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN','EXPO_PUBLIC_FIREBASE_PROJECT_ID','EXPO_PUBLIC_FIREBASE_APP_ID','EXPO_PUBLIC_AUTH_PROVIDERS','EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL']) {
    const value=process.env[key];
    if (typeof value !== 'string' || /[\r\n]/.test(value) || (!value && key!=='EXPO_PUBLIC_AUTH_PROVIDERS')) throw Error('Supply public production Web SDK setting '+key);
    if (key==='EXPO_PUBLIC_FIREBASE_PROJECT_ID' && value!=='ai-caregivers-for-children') throw Error('Wrong Firebase project');
    if (key==='EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL' && value!=='false') throw Error('Expected existing legacy-trial policy');
    if (key==='EXPO_PUBLIC_AUTH_PROVIDERS' && value.split(',').filter(Boolean).some(p=>!['google.com','apple.com'].includes(p))) throw Error('Unexpected auth provider');
    // Browser API key is public at runtime; keep the GitHub configuration value masked.
    if (value) gh([key.endsWith('_API_KEY')?'secret':'variable','set',key,'--repo',repo],value);
    else if (api('/actions/variables?per_page=100').variables.some(v=>v.name===key)) gh(['variable','delete',key,'--repo',repo]);
  }
} else {
  const runs=api('/actions/workflows/site-release.yml/runs?branch=master&event=workflow_dispatch&status=success&per_page=10').workflow_runs;
  if (!runs.length) throw Error('First complete a successful manual production release');
  const {readRemoteStatus}=await import('./cli.mjs');
  const snapshot=await readRemoteStatus();
  if (snapshot.status?.lastResult!=='deployed' || !snapshot.status.receipt || snapshot.status.receipt.result!=='deployed'
        || !runs.some(run=>run.id===snapshot.provenance?.runId)) throw Error('Latest manual acceptance must have a deployed host receipt');
  gh(['variable','set','SITE_DAILY_ENABLED','--repo',repo],'true');
}
console.log('Verified website '+action+' configuration for '+repo);
