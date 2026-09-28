import { randomUUID } from "node:crypto";

const args = process.argv.slice(2);
const operation = args[0];
const operatorFlags = ["--operator", "--operator-confirmed"];
const operationFlags = new Map([
  ["catalog", []], ["list", []], ["inspect", []],
  ["register", [...operatorFlags, "--source-and-terms-checked"]],
  ["disable", operatorFlags],
  ["approve", [...operatorFlags, "--observation-hash", "--version", "--version-hash", "--source-and-terms-checked"]],
  ["check", [...operatorFlags, "--approved-source-check"]],
]);
const valueFlags = new Set(["--operator", "--observation-hash", "--version", "--version-hash"]);
const readOperations = new Set(["catalog", "list", "inspect"]);
const idPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
let pool, queue, failed = false;
const fail = () => {
  if (!failed) console.error("knowledge_refresh_operation_failed_check_scope_parameters_and_source_review");
  failed = true;
  process.exitCode = 1;
};

try {
  const allowed = operationFlags.get(operation);
  if (!allowed) throw new Error("Invalid operation");
  const hasTarget = operation !== "catalog" && operation !== "list";
  const target = hasTarget ? args[1] : undefined;
  if (hasTarget && (!target || !idPattern.test(target))) throw new Error("Invalid source or watch ID");
  const options = new Map();
  for (let index = hasTarget ? 2 : 1; index < args.length; index++) {
    const flag = args[index];
    if (!allowed.includes(flag) || options.has(flag)) throw new Error("Invalid or duplicate option");
    if (valueFlags.has(flag)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing option value");
      options.set(flag, value);
    } else options.set(flag, true);
  }
  // Host-operator commands only; validate every confirmation before opening the database.
  const operator = options.get("--operator");
  if (!readOperations.has(operation)) {
    if (!options.has("--operator-confirmed") || typeof operator !== "string"
      || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(operator)) throw new Error("Operator confirmation and alias required");
    if (allowed.some(flag => !options.has(flag))) throw new Error("Required review or approval missing");
  }
  if (operation === "approve" && (!hashPattern.test(options.get("--observation-hash"))
    || !hashPattern.test(options.get("--version-hash")) || !uuidPattern.test(options.get("--version")))) {
    throw new Error("Invalid observation hash, version or version hash");
  }

  const { SOURCE_WATCHES } = await import("../server/knowledge-source-catalog.ts");
  if (operation === "catalog") console.log(JSON.stringify(SOURCE_WATCHES));
  else {
    if ((operation === "register" || operation === "check") && !SOURCE_WATCHES.some(watch => watch.id === target)) {
      throw new Error("Watch not in catalog");
    }
    const [{ readServerConfig }, { createPool }, { createKnowledgeRefreshStore }] = await Promise.all([
      import("../server/config.ts"), import("../server/database.ts"), import("../server/knowledge-refresh-store.ts"),
    ]);
    pool = createPool(readServerConfig(process.env));
    const store = createKnowledgeRefreshStore(pool, SOURCE_WATCHES);
    if (operation === "list") console.log(JSON.stringify(await store.list()));
    if (operation === "inspect") console.log(JSON.stringify(await store.inspect(target)));
    if (operation === "register") {
      await store.register(target, operator);
      console.log(JSON.stringify({ event: "knowledge_watch_registered", watchId: target }));
    }
    if (operation === "disable") {
      await store.disable(target);
      console.log(JSON.stringify({ event: "knowledge_watch_disabled", watchId: target }));
    }
    if (operation === "approve") {
      await store.approve(target, options.get("--observation-hash"), options.get("--version"), options.get("--version-hash"), operator);
      console.log(JSON.stringify({ event: "knowledge_observation_approved", sourceId: target, versionId: options.get("--version") }));
    }
    if (operation === "check") {
      const [{ createWorkerQueue }, { KNOWLEDGE_REFRESH_QUEUE, REFRESH_JOB_OPTIONS }] = await Promise.all([
        import("../server/worker-queue.ts"), import("../server/knowledge-refresh-types.ts"),
      ]);
      queue = createWorkerQueue(pool, "producer");
      await queue.start();
      const pending = (await store.jobs()).find(job => job.data.watchId === target);
      if (!pending) throw new Error("Watch paused, disabled or catalog changed");
      const requestedId = randomUUID();
      const jobId = await queue.boss.send(KNOWLEDGE_REFRESH_QUEUE, pending.data,
        { ...REFRESH_JOB_OPTIONS, id: requestedId, singletonKey: target });
      if (jobId !== null && jobId !== requestedId) throw new Error("Queue result unconfirmed");
      console.log(JSON.stringify({ event: "knowledge_source_check", watchId: target, jobId,
        status: jobId === null ? "already_pending" : "queued" }));
    }
  }
} catch { fail(); }
finally {
  try { await queue?.stop(); } catch { fail(); }
  try { await pool?.end(); } catch { fail(); }
}
