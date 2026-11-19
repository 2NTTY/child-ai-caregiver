import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { campaignMaterialWatches, externalMaterialWatches, fhsMaterialWatches } from '../server/platform-materials.ts';

// Each step reopens the same gross ledger and the durable work for the registered source.
const inventory = JSON.parse(readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
const priority = ('14799 14743 15667 12146 15666 15669 12172 15686 15663 15664 13041 30152 12549 30010 13043 30009 14851 15648 15650 15678 15697 20033 30017')
  .split(' ').map(id => 'fhs-' + id);
const items = new Map(inventory.items.map(item => [item.id, item]));
const pdfs = new Map(inventory.pdfOriginals.map(item => [item.url, item]));
const seen = new Set();
const args = process.argv.slice(2);
const onlyExternal = args[0] === '--only-external';
if (onlyExternal) args.shift();
const [resumeFlag, resumeId, ...extra] = args;
if (resumeFlag !== undefined && (resumeFlag !== '--after' || !campaignMaterialWatches.some(source => source.id === resumeId) || extra.length)) {
  throw Error('Use --after SOURCE_ID to resume after an inspected terminal receipt');
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
  const hash = items.get(source.id)?.textHash ?? pdfs.get(source.url)?.sha256 ?? source.url;
  if (seen.has(hash)) continue;
  seen.add(hash);
  if (!resumed) {
    if (source.id === resumeId) resumed = true;
    continue;
  }
  const step = spawnSync(process.execPath, [fileURLToPath(new URL('./fhs-initial-campaign.mjs', import.meta.url)), 'process', source.id],
    { stdio: 'inherit' });
  if (step.status === 3) continue;
  if (step.status !== 0) { process.exitCode = step.status ?? 1; break; }
}
if (!resumed) throw Error('Resume source was not a distinct material in the approved sequence');
