import type { FirestoreSharedInputStore } from './firestore-shared-inputs.ts';
import type { FirestoreAgentProposalExtension } from './firestore-agent-proposals.ts';
import { domainReject } from './firestore-domain-data.ts';

/** The existing private-source candidate is the only model entry into these writes. */
export function createFirestoreAgentSources(sources: FirestoreSharedInputStore): FirestoreAgentProposalExtension {
  return {
    supports: value => value.kind === 'private_source_create' || value.kind === 'private_source_change',
    async target(b, value) {
      if (value.kind === 'private_source_create') return { label: value.input.sourceLabel, visibility: 'private', sourceBasis: null };
      if (value.kind !== 'private_source_change') domainReject('invalid_input', 400);
      const source = await sources.read(b, value.inputId);
      if (source.version !== value.change.expectedVersion) domainReject('version_conflict');
      return { label: source.sourceLabel, visibility: 'private', sourceBasis: null };
    },
    async prepare(b, saved, opId) {
      const value = saved.proposal.value;
      if (value.kind !== 'private_source_create' && value.kind !== 'private_source_change') domainReject('invalid_input', 400);
      const prepared = value.kind === 'private_source_create' ? await sources.prepareCreate(b, opId, value.input, value.management)
        : await sources.prepareManage(b, opId, value.inputId, value.change);
      return { result: { kind: 'private_source', id: prepared.value.id, version: prepared.value.version },
        changeSeq: prepared.changeSeq, commit: prepared.commit };
    },
  };
}
