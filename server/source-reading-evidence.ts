import type { RegisteredSourceCard, SourceGapReason, SourceReadingMethod } from '../src/shared/registered-source-card.ts';
import type { SourceCardDocumentRecord, SourceCardEdition } from './source-card-document-record.ts';
import type { SourceScanBatch } from './source-card-frontier.ts';

type Receipt = Extract<SourceCardDocumentRecord, { kind: 'receipt' }>;
export interface SourceReadingReport {
  methods: SourceReadingMethod[];
  gap?: { url: string; reason: SourceGapReason };
}

export function readingReport(receipt: Receipt | null): SourceReadingReport {
  const methods = receipt?.prospects?.flatMap(p => p.verified && !receipt.issueExamples.some(issue => issue.url === p.url) ? [p.verified] : []) ?? [];
  if (receipt?.accessGate) return { methods, gap: receipt.accessGate };
  const problem = receipt?.issueExamples.find(issue => issue.reason !== 'unverified_hint' && !methods.some(m => m.covers === issue.url));
  if (problem && problem.reason !== 'unverified_hint') return { methods, gap: { url: problem.url, reason: problem.reason } };
  const incomplete = receipt?.prospects?.find(p => !p.verified && !p.storedOnly && !methods.some(m => m.covers === p.url));
  return incomplete && !receipt?.pending ? { methods, gap: { url: incomplete.url, reason: incomplete.reduced ? 'listing_changed' : 'unreadable' } } : { methods };
}

export function observeMethods(prior: Receipt | null, batch: SourceScanBatch, editions: SourceCardEdition[], verifiedAt: string) {
  const prospects = (prior?.prospects ?? []).map(p => ({ ...p }));
  if (batch.candidate) {
    const previous = prospects.find(p => p.url === batch.candidate!.url);
    if (previous && !previous.verified) Object.assign(previous, batch.candidate);
    else if (!previous && prospects.length < 8) prospects.push({ ...batch.candidate });
  }
  for (const p of prospects) {
    if (p.verified || p.reduced) continue;
    const observed = new Set(p.samples);
    for (const redirect of batch.redirects ?? []) {
      if (observed.has(redirect.from) && batch.items.slice(0, batch.consumed).some(i => i.url === redirect.from)) observed.add(redirect.to);
    }
    const matches = editions.filter(e => observed.has(e.url));
    const sample = matches.find(e => e.indexCoverage !== 'original_only');
    if (!sample && matches.length) p.storedOnly = true;
    if (sample) p.verified = { schema: 1, revision: 1, url: p.url, parser: p.parser, verifiedAt, ...(p.feedUrl ? { feedUrl: p.feedUrl } : {}),
      sample: { url: sample.url, documentId: sample.documentId, version: sample.version }, ...(p.listed ? { listed: p.listed } : {}), ...(p.covers ? { covers: p.covers } : {}) };
    else if (batch.next.length && p.samples.includes(batch.items[batch.consumed - 1]!.url)) {
      // A catalogue can lead through an intermediate listing before reaching an original.
      p.samples = [...new Set([...batch.next.filter(item => !item.offset).map(i => i.url), ...p.samples])].slice(0, 16);
    }
  }
  return prospects;
}

export function applyReadingReport(card: Omit<RegisteredSourceCard, 'checking'>, report: SourceReadingReport, checkId: string) {
  const { gap: previous, methods: prior, hint: oldHint, ...settings } = card;
  const methods = [...(prior ?? [])];
  for (const verified of report.methods) {
    const index = methods.findIndex(m => m.url === verified.url);
    if (index >= 0) {
      const old = methods[index]!;
      const changed = old.parser !== verified.parser || old.feedUrl !== verified.feedUrl || old.covers !== verified.covers;
      if (changed || old.listed !== verified.listed || old.sample.version !== verified.sample.version || old.sample.url !== verified.sample.url)
        methods[index] = { ...verified, revision: old.revision + Number(changed) };
    } else if (methods.length < 8) methods.push(verified);
  }
  const checkingHint = oldHint?.status === 'pending' && oldHint.afterCheckId !== checkId;
  const verifiedHint = checkingHint && report.methods.some(m => m.url === oldHint.url);
  const hint = checkingHint ? { ...oldHint, status: verifiedHint ? 'verified' as const : 'rejected' as const } : oldHint;
  const gap = checkingHint && !verifiedHint ? previous : report.gap ?
    (previous?.url === report.gap.url && previous.reason === report.gap.reason ? previous : { ...report.gap, checkId, skipped: false }) : undefined;
  return { ...settings, ...(methods.length ? { methods } : {}), ...(gap ? { gap } : {}), ...(hint ? { hint } : {}) };
}
