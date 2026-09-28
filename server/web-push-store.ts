import { createHash, randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pushRegistrationInput, type PushBinding, type PushDelivery, type PushRegistrationInput, type WebPushStatus } from "../src/shared/web-push.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { FamilyError } from "./family-access.ts";
import { appendOnlineChange } from "./online-change.ts";
import { checkedSubscription, pushProvider } from "./web-push-gateway.ts";
import type { WebPushQueue, WebPushGateway, PushSendResult } from "./web-push-types.ts";

export interface WebPushServices { publicKey: string | null; queue?: WebPushQueue }
interface BindingRow {
  id: string; user_id: string; version: number; status: PushBinding["status"]; provider: PushBinding["provider"];
  endpoint_hash: string | null; vapid_public_key: string; subscription_encrypted: string | null;
  expires_at: Date | null; created_at: Date; updated_at: Date;
}
interface DeliveryRow {
  id: string; user_id: string; subscription_id: string; subscription_version: number; worker_generation: string;
  status: PushDelivery["status"]; reason: PushDelivery["reason"]; provider_status: number | null;
  created_at: Date; attempted_at: Date | null; finished_at: Date | null;
}
const aad = (row: Pick<BindingRow, "id" | "user_id">) => "web-push:" + row.user_id + ":" + row.id;
const missing = () => new FamilyError(404, "not_found");
const conflict = (code = "version_conflict") => new FamilyError(409, code);
function delivery(row: DeliveryRow): PushDelivery {
  return { id: row.id, bindingId: row.subscription_id, status: row.status, reason: row.reason, providerStatus: row.provider_status,
    createdAt: row.created_at.toISOString(), attemptedAt: row.attempted_at?.toISOString() ?? null, finishedAt: row.finished_at?.toISOString() ?? null };
}
async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); let discard = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='5s'; SET LOCAL idle_in_transaction_session_timeout='10s'");
    const result = await action(client); await client.query("COMMIT"); return result;
  } catch (error) { try { await client.query("ROLLBACK"); } catch { discard = true; } throw error; }
  finally { client.release(discard); }
}
export function createWebPushStore(pool: Pool, cipher: StorageCipher, services: WebPushServices, trackChanges = false) {
  function binding(row: BindingRow): PushBinding {
    const label = row.subscription_encrypted ? pushRegistrationInput.parse(JSON.parse(cipher.decrypt(row.subscription_encrypted, aad(row)))).label
      : row.status === "revoked" ? "已撤銷的訂閱" : "已失效的訂閱";
    return { id: row.id, version: row.version, status: row.status, provider: row.provider, label,
      endpointHash: row.endpoint_hash, vapidPublicKey: row.vapid_public_key, expiresAt: row.expires_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
  }
  async function mutate<T>(userId: string, action: (client: PoolClient) => Promise<T>): Promise<T> {
    return transaction(pool, async client => {
      const space = trackChanges ? (await client.query<{ id: string }>("SELECT id FROM workspaces WHERE owner_user_id=$1 FOR UPDATE", [userId])).rows[0] : null;
      if (!(await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [userId])).rowCount) throw missing();
      const result = await action(client);
      if (space) await appendOnlineChange(client, space.id, "preferences", null, false, userId);
      return result;
    });
  }
  const owned = async (client: PoolClient, userId: string, id: string, version: number) => {
    const row = (await client.query<BindingRow>("SELECT * FROM web_push_subscriptions WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId])).rows[0];
    if (!row) throw missing();
    if (row.version !== version) throw conflict();
    return row;
  };
  return {
    async status(userId: string): Promise<WebPushStatus> {
      const bindings = (await pool.query<BindingRow>("SELECT * FROM web_push_subscriptions WHERE user_id=$1 ORDER BY (status='active') DESC,created_at DESC,id LIMIT 20", [userId])).rows.map(binding);
      const deliveries = (await pool.query<DeliveryRow>("SELECT * FROM web_push_deliveries WHERE user_id=$1 ORDER BY created_at DESC,id LIMIT 20", [userId])).rows.map(delivery);
      const usage = (await pool.query<{ count: string; next: Date | null }>(`SELECT count(*)::text AS count,
        greatest(max(created_at)+interval '60 seconds',CASE WHEN count(*)>=3 THEN min(created_at)+interval '24 hours' END) AS next
        FROM web_push_deliveries WHERE user_id=$1 AND created_at>now()-interval '24 hours'`, [userId])).rows[0];
      const enabled = Boolean((await pool.query("SELECT 1 FROM worker_control WHERE id=1 AND enabled")).rowCount);
      return { userId, available: Boolean(services.publicKey && services.queue), workerEnabled: enabled, publicKey: services.publicKey,
        supportedProviders: ["fcm", "mozilla"], bindings, deliveries, testsRemaining: Math.max(0, 3 - Number(usage.count)),
        nextTestAt: usage.next && usage.next.getTime() > Date.now() ? usage.next.toISOString() : null };
    },
    async register(userId: string, value: PushRegistrationInput): Promise<PushBinding> {
      const input = pushRegistrationInput.parse(value);
      try { checkedSubscription(input.subscription); } catch { throw new FamilyError(400, "invalid_subscription"); }
      if (!services.publicKey || !services.queue) throw conflict("push_unavailable");
      const hash = createHash("sha256").update(input.subscription.endpoint).digest("hex");
      return mutate(userId, async client => {
        // Serialise the opaque endpoint across accounts without revealing its existing owner.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,193105))", [hash]);
        const existing = (await client.query<BindingRow>("SELECT * FROM web_push_subscriptions WHERE endpoint_hash=$1 FOR UPDATE", [hash])).rows[0];
        if (existing) {
          if (existing.user_id !== userId || existing.status !== "active") throw conflict("subscription_unavailable");
          const saved = pushRegistrationInput.parse(JSON.parse(cipher.decrypt(existing.subscription_encrypted!, aad(existing))));
          if (JSON.stringify(saved.subscription) !== JSON.stringify(input.subscription) || existing.vapid_public_key !== services.publicKey) throw conflict("subscription_changed");
          return binding(existing);
        }
        const counts = (await client.query<{ active: string; recent: string }>(`SELECT
          count(*) FILTER(WHERE status='active')::text AS active,
          count(*) FILTER(WHERE created_at>now()-interval '24 hours')::text AS recent
          FROM web_push_subscriptions WHERE user_id=$1`, [userId])).rows[0];
        if (Number(counts.active) >= 5 || Number(counts.recent) >= 20) throw conflict("subscription_limit");
        const id = randomUUID(), encrypted = cipher.encrypt(JSON.stringify(input), aad({ id, user_id: userId }));
        const row = (await client.query<BindingRow>(`INSERT INTO web_push_subscriptions
          (id,user_id,version,status,endpoint_hash,provider,vapid_public_key,subscription_encrypted,expires_at)
          VALUES($1,$2,1,'active',$3,$4,$5,$6,$7) RETURNING *`, [id, userId, hash, pushProvider(input.subscription.endpoint),
          services.publicKey, encrypted, input.subscription.expirationTime === null ? null : new Date(input.subscription.expirationTime)])).rows[0];
        return binding(row);
      });
    },
    async revoke(userId: string, id: string, version: number): Promise<PushBinding> {
      return mutate(userId, async client => {
        const row = await owned(client, userId, id, version);
        if (row.status !== "active") return binding(row);
        const updated = (await client.query<BindingRow>(`UPDATE web_push_subscriptions SET status='revoked',version=version+1,
          endpoint_hash=NULL,subscription_encrypted=NULL,updated_at=now() WHERE id=$1 RETURNING *`, [id])).rows[0];
        await client.query(`UPDATE web_push_deliveries SET status='stopped',reason='revoked',finished_at=now()
          WHERE subscription_id=$1 AND status='queued'`, [id]);
        // Already attempted sends cannot be recalled; their evidence remains distinct.
        return binding(updated);
      });
    },
    async test(userId: string, id: string, version: number): Promise<PushDelivery> {
      if (!services.publicKey || !services.queue) throw conflict("push_unavailable");
      return mutate(userId, async client => {
        const control = (await client.query<{ generation: string }>("SELECT generation FROM worker_control WHERE id=1 AND enabled FOR SHARE")).rows[0];
        if (!control) throw conflict("worker_paused");
        const row = await owned(client, userId, id, version);
        if (row.status !== "active" || row.vapid_public_key !== services.publicKey
          || row.expires_at && row.expires_at.getTime() <= Date.now()) throw conflict("subscription_unavailable");
        const count = (await client.query<{ count: string; too_soon: boolean }>(`SELECT count(*)::text AS count,
          coalesce(max(created_at)>now()-interval '60 seconds',false) AS too_soon FROM web_push_deliveries
          WHERE user_id=$1 AND created_at>now()-interval '24 hours'`, [userId])).rows[0];
        if (Number(count.count) >= 3 || count.too_soon) throw conflict("test_limit");
        const deliveryId = randomUUID();
        const result = (await client.query<DeliveryRow>(`INSERT INTO web_push_deliveries
          (id,user_id,subscription_id,subscription_version,worker_generation,status)
          VALUES($1,$2,$3,$4,$5,'queued') RETURNING *`, [deliveryId, userId, id, row.version, control.generation])).rows[0];
        await services.queue!.enqueue(client, deliveryId);
        return delivery(result);
      });
    },
  };
}
export type WebPushStore = ReturnType<typeof createWebPushStore>;

export function createWebPushWorker(pool: Pool, cipher: StorageCipher, gateway: WebPushGateway) {
  async function finish(id: string, result: PushSendResult) {
    await transaction(pool, async client => {
      const initial = (await client.query<DeliveryRow>("SELECT * FROM web_push_deliveries WHERE id=$1", [id])).rows[0];
      if (!initial) return;
      await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [initial.user_id]);
      await client.query("SELECT id FROM web_push_subscriptions WHERE id=$1 FOR UPDATE", [initial.subscription_id]);
      const changed = await client.query(`UPDATE web_push_deliveries SET status=$2,reason=$3,provider_status=$4,finished_at=now()
        WHERE id=$1 AND status='sending' RETURNING id`, [id, result.status, result.reason, result.providerStatus]);
      if (changed.rowCount && result.reason === "subscription_expired") {
        await client.query(`UPDATE web_push_subscriptions SET status='expired',version=version+1,endpoint_hash=NULL,
          subscription_encrypted=NULL,updated_at=now() WHERE id=$1 AND status='active' AND version=$2`, [initial.subscription_id, initial.subscription_version]);
        await client.query(`UPDATE web_push_deliveries SET status='stopped',reason='subscription_expired',finished_at=now()
          WHERE subscription_id=$1 AND status='queued'`, [initial.subscription_id]);
      }
    });
  }
  return {
    async process(id: string, signal = new AbortController().signal) {
      const attempt = await transaction(pool, async client => {
        const first = (await client.query<DeliveryRow>("SELECT * FROM web_push_deliveries WHERE id=$1", [id])).rows[0];
        if (!first) return null;
        await client.query('SELECT id FROM "user" WHERE id=$1 FOR UPDATE', [first.user_id]);
        const control = (await client.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1 FOR SHARE")).rows[0];
        const subscription = (await client.query<BindingRow>("SELECT * FROM web_push_subscriptions WHERE id=$1 FOR UPDATE", [first.subscription_id])).rows[0];
        const row = (await client.query<DeliveryRow>("SELECT * FROM web_push_deliveries WHERE id=$1 FOR UPDATE", [id])).rows[0];
        if (!row || !["queued", "sending"].includes(row.status)) return null;
        if (row.status === "sending") {
          await client.query("UPDATE web_push_deliveries SET status='unknown',reason='worker_interrupted',finished_at=now() WHERE id=$1", [id]);
          return null;
        }
        const reason: PushDelivery["reason"] = !control?.enabled || control.generation !== row.worker_generation ? "worker_paused"
          : !gateway.publicKey ? "configuration_unavailable"
          : !subscription || subscription.status !== "active" || subscription.version !== row.subscription_version
            || subscription.user_id !== row.user_id || subscription.vapid_public_key !== gateway.publicKey ? "revoked"
          : subscription.expires_at && subscription.expires_at.getTime() <= Date.now() ? "subscription_expired" : null;
        if (reason) {
          await client.query("UPDATE web_push_deliveries SET status='stopped',reason=$2,finished_at=now() WHERE id=$1", [id, reason]);
          return null;
        }
        const input = pushRegistrationInput.parse(JSON.parse(cipher.decrypt(subscription.subscription_encrypted!, aad(subscription))));
        await client.query("UPDATE web_push_deliveries SET status='sending',attempted_at=now() WHERE id=$1", [id]);
        return { row, subscription: input.subscription };
      });
      if (!attempt) return;
      // No SQL transaction over external IO. Recheck immediately before sending.
      const authorized = async () => Boolean((await pool.query(`SELECT 1 FROM web_push_deliveries d
        JOIN web_push_subscriptions s ON s.id=d.subscription_id AND s.user_id=d.user_id
        JOIN worker_control c ON c.id=1 AND c.enabled AND c.generation=d.worker_generation
        WHERE d.id=$1 AND d.status='sending' AND s.status='active' AND s.version=d.subscription_version
        AND s.vapid_public_key=$2 AND (s.expires_at IS NULL OR s.expires_at>now())`, [id, gateway.publicKey])).rowCount);
      let result: PushSendResult;
      try { result = await gateway.send(attempt.subscription, { v: 1, bindingId: attempt.row.subscription_id,
        bindingVersion: attempt.row.subscription_version, deliveryId: id }, signal, authorized); }
      catch { result = { status: "unknown", reason: "transport_unknown", providerStatus: null }; }
      await finish(id, result);
    },
    async unavailable(id: string) {
      // Only for missing/terminal framework jobs, never merely a slow active sender.
      await pool.query(`UPDATE web_push_deliveries SET status=CASE WHEN status='sending' THEN 'unknown' ELSE 'stopped' END,
        reason='worker_interrupted',finished_at=now() WHERE id=$1 AND status IN ('queued','sending')`, [id]);
    },
  };
}
