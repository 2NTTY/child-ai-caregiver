#!/bin/sh
set -eu
docker exec -i yuban-p1-api-1 node --input-type=module <<'JS'
import { openFirebasePersistence } from './server/firebase-persistence.ts';
import { FirestoreDomainData } from './server/firestore-domain-data.ts';
import { firestoreAgentAdmissionRecoverySchema } from './server/firestore-agent-admission.ts';
const p = await openFirebasePersistence(process.env);
try {
  const d = new FirestoreDomainData({database:p.database,cipher:p.cipher,projectId:p.config.projectId,namespace:p.config.namespace});
  const zero = '00000000-0000-0000-0000-000000000000';
  const scope = {ownerUserId:'system:agent-admission',workspaceId:zero,childId:zero,storageEpoch:zero};
  const row = await d.ref('agent_admission','agent-admission','active').get();
  const agent = row.exists ? d.open('agent-admission','active',scope,firestoreAgentAdmissionRecoverySchema,row).leases.filter(l=>l.expiresAtMs>Date.now()).length : 0;
  let busy = agent > 0;
  console.log('active_agent_leases',agent);
  const activeRows = await d.collection('task_outbox').where('state','==','leased').orderBy('leaseUntil').select('state','leaseUntil').limit(51).get();
  if (activeRows.size > 50) throw Error('active_reminder_check_bound');
  const liveLease = m => m.state==='leased' && (!m.leaseUntil || !(Date.parse(m.leaseUntil)<=Date.now()));
  const activeReminders = activeRows.docs.filter(s => liveLease(s.data())).length;
  const jobs=d.collection('background_work');
  const ordered=q=>q.orderBy('dispatch').orderBy('dueAt').orderBy('id');
  const leased=await ordered(jobs.where('state','==','leased')).select('state','leaseUntil').limit(51).get();
  if(leased.size>50) throw Error('active_background_check_bound');
  const activeBackground=leased.docs.filter(s=>liveLease(s.data())).length;
  const pending=jobs.where('state','==','pending');
  const count=async q=>(await q.count().get()).data().count;
  const sending=await count(pending.where('dispatch','==','sending').orderBy('dueAt').orderBy('id'));
  const unresolved=await count(pending.where('dispatch','in',['unknown','needs_attention']).orderBy('dueAt').orderBy('id'));
  const unknown=await count(ordered(jobs.where('state','==','unknown')));
  console.log('background_work',JSON.stringify({active:activeBackground,sending,unknown,unresolved}));
  busy ||= activeReminders>0 || activeBackground>0 || sending>0;
  if(busy) process.exitCode=2;
} finally { await p.close(); }
JS
