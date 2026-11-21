import { createHash, randomUUID } from 'node:crypto';
import type { FirestoreDomainData } from '../../server/firestore-domain-data.ts';
import { firestoreSpecialistDraftSchema } from '../../server/firestore-agent-documents.ts';
import type { WorkRecoveryScope } from '../../server/firestore-work-continuation-recovery.ts';
import { SPECIALIST_ARTIFACT_POLICY_VERSION, type SpecialistArtifactSummary } from '../../src/shared/specialist-artifact.ts';

export function specialistDraftFixture(data: FirestoreDomainData, scope: WorkRecoveryScope, runId: string = randomUUID()) {
  const artifactId = randomUUID(), documentId = randomUUID();
  const bytes = Buffer.from('<main>synthetic unfinished private draft</main>');
  const artifactHash = createHash('sha256').update(bytes).digest('hex');
  const summary: SpecialistArtifactSummary = {
    artifactId, runId, documentId, expectedVersion: 1, authorityVersion: 'test:1', artifactVersion: 1,
    artifactHash, format: 'html', mimeType: 'text/html', fileName: 'draft.html', title: 'Synthetic',
    byteLength: bytes.length, pageCount: 1, status: 'verified', stopReason: 'verified', repairIterations: 0,
    verification: { policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION, format: 'html', artifactVersion: 1, artifactHash, passed: true,
      pageCount: 1, defects: [], unverifiedChecks: [], extractedTextSample: 'synthetic' },
    formalSave: false, published: false, requiresFormalConfirmation: true, contentState: 'ready',
  };
  const kind = 'agent-specialist-draft', id = JSON.stringify([scope.ownerUserId, runId, artifactId]);
  const ref = data.ref('agent_specialist_drafts', kind, id);
  return { path: ref.path, summary, data: { ...data.tags(scope), runId, artifactId, ...data.seal(kind, id, scope, firestoreSpecialistDraftSchema,
    { summary, bytesBase64: bytes.toString('base64') }) } };
}
