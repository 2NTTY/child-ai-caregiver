import { readFileSync } from 'node:fs';

const manifest = new URL('../knowledge/fhs-initial-recovery.json', import.meta.url);
export function campaignRecoveryPlan(sourceId) {
  const plan = JSON.parse(readFileSync(manifest, 'utf8'));
  if (plan.campaign !== 'fhs-child-initial-20261120') throw Error('knowledge_campaign_recovery_manifest');
  const entries = plan.entries.filter(e => !sourceId || e.sourceId === sourceId).map(e => ({
    ...e, ...(['review_age_draft','review_pdf_region','resume_prepared'].includes(e.action)
      ? { campaignArgs: ['recover', e.sourceId, e.operationFingerprint] } : {}),
  }));
  if (sourceId && entries.length !== 1) throw Error('knowledge_campaign_recovery_source');
  return { ...plan, entries };
}

if (import.meta.main) {
  const [id, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error('Use fhs-recovery-plan.mjs [SOURCE_ID]');
  console.log(JSON.stringify(campaignRecoveryPlan(id), null, 2));
}
