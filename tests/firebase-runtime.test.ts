import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';

test('production Firebase composition constructs real SDK clients without SQL configuration or seeded authority', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'yuban-f01-'));
  const key = join(directory, 'synthetic.key');
  await writeFile(key, randomBytes(32).toString('base64'), { mode: 0o600 });
  let runtime: Awaited<ReturnType<typeof openFirebaseRuntime>> | undefined;
  try {
    runtime = await openFirebaseRuntime({ NODE_ENV: 'production', SERVER_ORIGIN: 'https://synthetic.example.test',
      GCP_PROJECT_ID: 'synthetic-care-project', FIREBASE_DATABASE_ID: 'synthetic-care',
      FIREBASE_NAMESPACE: 'synthetic_care', STORAGE_KEY_FILE: key });
    const response = await runtime.handler(new Request('https://synthetic.example.test/healthz'));
    assert.deepEqual(await response.json(), { status: 'ok', storage: 'firestore', stage: 'foundation' });
    assert.equal(runtime.database.databaseId, 'synthetic-care');
    assert.equal('databaseUrl' in runtime.config, false);
    const anonymous = await runtime.handler(new Request('https://synthetic.example.test/api/children'));
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).error.code, 'unauthorized');
    assert.equal(typeof runtime.online.submit, 'function');
    const unsupported = await runtime.handler(new Request('https://synthetic.example.test/api/children/00000000-0000-4000-8000-000000000001/documents'));
    assert.equal(unsupported.status, 503);
    assert.equal((await unsupported.json()).error.code, 'firebase_domain_not_ready');
    const first = runtime.close(); assert.equal(runtime.close(), first); await first;
  } finally { await runtime?.close(); await rm(directory, { recursive: true, force: true }); }
});
