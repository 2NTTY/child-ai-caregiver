// Explicit one-item operator; never enumerates or deletes a bucket.
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { openFirebaseRuntime } from '../server/firebase-runtime.ts';
import { workRecoveryScopeSchema } from '../server/firestore-work-continuation-recovery.ts';
const inputSchema=z.object({scope:workRecoveryScopeSchema,photoId:z.uuid(),operationId:z.uuid()}).strict();
let runtime;
try {
  if (process.argv.length!==3) throw new Error('input');
  const text=await readFile(process.argv[2],'utf8');
  if (Buffer.byteLength(text)>4096) throw new Error('input');
  const input=inputSchema.parse(JSON.parse(text));
  runtime=await openFirebaseRuntime(process.env);
  const result=await runtime.photos.cleanupDeleted(input.scope,input.photoId,input.operationId);
  console.log(JSON.stringify({photoCleanup:result.state,backupRetentionUnchanged:true}));
  if(result.state!=='complete')process.exitCode=2;
} catch(error) {
  console.error(JSON.stringify({photoCleanup:'failed',code:typeof error?.code==='string'?error.code:'unavailable'}));
  process.exitCode=1;
} finally {await runtime?.close();}
