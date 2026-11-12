// Read-only release prerequisite; Node built-ins only, no installed SDK needed.
// Official REST schemas checked 2026-11-12:
// https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.indexes/list
// https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.fields
const resource = 'projects/ai-caregivers-for-children/databases/yuban-firebase-20261011';
const base = 'https://firestore.googleapis.com/v1/' + resource;
const error = (reason, code = null) => Object.assign(new Error(reason), { code });

export async function releaseCheck(desired, { shape, canonical, token = process.env.SITE_ACCESS_TOKEN, fetchImpl = globalThis.fetch }) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9._~+/=-]{1,16384}$/u.test(token)) throw error('site_access_token_required');
  const deadline = Date.now() + 120_000;
  const report = { mode: '--release-check', state: 'ready', indexes: desired.indexes.length, fieldOverrides: desired.fieldOverrides.length,
    pages: 0, missing: 0, pending: 0, failed: 0, fieldProblems: 0 };
  async function get(url, allowMissing = false) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw error('firestore_check_deadline');
    let response;
    try {
      response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
        signal: AbortSignal.timeout(Math.min(15_000, remaining)) });
    } catch {
      throw error('firestore_transport_failed');
    }
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
    if (!response.ok) {
      await response.body?.cancel();
      throw error(response.status === 403 ? 'firestore_permission_denied' : response.status === 401 ? 'firestore_unauthenticated' : 'firestore_request_failed', response.status);
    }
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > 2 * 1024 * 1024) throw error('firestore_response_too_large');
        chunks.push(chunk);
      }
      const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw error('firestore_response_invalid');
      return value;
    } catch (cause) {
      throw error(cause?.message === 'firestore_response_too_large' ? cause.message : 'firestore_response_invalid');
    }
  }

  const current = [], tokens = new Set();
  let pageToken = '';
  do {
    if (report.pages >= 100) throw error('firestore_pagination_bound');
    const url = new URL(base + '/collectionGroups/-/indexes');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const page = await get(url);
    report.pages++;
    if (page.indexes !== undefined && !Array.isArray(page.indexes)) throw error('firestore_response_invalid');
    current.push(...(page.indexes ?? []));
    if (current.length > 10_000) throw error('firestore_pagination_bound');
    pageToken = page.nextPageToken ?? '';
    if (typeof pageToken !== 'string' || pageToken.length > 4096 || pageToken && tokens.has(pageToken)) throw error('firestore_pagination_invalid');
    if (pageToken) tokens.add(pageToken);
  } while (pageToken);

  try {
    for (const expected of desired.indexes) {
      const prefix = resource + '/collectionGroups/' + expected.collectionGroup + '/indexes/';
      const matches = current.filter(actual => typeof actual.name === 'string' && actual.name.startsWith(prefix) && shape(actual) === shape(expected));
      if (!matches.length) report.missing++;
      else if (!matches.some(actual => actual.state === 'READY')) {
        if (matches.some(actual => actual.state === 'NEEDS_REPAIR')) report.failed++;
        else report.pending++;
      }
    }
  } catch {
    throw error('firestore_response_invalid');
  }

  // Six bounded workers avoid serial round trips for the checked-in exclusions.
  let nextField = 0;
  let stopped = false;
  await Promise.all(Array.from({ length: Math.min(6, desired.fieldOverrides.length) }, async () => {
    try {
      while (!stopped && nextField < desired.fieldOverrides.length) {
        const expected = desired.fieldOverrides[nextField++];
        const field = await get(base + '/collectionGroups/' + encodeURIComponent(expected.collectionGroup) + '/fields/' + encodeURIComponent(expected.fieldPath) + '?fields=name,indexConfig', true);
        const config = field?.indexConfig;
        if (!config || config.usesAncestorConfig === true || config.reverting === true) { report.fieldProblems++; continue; }
        if (config.indexes !== undefined && !Array.isArray(config.indexes)) throw error('firestore_response_invalid');
        const actual = (config.indexes ?? []).map(index => {
          if (!Array.isArray(index.fields)) throw error('firestore_response_invalid');
          const indexed = index.fields.find(value => value.fieldPath === expected.fieldPath);
          return { queryScope: index.queryScope, ...(indexed?.order ? { order: indexed.order } : {}), ...(indexed?.arrayConfig ? { arrayConfig: indexed.arrayConfig } : {}) };
        });
        if (canonical(actual.map(canonical).sort()) !== canonical(expected.indexes.map(canonical).sort())
          || (config.indexes ?? []).some(index => index.state !== 'READY')) report.fieldProblems++;
      }
    } catch (cause) {
      stopped = true;
      throw cause;
    }
  }));
  if (report.missing || report.pending || report.failed || report.fieldProblems) report.state = 'not_ready';
  return report;
}
