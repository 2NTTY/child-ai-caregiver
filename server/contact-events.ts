import type { PoolClient } from "pg";
export const CONTACT_QUEUE="care-contact-v1";
export const CONTACT_OPTIONS={heartbeatSeconds:60,expireInSeconds:90,retryLimit:2,retryDelay:5,retryBackoff:false,retentionSeconds:14*86400,deleteAfterSeconds:7*86400};
export interface ContactQueue {
 enqueue(client:PoolClient,requestId:string,jobId:string,at:string):Promise<void>;
 onGrant?(client:PoolClient,workId:string,reminderId:string,eventId:string):Promise<void>;
}
