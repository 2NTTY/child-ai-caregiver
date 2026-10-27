import { z } from 'zod';

const receipt = z.object({state:z.literal('confirmed'),path:z.string(),statusCode:z.number().int(),
  operation:z.object({opId:z.uuid()})});
export class AttachmentDeleteReceiptError extends Error {
  readonly status:number;readonly code:string;
  constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
}

/** Recovery for the existing direct attachment API; never submits another deletion. */
export async function readAttachmentDeletionReceipt(baseUrl:string,fetcher:typeof fetch,
  original:{opId:string;path:string},signal:AbortSignal,userId:string):Promise<'accepted'|'unconfirmed'> {
  z.uuid().parse(original.opId);
  if(!userId||signal.aborted)throw new AttachmentDeleteReceiptError(0,'identity_changed');
  const base=baseUrl.replace(/\/$/u,'').replace(/\/api$/u,'')+'/api';
  let response:Response;
  try{response=await fetcher(base+'/online/operations/'+original.opId,{method:'GET',credentials:'include',cache:'no-store',signal,
    headers:{'x-expected-user-id':userId}});}catch{throw new AttachmentDeleteReceiptError(0,'attachment_delete_unknown');}
  if(!response.ok)throw new AttachmentDeleteReceiptError(response.status,'attachment_delete_unknown');
  let value:unknown;try{value=await response.json();}catch{throw new AttachmentDeleteReceiptError(0,'attachment_delete_unknown');}
  if(signal.aborted)throw new AttachmentDeleteReceiptError(0,'identity_changed');
  if(z.object({state:z.literal('unconfirmed')}).strict().safeParse(value).success)return 'unconfirmed';
  const parsed=receipt.safeParse(value);
  if(!parsed.success||parsed.data.operation.opId!==original.opId||parsed.data.path!==original.path||parsed.data.statusCode!==200)
    throw new AttachmentDeleteReceiptError(0,'attachment_delete_receipt_invalid');
  // Direct file/voice receipts confirm acceptance; the original delete endpoint completes the journal.
  return 'accepted';
}
