import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { campaign, campaignTicketId } from '../server/knowledge-campaign-budget.ts';
import { planKnowledgePdfWindows, readKnowledgePdfWindow } from '../server/knowledge-pdf-windows.ts';
import { observationHash } from '../server/knowledge-observation.ts';
import { fhsPdfReadKey, matchesFhsPdfObservation, openFhsPdfReads, resolveFhsPdfObservation } from './fhs-pdf-reads.ts';

export async function readRecordedShapeFailure(replay, load) {
  let role, response, loaded = false;
  try {
    await replay(async input => {
      loaded = false;
      response = await load(input);
      role = input.role;
      loaded = true;
      return response;
    });
  } catch (error) {
    if (!loaded) throw error;
    if (error instanceof SyntaxError) return { role, state: 'invalid_json' };
    if (error?.name === 'ZodError' && Array.isArray(error.issues)) {
      const value = JSON.parse(response);
      const issues = error.issues.slice(0, 32).map(({ path, code, maximum, minimum }) => {
        const field = path.reduce((parent, key) => parent?.[key], value);
        return { path, code, ...(typeof maximum === 'number' ? { maximum } : {}), ...(typeof minimum === 'number' ? { minimum } : {}),
          ...(typeof field === 'string' || Array.isArray(field) ? { length: field.length } : {}),
          ...(path.at(-1) === 'region' && ['HK', 'hk', '香港'].includes(field) ? { region: field } : {}) };
      });
      return { role, state: 'schema_rejected', issues };
    }
    if (/^knowledge_[a-z_]+$/u.test(error?.code ?? '')) return { role, state: 'other_boundary', code: error.code };
    throw error;
  }
  return { role, state: 'format_failure_not_reproduced' };
}

/** Reconstruct the normal two requests, stopping after reading the original review. */
export async function readRecordedWindowQuotes(range, replay, load) {
  let draft, review;
  const complete = new Error('recorded_pair_read');
  try {
    await replay(async input => {
      if (input.role !== (draft ? 'knowledge_review' : 'knowledge_organize')) throw Error('fhs_evidence_stage_pair');
      const text = await load(input);
      if (!draft) {
        draft = JSON.parse(text);
        return text;
      }
      review = JSON.parse(text);
      throw complete;
    });
  } catch (error) { if (error !== complete) throw error; }
  if (!draft || review?.decision !== 'approve') throw Error('fhs_evidence_stage_pair');
  return range.ranges.flatMap(({ first, last }) => {
    const key = 'pages-' + first + '-' + last, organized = draft.ranges[key], reviewed = review.ranges[key];
    if (!organized) return [];
    if (!reviewed || !Number.isInteger(organized.quotePage) || organized.quotePage < first || organized.quotePage > last
      || typeof organized.quote !== 'string' || typeof reviewed.originalQuote !== 'string') throw Error('fhs_evidence_stage_pair');
    return [{ first, last, organizerPage: organized.quotePage, kind: organized.originalKind,
      organizerExcerpt: organized.quote, reviewerExcerpt: reviewed.originalQuote, supported: reviewed.supported }];
  });
}

export function canInspectHeldWindow(pin, saved) {
  if (!saved?.windowed || saved.result?.status !== 'candidate_held') return false;
  const code = saved.result.code;
  if (pin?.lane === 'C2') return code === 'knowledge_window_quote_mismatch' || code === 'knowledge_review_failed';
  return pin?.lane === 'C3' && code === 'knowledge_window_quote_mismatch' && saved.budget?.modelCalls === 2;
}

export function hasSettledGenerationOutput(row, sourceId, original, stageHash) {
  return row?.kind === 'generation' && row.state === 'settled' && row.sourceId === sourceId
    && row.operationFingerprint === original && row.stageHash === stageHash && !row.rejection
    && Number.isSafeInteger(row.outputTokens) && row.outputTokens > 0;
}

export async function verifySettledWindowStage(attempts, sourceId, original, attemptKey) {
  const stageHash = knowledgeReviewHash(attemptKey);
  const ticket = await attempts.doc(campaignTicketId('generation', sourceId, original, stageHash)).get();
  if (!hasSettledGenerationOutput(ticket.data(), sourceId, original, stageHash))
    throw Error('fhs_evidence_generation_unconfirmed');
}

/** The operator supplies verified opening-page reads. The failed work, stages and slice remain read-only. */
export async function inspectHeldWindowEvidence({ domain, refresh, job, pin, definition, original, saved, reads, indexHash }) {
  const { database, cipher, projectId, namespace } = domain;
  if (!canInspectHeldWindow(pin, saved) || pin.sourceId !== definition.id || pin.sourceId !== job.watchId || saved?.request?.operationFingerprint !== original
    || saved.request.watchId !== pin.sourceId || saved.request.publishMode !== 'live' || definition.audience !== 'public_noncommercial' || definition.kind !== 'pdf'
    || new URL(definition.url).hostname !== 'www.fhs.gov.hk' || saved.lease || saved.prepared || saved.receipt)
    throw Error('fhs_evidence_scope');
  const sourceId = pin.sourceId, parentHash = pin.sha256;
  const ledger = database.collection(namespace + '_knowledge_campaigns').doc(campaign);
  const binding = (await ledger.collection('publicationBindings').doc(sourceId).get()).data();
  if (binding?.operationFingerprint !== original || binding.lane !== pin.lane || binding.sourceId !== sourceId
    || binding.sha256 !== parentHash || binding.pages !== pin.pages || binding.workerGeneration !== job.workerGeneration || binding.revision !== job.revision)
    throw Error('fhs_evidence_operation_changed');
  const source = { ...pin, url: definition.url };
  const { snapshot } = await resolveFhsPdfObservation(refresh, job, original, source);
  if (!matchesFhsPdfObservation(source, snapshot) || observationHash(snapshot.items[0]) !== saved.result.observationHash)
    throw Error('fhs_evidence_observation_changed');
  const index = Math.ceil(saved.budget.modelCalls / 2) - 1;
  const range = planKnowledgePdfWindows(pin.pages, saved.budget.maxModelCalls, saved.windowRangeLimit ?? 14)[index];
  if (!Number.isInteger(index) || !range) throw Error('fhs_evidence_failed_window');
  const collection = database.collection(namespace + '_knowledge_work');
  const ref = (...parts) => collection.doc(knowledgeReviewHash(parts));
  async function opened(address) {
    const row = await address.get();
    if (!row.exists || row.get('format') !== 'knowledge-work' || row.get('version') !== 1) throw Error('fhs_evidence_record_missing');
    return JSON.parse(cipher.decrypt(row.get('ciphertext'), JSON.stringify(['knowledge-work/1', projectId, namespace, address.path])));
  }
  if ((await ref('reviewed-window', original, String(index)).get()).exists) throw Error('fhs_evidence_failed_window');
  const identity = { sourceId, parentHash, first: range.firstRead, count: range.lastRead - range.firstRead + 1, method: 'pdfjs-dist/6.4.299-extractPages/1' };
  const descriptor = await opened(ref('pdf-window', knowledgeReviewHash(identity), ''));
  if (descriptor.total !== pin.pages || Object.entries(identity).some(([key, value]) => descriptor[key] !== value)) throw Error('fhs_evidence_slice_changed');
  const bytes = await refresh.originals.readPdf(sourceId, descriptor.contentHash);
  const candidate = { watchId: sourceId, definition, observed: snapshot.items[0], observationHash: saved.result.observationHash, previousObservationHash: null };
  const replay = completeText => readKnowledgePdfWindow({ candidate, range, bytes, baseline: null, explicitAgeScope: true,
    sliceHash: descriptor.contentHash, textLayers: [], signal: new AbortController().signal, completeText });
  const load = async ({ system, user, attemptKey }) => {
    if (pin.lane === 'C3') await verifySettledWindowStage(ledger.collection('attempts'), sourceId, original, attemptKey);
    const stage = await opened(ref('model', original, attemptKey));
    if (stage.state !== 'ready' || typeof stage.text !== 'string' || stage.requestHash !== knowledgeReviewHash({ system, user, attemptKey }))
      throw Error('fhs_evidence_stage_changed');
    return stage.text;
  };
  const bounds = { window: index + 1, first: range.first, last: range.last };
  if (saved.result.code === 'knowledge_review_failed') return { ...bounds, failure: await readRecordedShapeFailure(replay, load) };
  const quotes = await readRecordedWindowQuotes(range, replay, load);
  const extract = await openFhsPdfReads(reads, indexHash);
  const rawIndex = await readFile(join(reads, 'index.json'));
  if (createHash('sha256').update(rawIndex).digest('hex') !== indexHash) throw Error('fhs_pdf_index_integrity');
  const { records } = JSON.parse(rawIndex);
  const originalBytes = await refresh.originals.readPdf(sourceId, parentHash), blocks = new Map();
  const layout = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
  for (const quote of quotes) {
    const startPage = 1 + 8 * Math.floor((quote.organizerPage - 1) / 8);
    const options = { expectedHash: parentHash, startPage, pageLimit: Math.min(8, pin.pages - startPage + 1) };
    if (!Object.hasOwn(records, fhsPdfReadKey(parentHash, options))) throw Error('fhs_evidence_opening_read_missing');
    if (!blocks.has(startPage)) blocks.set(startPage, await extract(originalBytes, options));
    const block = blocks.get(startPage), page = block.pages.find(row => row.page === quote.organizerPage);
    if (!page || block.totalPages !== pin.pages || block.fileHash !== parentHash) throw Error('fhs_evidence_page_changed');
    const match = text => !text.trim() || page.status !== 'text' ? 'unconfirmed'
      : page.text.includes(text.trim()) ? 'exact' : layout(page.text).includes(layout(text)) ? 'layout_whitespace' : 'unconfirmed';
    quote.pageStatus = page.status;
    quote.organizerMatch = match(quote.organizerExcerpt);
    quote.reviewerMatch = match(quote.reviewerExcerpt);
  }
  return { ...bounds, quotes };
}
