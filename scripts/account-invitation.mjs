import { randomUUID } from "node:crypto";
import { readServerConfig } from "../server/config.ts";
import { readAccountServiceConfig } from "../server/account-service-config.ts";
import { accountEmailHash } from "../server/account-admission.ts";
import { createPool } from "../server/database.ts";

let pool;
try {
  const operation = process.argv[2], value = process.argv[3];
  if (!["issue", "revoke"].includes(operation) || !value || process.argv.length > 5) throw new Error();
  const service = await readAccountServiceConfig(process.env);
  if (!service.enabled) throw new Error();
  pool = createPool(readServerConfig(process.env));
  if (operation === "revoke") {
    if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(value) || process.argv[4]) throw new Error();
    const result = await pool.query("UPDATE account_invitations SET revoked_at=COALESCE(revoked_at,now()) WHERE id=$1 RETURNING id", [value]);
    if (result.rowCount !== 1) throw new Error();
    console.info(JSON.stringify({ state: "revoked", invitationId: value }));
  } else {
    const daysValue = process.argv[4] ?? "7", days = Number(daysValue), emailHash = accountEmailHash(value);
    if (!/^\d+$/u.test(daysValue) || !Number.isInteger(days) || days < 1 || days > 30) throw new Error();
    const client = await pool.connect(); let failed = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(173063,hashtext($1))", [emailHash]);
      // A replacement is a new explicit operator invitation; consumed invitations stay consumed.
      await client.query(`UPDATE account_invitations SET revoked_at=now() WHERE email_hash=$1
        AND consumed_at IS NULL AND revoked_at IS NULL`, [emailHash]);
      const invitationId = randomUUID();
      const row = (await client.query(`INSERT INTO account_invitations(id,email_hash,expires_at)
        VALUES($1,$2,now()+$3*interval '1 day') RETURNING expires_at`, [invitationId, emailHash, days])).rows[0];
      await client.query("COMMIT");
      console.info(JSON.stringify({ state: "issued", invitationId, expiresAt: row.expires_at.toISOString() }));
    } catch { try { await client.query("ROLLBACK"); } catch { failed = true; } throw new Error(); }
    finally { client.release(failed); }
  }
} catch { console.error("account_invitation_failed"); process.exitCode = 1; }
finally { await pool?.end(); }
