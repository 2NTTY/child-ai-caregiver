import { readFileSync } from 'node:fs';
import { campaignMaterialWatches } from '../server/platform-materials.ts';

const laneIDs = ['C1', 'C2', 'C3'];
const digest = /^[a-f0-9]{64}$/u;

export function selectPublicationLane(manifest, originals, lane, sourceId) {
  if (!laneIDs.includes(lane)) throw Error('fhs_lane_unknown');
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.lanes) || manifest.lanes.length !== laneIDs.length)
    throw Error('fhs_lane_manifest');
  const owners = new Set(), seen = new Set(), hashes = new Set();
  let selected;
  for (const group of manifest.lanes) {
    if (!laneIDs.includes(group.id) || owners.has(group.id) || !Array.isArray(group.sources)) throw Error('fhs_lane_manifest');
    owners.add(group.id);
    for (const pin of group.sources) {
      const original = originals.get(pin.sourceId);
      if (!original || seen.has(pin.sourceId) || hashes.has(pin.sha256) || !digest.test(pin.sha256)
        || !Number.isSafeInteger(pin.pages) || pin.pages < 1 || pin.sha256 !== original.sha256 || pin.pages !== original.pages)
        throw Error('fhs_lane_manifest');
      seen.add(pin.sourceId);
      hashes.add(pin.sha256);
    }
    if (group.id === lane) selected = group.sources.map(pin => originals.get(pin.sourceId));
  }
  if (sourceId === undefined) return selected;
  const source = selected.find(row => row.sourceId === sourceId);
  if (!source) throw Error('fhs_lane_source');
  return [source];
}

export function publicationAssignments() {
  const manifest = JSON.parse(readFileSync(new URL('../knowledge/fhs-initial-publication-lanes.json', import.meta.url), 'utf8'));
  const inventory = JSON.parse(readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
  const pdfs = new Map(inventory.pdfOriginals.map(pdf => [pdf.url, pdf]));
  const originals = new Map(campaignMaterialWatches.filter(w => w.kind === 'pdf' && pdfs.has(w.url))
    .map(w => [w.id, { sourceId: w.id, ...pdfs.get(w.url) }]));
  return new Map(laneIDs.map(id => [id, selectPublicationLane(manifest, originals, id)]));
}

export async function runPublicationLane(sources, action, port) {
  if (!['status', 'prepare', 'run'].includes(action)) throw Error('fhs_lane_action');
  let exitCode = 0;
  for (const source of sources) {
    let receipt = await port.inspect(source);
    if (action !== 'status' && (['unregistered', 'awaiting_observation'].includes(receipt.state)
      || receipt.state === 'ready' && receipt.pinned === false))
      receipt = await port.prepare(source, receipt);
    port.report(source, receipt);
    if (action === 'status' || ['published', 'held'].includes(receipt.state)) continue;
    if (receipt.state === 'source_blocked') { exitCode = 2; continue; }
    if (receipt.state !== 'ready') return 2;
    if (action === 'prepare') continue;
    if (!digest.test(receipt.operationFingerprint)) throw Error('fhs_lane_operation_missing');
    const status = await port.dispatch(source, receipt.operationFingerprint, receipt.started);
    const terminal = await port.inspect(source);
    if (terminal.operationFingerprint !== receipt.operationFingerprint) throw Error('fhs_lane_operation_changed');
    port.report(source, terminal);
    if (terminal.state === 'published' || terminal.state === 'held') continue;
    if (terminal.state === 'source_blocked') { exitCode = 2; continue; }
    if (status !== 0 && status !== 3) return status;
    throw Error('fhs_lane_terminal_receipt_missing');
  }
  return exitCode;
}

export async function runLaneCommand(args) {
  const [lane, action, sourceId, ...extra] = args;
  if (!laneIDs.includes(lane) || !['status', 'prepare', 'run'].includes(action) || extra.length)
    throw Error('Use --lane C1|C2|C3 status|prepare|run [SOURCE_ID]');
  const rows = publicationAssignments().get(lane);
  const sources = sourceId === undefined ? rows.sort((a, b) => a.pages - b.pages) : rows.filter(s => s.sourceId === sourceId);
  if (!sources.length) throw Error('fhs_lane_source');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.AI_KNOWLEDGE_MAINTENANCE_PAYER !== 'platform')
    throw Error('knowledge_campaign_environment_mismatch');
  const { openLaneRuntime } = await import('./fhs-lane-operations.mjs');
  const runtime = await openLaneRuntime(lane, action);
  try { return await runPublicationLane(sources, action, runtime); }
  finally { await runtime.close(); }
}
