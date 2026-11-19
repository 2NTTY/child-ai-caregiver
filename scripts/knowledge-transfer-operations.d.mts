import type { createKnowledgeTransfers } from '../server/firestore-knowledge-transfers.ts';
import type { FirestoreKnowledgeStore } from '../server/firestore-knowledge.ts';
import type { KnowledgeTransferBatch } from '../server/knowledge-transfer-records.ts';
import type { KnowledgeArchive } from './knowledge-transfer-zip.mjs';
export function readPortableEdition(raw: unknown, entry: { sourceId: string; versionHash: string }): {
  source: import('../src/shared/knowledge.ts').KnowledgeSourceInput; embeddings: import('../server/firestore-knowledge.ts').FirestoreKnowledgeEmbedding[];
  library?: import('../server/knowledge-portable-series.ts').PortableSeries;
};
export function importKnowledgePage(options:{
  ledger:ReturnType<typeof createKnowledgeTransfers>; store:Pick<FirestoreKnowledgeStore,'importSource'>;
  archive:KnowledgeArchive; digest:string; operator:string; limit:number; signal?:AbortSignal; expectedRevision?:number;
}):Promise<KnowledgeTransferBatch>;
