import { readFile } from 'node:fs/promises';
import { GoogleAuth } from 'google-auth-library';

// Additive operator entry: leaves every unmanaged index, TTL and other database setting intact.
// Inspect first; applying index definitions is a separately authorized cloud mutation.
const mode = process.argv[2];
const base = 'https://firestore.googleapis.com/v1/projects/ai-caregivers-for-children/databases/yuban-firebase-20261011';
const canonical = value => JSON.stringify(sort(value));
function sort(value) { return Array.isArray(value) ? value.map(sort) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])])) : value; }
function shape(index) { return canonical({ queryScope: index.queryScope, fields: index.fields.filter(field => field.fieldPath !== '__name__') }); }
try {
  if (!['--inspect', '--approved-apply', '--approved-fields'].includes(mode) || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('explicit_mode_and_credentials_required');
  const client = await new GoogleAuth({ keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
  const desired = JSON.parse(await readFile(new URL('../deploy/firebase/firestore.indexes.json', import.meta.url), 'utf8'));
  const current = (await client.request({ url: base + '/collectionGroups/-/indexes', retry: false })).data;
  if (current.nextPageToken || (current.indexes?.length ?? 0) > 200) throw Error('index_listing_bound');
  const missing = [], building = [];
  for (const entry of desired.indexes) {
    if (!/^yuban_authority_[a-z_]+$/u.test(entry.collectionGroup)) throw Error('index_collection_scope');
    const found = current.indexes?.find(value => value.name.includes('/collectionGroups/' + entry.collectionGroup + '/') && shape(value) === shape(entry));
    if (!found) missing.push(entry); else if (found.state !== 'READY') building.push({ collection: entry.collectionGroup, state: found.state });
  }
  console.info(JSON.stringify({ mode, desired: desired.indexes.length, missing: missing.length, building }));
  if (mode !== '--inspect') {
    for (const entry of mode === '--approved-apply' ? missing : []) {
      const { collectionGroup, ...body } = entry;
      const operation = (await client.request({ method: 'POST', url: base + '/collectionGroups/' + collectionGroup + '/indexes', data: body, retry: false })).data;
      console.info(JSON.stringify({ addedCollection: collectionGroup, accepted: Boolean(operation.name) }));
    }
    // Same checked-in private-field exclusions, not a new index policy. No TTL field is included in updateMask.
    for (const entry of desired.fieldOverrides) {
      if (!/^yuban_authority(?:_[a-z_]+)?$/u.test(entry.collectionGroup)
        || !(entry.fieldPath === '*' || /^[a-zA-Z][a-zA-Z0-9_]*$/u.test(entry.fieldPath))
        || !Array.isArray(entry.indexes)) throw Error('field_exemption_scope');
      // F05 metadata cursors require explicit indexes under collection-wide exclusions.
      const f05Field = ['yuban_authority_knowledge_versions:versionId', 'yuban_authority_knowledge_observations:lastSuccessfulCheckAt',
        'yuban_authority_knowledge_checks:checkedAt', 'yuban_authority_work_watches:enabled', 'yuban_authority_erasures:state'].includes(entry.collectionGroup + ':' + entry.fieldPath);
      if (entry.indexes.length && !f05Field) continue;
      const url = base + '/collectionGroups/' + entry.collectionGroup + '/fields/' + entry.fieldPath;
      const field = (await client.request({ url, retry: false })).data;
      const actual = (field.indexConfig?.indexes ?? []).map(({ queryScope, fields }) => {
        const indexed = fields?.find(value => value.fieldPath === entry.fieldPath);
        return { queryScope, ...(indexed?.order ? { order: indexed.order } : {}), ...(indexed?.arrayConfig ? { arrayConfig: indexed.arrayConfig } : {}) };
      });
      if (field.indexConfig && field.indexConfig.usesAncestorConfig !== true && canonical(actual) === canonical(entry.indexes)) continue;
      // Firebase CLI field overrides are shorthand; the REST API requires Index.fields.
      const indexes = entry.indexes.map(({ queryScope, ...configuration }) => ({ queryScope, fields: [{ fieldPath: entry.fieldPath, ...configuration }] }));
      const operation = (await client.request({ method: 'PATCH', url, params: { updateMask: 'indexConfig' }, data: { indexConfig: { indexes } }, retry: false })).data;
      console.info(JSON.stringify({ configuredCollection: entry.collectionGroup, field: entry.fieldPath, accepted: Boolean(operation.name) }));
    }
  }
} catch (error) {
  console.error(JSON.stringify({ state: 'stopped', code: error?.code ?? error?.response?.status ?? null,
    reason: error?.constructor === Error && /^[a-z_]+$/u.test(error.message) ? error.message : null })); process.exitCode = 1;
}
