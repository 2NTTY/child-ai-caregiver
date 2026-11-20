import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { campaignMaterialWatches, externalMaterialWatches, fhsMaterialWatches } from '../server/platform-materials.ts';
import { campaign, campaignLimitMicros } from '../server/knowledge-campaign-budget.ts';
import { campaignRecoveryPlan } from './fhs-recovery-plan.mjs';

// Each step reopens the same gross ledger and the durable work for the registered source.
const inventory = JSON.parse(readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
const priority = ('14799 14743 15667 12146 15666 15669 12172 15686 15663 15664 13041 30152 12549 30010 13043 30009 14851 15648 15650 15678 15697 20033 30017')
  .split(' ').map(id => 'fhs-' + id);
const items = new Map(inventory.items.map(item => [item.id, item]));
const pdfs = new Map(inventory.pdfOriginals.map(item => [item.url, item]));
const seen = new Set();
const args = process.argv.slice(2);
const waitForDaily = args[0] === '--wait-for-daily';
if (waitForDaily) args.shift();
const onlyExternal = args[0] === '--only-external';
if (onlyExternal) args.shift();
const recoverHeld = args[0] === '--recover-held';
if (recoverHeld) args.shift();
const recoveries = new Map(recoverHeld ? campaignRecoveryPlan().entries
  .filter(entry => entry.campaignArgs)
  .map(entry => [entry.sourceId, entry.campaignArgs]) : []);
const repairs = new Map();
const repairOnly = args[0] === '--repair-truncated';
if (recoverHeld && (onlyExternal || repairOnly || !recoveries.size)) throw Error('Use --recover-held on the checkpoint recovery queue');
if (repairOnly) {
  args.shift();
  const checkpoint = JSON.parse(readFileSync(args.shift(), 'utf8'));
  if (checkpoint.campaign !== campaign || checkpoint.grossCapUsd * 1e6 !== campaignLimitMicros) throw Error('Unexpected campaign receipt');
  for (const entry of checkpoint.entries) {
    if (entry.outcome !== 'candidate_held' || entry.code !== 'model_output_limit') continue;
    if (repairs.has(entry.sourceId) || !campaignMaterialWatches.some(w => w.id === entry.sourceId)
      || !/^[a-f0-9]{64}$/u.test(entry.operationFingerprint)) throw Error('Unexpected truncated source receipt');
    repairs.set(entry.sourceId, entry.operationFingerprint);
  }
}
const [resumeFlag, resumeId, fingerprint, ...extra] = args;
const fromDeferred = resumeFlag === '--from-deferred';
if (resumeFlag !== undefined && ((!fromDeferred && resumeFlag !== '--after') || !campaignMaterialWatches.some(source => source.id === resumeId)
  || (fromDeferred ? recoverHeld || repairOnly || !/^[a-f0-9]{64}$/u.test(fingerprint ?? '') : fingerprint !== undefined) || extra.length)) {
  throw Error('Use --from-deferred SOURCE_ID ORIGINAL_FINGERPRINT or --after SOURCE_ID after a terminal receipt');
}
let resumed = resumeFlag === undefined;
const familyHealth = [...fhsMaterialWatches].sort((a, b) => {
  const rank = id => priority.includes(id) ? priority.indexOf(id) : priority.length;
  return rank(a.id) - rank(b.id) || Number(a.kind === 'pdf') - Number(b.kind === 'pdf')
    || (pdfs.get(a.url)?.pages ?? 0) - (pdfs.get(b.url)?.pages ?? 0);
});
// Keep the original FHS order stable when resuming an earlier run by its terminal receipt.
const external = [...externalMaterialWatches].sort((a, b) => pdfs.get(a.url).pages - pdfs.get(b.url).pages);
const sources = onlyExternal ? external : [...external, ...familyHealth];
for (const source of sources) {
  if (recoverHeld && !recoveries.has(source.id)) continue;
  if (repairOnly && !repairs.has(source.id)) continue;
  const hash = items.get(source.id)?.textHash ?? pdfs.get(source.url)?.sha256 ?? source.url;
  if (seen.has(hash)) continue;
  seen.add(hash);
  if (!resumed) {
    if (source.id !== resumeId) continue;
    resumed = true;
    if (!fromDeferred) continue;
  }
  const action = fromDeferred && source.id === resumeId ? ['resume-age-checked', source.id, fingerprint]
    : recoverHeld ? recoveries.get(source.id) : repairOnly ? ['repair-truncated', source.id, repairs.get(source.id)] : ['process-age-checked', source.id];
  let status;
  do {
    const nextDay = new Date();
    nextDay.setUTCHours(24, 0, 2, 0);
    const step = spawnSync(process.execPath, [fileURLToPath(new URL('./fhs-initial-campaign.mjs', import.meta.url)), ...action], { stdio: 'inherit' });
    status = step.status ?? 1;
    if (status === 4 && waitForDaily) {
      console.log(JSON.stringify({ deferredSource: source.id, resumeAt: nextDay.toISOString() }));
      await delay(Math.max(2000, nextDay.getTime() - Date.now()));
    }
  } while (status === 4 && waitForDaily);
  if (status !== 0 && status !== 3) { process.exitCode = status; break; }
}
if (!resumed) throw Error('Resume source was not a distinct material in the approved sequence');
