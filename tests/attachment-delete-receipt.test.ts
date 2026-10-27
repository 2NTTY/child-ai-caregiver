import assert from 'node:assert/strict';
import test from 'node:test';
import { readAttachmentDeletionReceipt } from '../src/client/attachment-delete-receipt.ts';

test('attachment deletion recovery reads the original receipt and rejects a different operation or resource', async () => {
  const opId='00000000-0000-4000-8000-000000000001';
  const path='/api/children/00000000-0000-4000-8000-000000000002/files/00000000-0000-4000-8000-000000000003/delete';
  let value: unknown={state:'unconfirmed'};
  const fetcher: typeof fetch=async (url,init)=>{
    assert.equal(String(url),'https://example.test/api/online/operations/'+opId);
    assert.equal(init?.method,'GET'); assert.equal(init?.credentials,'include'); assert.equal(init?.cache,'no-store');
    assert.equal(new Headers(init?.headers).get('x-expected-user-id'),'carer');
    return Response.json(value);
  };
  const read=()=>readAttachmentDeletionReceipt('https://example.test',fetcher,{opId,path},new AbortController().signal,'carer');
  assert.equal(await read(),'unconfirmed');
  const receipt={state:'confirmed',path,operation:{opId,workspaceId:'w',storageEpoch:'e',deviceId:'d'},changeSeq:'1',statusCode:200,result:null};
  value=receipt; assert.equal(await read(),'accepted');
  value={...receipt,operation:{...receipt.operation,opId:'different'}}; await assert.rejects(read,/attachment_delete_receipt_invalid/);
  value={...receipt,path:path.replace('/files/','/voices/')}; await assert.rejects(read,/attachment_delete_receipt_invalid/);
});
