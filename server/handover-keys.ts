import { createHash, createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';

// Public keys use the same SPKI representation as the package proof.
const trustList = z.array(z.object({
  serverId: z.string().trim().min(1).max(256), publicKey: z.base64().min(1).max(256),
}).strict()).max(128);
const keyId = (spki: Buffer) => createHash('sha256').update(spki).digest('hex');

async function readKeyFile(path: string, limit: number, secret: boolean) {
  if (!isAbsolute(path)) throw Error();
  const file = await open(path, 'r');
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit || (secret && process.platform !== 'win32' && (info.mode & 0o077))) throw Error();
    const bytes = Buffer.alloc(info.size + 1);
    try {
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== info.size) throw Error();
      return bytes.subarray(0, bytesRead);
    } catch (error) { bytes.fill(0); throw error; }
  } finally { await file.close(); }
}

export async function readHandoverKeys(env: Record<string, string | undefined>, serverId: string, worker: boolean) {
  const trustedKeys = new Map<string, { key: KeyObject; serverId: string }>();
  if (env.HANDOVER_TRUST_FILE !== undefined) {
    try {
      const bytes = await readKeyFile(env.HANDOVER_TRUST_FILE, 65536, false);
      for (const entry of trustList.parse(JSON.parse(bytes.toString('utf8')))) {
        const spki = Buffer.from(entry.publicKey, 'base64');
        const key = createPublicKey({ key: spki, format: 'der', type: 'spki' });
        const id = keyId(spki);
        if (key.asymmetricKeyType !== 'ed25519' || !key.export({ type: 'spki', format: 'der' }).equals(spki) || trustedKeys.has(id)) throw Error();
        trustedKeys.set(id, { key, serverId: entry.serverId });
      }
    } catch { throw new Error('Invalid HANDOVER_TRUST_FILE'); }
  }
  let signingKey: KeyObject | undefined;
  if (env.HANDOVER_SIGNING_KEY_FILE !== undefined) {
    try {
      if (!worker) throw Error();
      const pem = await readKeyFile(env.HANDOVER_SIGNING_KEY_FILE, 8192, true);
      try { signingKey = createPrivateKey(pem); } finally { pem.fill(0); }
      if (signingKey.asymmetricKeyType !== 'ed25519') throw Error();
      const id = keyId(createPublicKey(signingKey).export({ type: 'spki', format: 'der' }));
      if (trustedKeys.get(id)?.serverId !== serverId) throw Error();
    } catch { throw new Error('Invalid HANDOVER_SIGNING_KEY_FILE or missing trusted key for this server'); }
  }
  return { signingKey, trustedKeys };
}
