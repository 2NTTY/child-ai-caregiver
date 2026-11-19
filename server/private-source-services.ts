import { FirestoreDomainData, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import type { createFirestoreSourceCardDocuments } from './firestore-source-card-documents.ts';
import type { FirestoreModelRouting } from './firestore-model-routing.ts';
import { FirestoreRootBudget } from './firestore-root-budget.ts';
import { createPrivateSourceModelSession } from './private-source-model-session.ts';
import { createPrivateSourceIndex, type OpenPrivateSession } from './private-source-index.ts';
import { createPrivateSourceSearch } from './private-source-search.ts';

export function createPrivateSourceServices(domain: FirestoreDomainOptions, documents:ReturnType<typeof createFirestoreSourceCardDocuments>,
  routing:FirestoreModelRouting,currentAuth:(owner:string)=>Promise<{userId:string;disabled:boolean;emailVerified:boolean}>) {
  const rootBudget = new FirestoreRootBudget({...domain,namespace:domain.namespace+'_root_budget'});
  const openSession: OpenPrivateSession = input => createPrivateSourceModelSession({...input,rootBudget,routing});
  const {process,readPrivateEvidence,privateIndexStatus} = createPrivateSourceIndex({domain,documents,routing,currentAuth,openSession});
  const searchPrivate = createPrivateSourceSearch({domain:new FirestoreDomainData(domain),documents,currentAuth,openSession});
  return {process,readPrivateEvidence,privateIndexStatus,searchPrivate};
}
