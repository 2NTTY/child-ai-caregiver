import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { needsKnowledgeVector } from '../src/shared/source-series.ts';

const digest = /^[a-f0-9]{64}$/u;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const layoutText = text => text.normalize('NFC').replace(/\s+/gu, ' ').trim();
const confirmedPages = new Set(['text_exact', 'text_layout_whitespace', 'text_across_pages', 'recorded_independent_transcription', 'reviewed_visual_page']);

function pageEvidence(chunk, physical, windows, pin) {
  const excerpt = chunk.sourceExcerpt;
  if (chunk.originalKind === 'page_transcription' || chunk.originalKind === 'visual_page') {
    const window = windows.find(reading => reading.parentHash === pin.sha256
      && reading.first <= physical.page && reading.last >= physical.page
      && reading.originalLocations[chunk.key]?.physicalPage === physical.page
      && reading.originalLocations[chunk.key].kind === chunk.originalKind);
    const hasContent = pages => pages.some(page => page.page === physical.page && page.status === 'content');
    if (!window?.organizeKey || !window.reviewKey || window.organizeKey === window.reviewKey
      || physical.status === 'text' || !hasContent(window.pages) || !hasContent(window.organizePages)
      || !window.chunks.some(saved => saved.key === chunk.key && saved.sourceExcerpt === excerpt && saved.originalKind === chunk.originalKind))
      return 'independent_page_evidence_missing';
    if (chunk.originalKind === 'visual_page' && excerpt === '') return 'reviewed_visual_page';
    if (chunk.originalKind === 'page_transcription' && excerpt?.trim()) return 'recorded_independent_transcription';
    return 'independent_page_evidence_missing';
  }
  if (physical.status === 'text' && excerpt?.trim()) {
    if (physical.text.includes(excerpt)) return 'text_exact';
    if (layoutText(physical.text).includes(layoutText(excerpt))) return 'text_layout_whitespace';
  }
  return 'excerpt_not_on_opening_page';
}

/** Follow the same version, chunk identity and opening page as a family's saved citation. */
export async function verifyFhsPdfPages(metadata, source, identities, windows, pin, ports) {
  if (source.extraction?.contentHash !== pin.sha256 || source.extraction.totalPages !== pin.pages)
    throw Error('fhs_receipt_original_mismatch');
  const bytes = await ports.readOriginal(metadata.sourceId, pin.sha256);
  if (!bytes || bytes.byteLength !== pin.bytes || sha256(bytes) !== pin.sha256) throw Error('fhs_receipt_original_mismatch');
  const blocks = new Map(), pages = [];
  const byKey = new Map(identities.map(identity => [identity.key, identity]));
  if (byKey.size !== source.chunks.length || identities.length !== byKey.size) throw Error('fhs_receipt_chunk_binding');
  async function readPage(page) {
    const first = 1 + 8 * Math.floor((page - 1) / 8);
    if (!blocks.has(first)) {
      const block = await ports.extract(bytes, { expectedHash: pin.sha256, startPage: first, pageLimit: Math.min(8, pin.pages - first + 1) });
      if (block.fileHash !== pin.sha256 || block.totalPages !== pin.pages) throw Error('fhs_receipt_original_mismatch');
      blocks.set(first, block.pages);
    }
    const physical = blocks.get(first).find(item => item.page === page);
    if (!physical) throw Error('fhs_receipt_physical_page_missing');
    return physical;
  }
  for (const chunk of source.chunks) {
    const identity = byKey.get(chunk.key), page = chunk.excerptPage ?? chunk.pageStart;
    if (!identity || !Number.isSafeInteger(page) || page < 1 || page > pin.pages || page < chunk.pageStart || page > chunk.pageEnd)
      throw Error('fhs_receipt_chunk_binding');
    const resolved = await ports.resolve({ ...metadata, chunkId: identity.chunkId, contentHash: identity.contentHash });
    if (!resolved || resolved.sha256 !== pin.sha256 || resolved.sourceId !== metadata.sourceId || resolved.url !== metadata.url)
      throw Error('fhs_receipt_citation_unavailable');
    const physical = await readPage(page);
    const entry = { ...identity, page, proof: pageEvidence(chunk, physical, windows, pin) };
    if (entry.proof === 'excerpt_not_on_opening_page' && physical.status === 'text' && chunk.sourceExcerpt?.trim() && page < chunk.pageEnd) {
      const quote = layoutText(chunk.sourceExcerpt), left = layoutText(physical.text), right = await readPage(page + 1);
      for (const separator of [' ', '']) {
        const start = (left + separator + layoutText(right.text)).indexOf(quote);
        if (right.status === 'text' && start >= 0 && start < left.length && start + quote.length > left.length + separator.length) {
          entry.proof = 'text_across_pages';
          entry.throughPage = page + 1;
          break;
        }
      }
    }
    pages.push(entry);
  }
  return { sha256: pin.sha256, bytes: pin.bytes, totalPages: pin.pages, pages };
}

export async function readFhsDelivery({ sourceId, originalOperation, deliveryOperation = originalOperation }, ports) {
  if (!digest.test(originalOperation) || !digest.test(deliveryOperation) || originalOperation !== ports.originalOperation)
    throw Error('fhs_receipt_operation_binding');
  if (deliveryOperation !== originalOperation && !await ports.verifyRepair(originalOperation, deliveryOperation))
    throw Error('fhs_receipt_repair_binding');
  const work = await ports.inspect(deliveryOperation);
  const active = await ports.active();
  const row = { schema: 'fhs-publication-receipt/1', sourceId, originalOperation, deliveryOperation,
    outcome: work?.result?.status ?? (work?.waitingForQuotaDay ? 'waiting_for_quota' : work ? 'in_progress' : 'not_started'),
    code: work?.result?.code ?? null, modelCalls: work?.budget.modelCalls ?? 0, observationHash: work?.result?.observationHash ?? null };
  if (row.outcome !== 'published') {
    if (work?.receipt || work?.result?.published) throw Error('fhs_receipt_publication_mismatch');
    return { ...row, prepared: Boolean(work?.prepared), review: work?.prepared?.review.decision ?? null,
      quotaDay: work?.waitingForQuotaDay ?? null, otherActiveVersionId: active?.versionId ?? null };
  }
  const prepared = work.prepared;
  if (!work.result.published || work.receipt?.state !== 'committed' || !row.observationHash
    || work.receipt.observationHash !== row.observationHash || prepared?.review.decision !== 'approve_candidate'
    || !prepared.review.modelReviewCompleted || prepared.review.observationHash !== row.observationHash)
    throw Error('fhs_receipt_publication_mismatch');
  if (!active?.enabled || !active.current || active.versionHash !== prepared.versionHash || active.observationHash !== row.observationHash
    || active.source.sourceId !== sourceId || active.source.url !== ports.pin.url)
    return { ...row, readback: 'edition_not_current', versionHash: prepared.versionHash, otherActiveVersionId: active?.versionId ?? null };
  const card = await ports.familyCard(active.source.url, sourceId, active.versionId);
  if (!card?.enabled || card.versionId !== active.versionId || card.sourceId !== sourceId) throw Error('fhs_receipt_family_card_missing');
  const exported = await ports.exportEdition(sourceId, active.versionHash, card.seriesId);
  const expected = active.source.chunks.filter(chunk => needsKnowledgeVector(chunk.treatment)).map(chunk => chunk.key).sort();
  const actual = exported.embeddings.map(embedding => embedding.chunkKey).sort();
  if (exported.versionHash !== active.versionHash || exported.source.sourceId !== sourceId || exported.source.url !== active.source.url
    || expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) throw Error('fhs_receipt_export_mismatch');
  const metadata = { sourceId, versionId: active.versionId, versionHash: active.versionHash, url: active.source.url };
  const pdf = await verifyFhsPdfPages(metadata, exported.source, active.chunkIdentities, prepared.provenance.windows ?? [], ports.pin, ports);
  return { ...row, readback: pdf.pages.every(item => confirmedPages.has(item.proof)) ? 'verified' : 'citation_incomplete',
    card: { ...metadata, seriesId: card.seriesId }, vectors: { required: expected.length, exported: actual.length, chunkKeys: actual }, pdf };
}

async function main() {
  const [sourceId, originalOperation, deliveryOperation = originalOperation, ...extra] = process.argv.slice(2);
  if (!sourceId || !digest.test(originalOperation ?? '') || !digest.test(deliveryOperation) || extra.length)
    throw Error('Use fhs-publication-receipt.mjs SOURCE_ID ORIGINAL_OPERATION [DELIVERY_OPERATION]');
  const { openFirebasePersistence } = await import('../server/firebase-persistence.ts');
  const { createFirestoreKnowledgeRefresh } = await import('../server/firestore-knowledge-refresh.ts');
  const { createFirestoreKnowledgeWork, knowledgeTruncatedOutputRepairId, knowledgeOrganizationRepairId } = await import('../server/firestore-knowledge-work.ts');
  const { createFirestoreKnowledgeStore } = await import('../server/firestore-knowledge.ts');
  const { cloudKnowledgeOriginalBucket } = await import('../server/firestore-knowledge-originals.ts');
  const { campaignMaterialWatches, platformMaterials } = await import('../server/platform-materials.ts');
  const { platformSourceWatches } = await import('../server/knowledge-source-catalog.ts');
  const { campaignCredentials } = await import('../server/knowledge-campaign-budget.ts');
  const { knowledgeReviewHash } = await import('../server/knowledge-review-assessment.ts');
  const { retainedDraftWorkId } = await import('../server/knowledge-retained-draft.ts');
  const { extractKnowledgePdf } = await import('../server/knowledge-pdf.ts');
  const { openFhsPdfReads } = await import('./fhs-pdf-reads.ts');
  const definition = campaignMaterialWatches.find(w => w.id === sourceId && w.kind === 'pdf');
  const inventory = JSON.parse(await readFile(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8'));
  const pin = definition && inventory.pdfOriginals.find(pdf => pdf.url === definition.url);
  if (!pin) throw Error('fhs_receipt_source_unregistered');
  const directory = process.env.FHS_CAMPAIGN_PDF_READS, indexHash = process.env.FHS_CAMPAIGN_PDF_READS_SHA256;
  if (Boolean(directory) !== Boolean(indexHash)) throw Error('fhs_pdf_reads_configuration');
  const extract = directory ? await openFhsPdfReads(directory, indexHash) : extractKnowledgePdf;
  const persistence = await openFirebasePersistence(process.env);
  try {
    const { database, cipher, config, authority } = persistence;
    if (config.projectId !== 'ai-caregivers-for-children' || process.env.FIRESTORE_EMULATOR_HOST) throw Error('fhs_receipt_environment_mismatch');
    const domain = { ...config, database, cipher, readControl: tx => authority.readControl(tx) };
    const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: platformSourceWatches,
      originalBucket: cloudKnowledgeOriginalBucket(config.projectId, config.photoBucket) });
    const [job] = await refresh.jobs(sourceId);
    if (!job) throw Error('fhs_receipt_source_unregistered');
    const store = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, platformMaterials, observations: refresh.gate });
    const work = createFirestoreKnowledgeWork(domain);
    const inspect = operationFingerprint => work.inspect({ watchId: sourceId, workerGeneration: job.data.workerGeneration, publishMode: 'live', operationFingerprint });
    async function verifyRepair(original, delivery) {
      const truncated = knowledgeTruncatedOutputRepairId(original);
      let parent = original;
      if (delivery === retainedDraftWorkId(truncated)) parent = truncated;
      else if (![truncated, retainedDraftWorkId(original), knowledgeOrganizationRepairId(original)].includes(delivery)) return false;
      const prior = await inspect(parent), child = await inspect(delivery);
      if (!prior?.result?.observationHash || prior.result.status !== 'candidate_held' || prior.receipt || !child) return false;
      if (parent !== original || delivery === truncated) {
        const first = parent === original ? prior : await inspect(original);
        if (first?.result?.code !== 'model_output_limit' || first.result.observationHash !== prior.result.observationHash) return false;
      }
      return (!child.result || child.result.observationHash === prior.result.observationHash)
        && (delivery === truncated || child.reusedOrganizationFrom === parent || child.prepared?.provenance.retainedDraft?.priorWork === parent);
    }
    const ports = { originalOperation: knowledgeReviewHash([campaignCredentials, sourceId, job.data.revision, job.data.workerGeneration]),
      pin, inspect, verifyRepair, active: () => store.publishedEdition(sourceId),
      familyCard: (url, id, version) => database.runTransaction(async tx => {
        const result = await store.platformCards(tx, randomUUID(), undefined, url);
        return result.cards.find(card => card.sourceId === id && card.versionId === version);
      }, { readOnly: true }), exportEdition: (...args) => store.exportPublishedEdition(...args),
      resolve: citation => store.citedPdf(citation), readOriginal: (id, hash) => refresh.originals.readPdf(id, hash), extract };
    const row = await readFhsDelivery({ sourceId, originalOperation, deliveryOperation }, ports);
    console.log(JSON.stringify(row));
    if (row.readback && row.readback !== 'verified') process.exitCode = 2;
  } finally { await persistence.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
