import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertLocalAgentEnvironment } from '../server/local-agent-config.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

export function assertLocalDemoBootstrap(env, root, state) {
  const config = assertLocalAgentEnvironment(env);
  const fingerprint = createHash('sha256').update(root).digest('hex').slice(0, 8);
  if (env.AI_ENABLED !== 'false' || state.format !== 1 || state.projectId !== 'demo-yuyf-' + fingerprint
    || state.projectId !== config.projectId || state.email !== 'developer@local.yuyoufang.test'
    || state.storageKey !== env.YUBAN_FIREBASE_STORAGE_KEY
    || resolve(env.LOCAL_AGENT_STATE_FILE ?? '') !== join(root, '.cache', 'agent-local', 'state.json'))
    throw Error('Notification demo requires this checkout synthetic account, local emulators and --no-model');
  return config;
}

/** Explicit synthetic bootstrap only. No demo publish, model call or external notification is made. */
export async function prepareLocalProactiveDemo(env, root) {
  const directory = join(root, '.cache', 'agent-local');
  const state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'));
  const config = assertLocalDemoBootstrap(env, root, state), targetPath = join(directory, 'demo-bootstrap.json');
  let target;
  try { target = JSON.parse(await readFile(targetPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (target && (target.format !== 1 || target.projectId !== config.projectId || target.email !== state.email)) throw Error('Local demo bootstrap binding mismatch');
  target ??= { format: 1, projectId: config.projectId, email: state.email, childOperationId: randomUUID(),
    acknowledgementOperationId: randomUUID(), syntheticToken: 'local-only-not-sent-' + randomUUID() };
  if (!/^local-only-not-sent-[a-f0-9-]{36}$/u.test(target.syntheticToken)) throw Error('Local demo token is not explicitly synthetic');
  const save = () => writeFile(targetPath, JSON.stringify(target, null, 2), { mode: 0o600 });
  await save(); // Original setup operation IDs survive a failed or interrupted bootstrap.
  const [{ openFirebaseRuntime }, { createLocalAgentBuckets }, { createLocalAgentDelivery }, { readLocalAgentModel },
    { FirestoreAuthorityError }, { createNativePushApi }, { createFamilyApi }, { reminderLocalTime }] = await Promise.all([
    import('../server/firebase-runtime.ts'), import('../server/local-agent-storage.ts'), import('../server/local-agent-delivery.ts'),
    import('../server/local-agent-model.ts'), import('../server/firestore-authority.ts'), import('../src/client/native-push-api.ts'),
    import('../src/client/family-api.ts'), import('../server/task-policy.ts'),
  ]);
  const buckets = createLocalAgentBuckets(env);
  const runtime = await openFirebaseRuntime(env, { local: { bucket: buckets, handoverBucket: buckets.handover,
    modelConfig: readLocalAgentModel(env).modelConfig,
    deliveries: domain => createLocalAgentDelivery(domain, env).adapters,
    async bootstrapAccount(auth) {
      try { return (await auth.getUserByEmail(state.email)).uid; }
      catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
        return (await auth.createUser({ email: state.email, password: state.password, emailVerified: true, displayName: '本地開發帳號' })).uid;
      }
    },
  } });
  try {
    try { await runtime.authority.readControl(); }
    catch (error) {
      if (!(error instanceof FirestoreAuthorityError) || error.code !== 'not_found') throw error;
      await runtime.authority.initializeControl({ generation: state.generation, enabled: true });
    }
    const invited = await runtime.database.runTransaction(tx => runtime.authority.readAdminInvitation(tx, state.email), { readOnly: true });
    if (!invited) await runtime.authority.issueInvitation({ email: state.email, ...state.invitation });
    const user = await runtime.nativeAuth.getUserByEmail(state.email);
    if (target.userId && target.userId !== user.uid) throw Error('Local demo account changed; inspect the original bootstrap before continuing');
    target.userId = user.uid;
    let headers = new Headers({ 'x-expected-user-id': user.uid });
    if (target.nativeCredential) headers.set('Authorization', 'Bearer ' + target.nativeCredential);
    const existing = target.nativeCredential ? await runtime.auth.getSession({ headers }).catch(() => null) : null;
    if (existing?.user.id !== user.uid) {
      const signedIn = await fetch('http://' + env.FIREBASE_AUTH_EMULATOR_HOST + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator-public-key-only', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: state.email, password: state.password, returnSecureToken: true }),
      });
      if (!signedIn.ok) throw Error('Local demo emulator login failed');
      const proof = await signedIn.json();
      if (proof.localId !== user.uid) throw Error('Local demo emulator login identity mismatch');
      const exchanged = await runtime.auth.handler(new Request(config.publicOrigin + '/api/auth/native-session', { method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-expected-user-id': user.uid }, body: JSON.stringify({ idToken: proof.idToken }) }));
      if (!exchanged.ok) throw Error('Local demo native session exchange failed (' + exchanged.status + ')');
      const session = await exchanged.json();
      if (session.user?.id !== user.uid || !session.credential?.startsWith('yuban-native-v1.')) throw Error('Local demo native session binding mismatch');
      target.nativeCredential = session.credential; await save();
      headers = new Headers({ Authorization: 'Bearer ' + target.nativeCredential, 'x-expected-user-id': user.uid });
    }
    const clientFetch = async (input, init = {}) => {
      const url = new URL(String(input), config.publicOrigin);
      if (url.origin !== config.publicOrigin || !url.pathname.startsWith('/api/')) throw Error('Local demo request escaped its runtime');
      const requestHeaders = new Headers(init.headers);
      headers.forEach((value, key) => requestHeaders.set(key, value));
      return runtime.handler(new Request(url, { ...init, headers: requestHeaders }));
    };
    const acknowledgement = await clientFetch(config.publicOrigin + '/api/account/acknowledgement', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationId: target.acknowledgementOperationId, policyVersion: SERVICE_POLICY_VERSION, accepted: true }) });
    if (!acknowledgement.ok) throw Error('Local synthetic account admission failed (' + acknowledgement.status + ')');
    const created = await runtime.authority.createChild({ userId: user.uid, operationId: target.childOperationId, displayName: '本地主動通知示範（合成）' });
    if (target.childId && target.childId !== created.child.id) throw Error('Local demo original child changed');
    target.childId = created.child.id; await save();
    const signal = AbortSignal.timeout(45_000), api = createNativePushApi(config.publicOrigin, clientFetch);
    const status = await api.status(signal, user.uid);
    let binding = status.bindings.find(item => item.id === status.currentBindingId && item.status === 'active');
    // Emulator import can invalidate an SDK session cookie while retaining its device ledger.
    // Replace only the recorded explicitly synthetic device through normal revoke/register APIs.
    if (!binding && target.bindingId) {
      const previous = status.bindings.find(item => item.id === target.bindingId && item.status === 'active');
      if (previous) {
        if (target.bindingMode !== 'local-synthetic-android-never-sent' || previous.label !== '本地合成 Android（永不外發）')
          throw Error('Refusing to replace an unrecognized local demo device');
        await api.revoke(previous.id, previous.version, signal, user.uid);
      }
    }
    if (!binding) binding = await api.register({ token: target.syntheticToken, label: '本地合成 Android（永不外發）' }, signal, user.uid);
    const presence = await api.chatPresence(signal, user.uid);
    await api.updateChatPresence({ childId: null, expectedPresenceVersion: presence.presenceVersion, chatNotificationsEnabled: true }, signal, user.uid);
    const preferences = await createFamilyApi(config.publicOrigin, clientFetch).getPreferences(signal);
    const minutes = reminderLocalTime(new Date().toISOString(), preferences.timeZone).minutes;
    const start = Number(preferences.quietStart.slice(0, 2)) * 60 + Number(preferences.quietStart.slice(3));
    const end = Number(preferences.quietEnd.slice(0, 2)) * 60 + Number(preferences.quietEnd.slice(3));
    target.quietHours = { active: start !== end && (start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end),
      timeZone: preferences.timeZone, start: preferences.quietStart, end: preferences.quietEnd };
    target.bindingId = binding.id; target.bindingMode = 'local-synthetic-android-never-sent'; await save();
    return { userId: user.uid, childId: target.childId, bindingId: binding.id, bindingMode: target.bindingMode, quietHours: target.quietHours };
  } finally { await runtime.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await prepareLocalProactiveDemo(process.env, root);
  console.log('Prepared local demo account/child and synthetic Android binding; never externally sent. ' + JSON.stringify(result));
}
