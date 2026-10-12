import { GoogleAuth } from "google-auth-library";
import { z } from "zod";

export const FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS = 30_000;
export const FIREBASE_NATIVE_RECOVERY_PAGE_SIZE = 100;
export const FIREBASE_NATIVE_RECOVERY_MAX_PAGES = 10;
const BASE_URL = "https://firestore.googleapis.com/v1/";
const EXPORT_TYPE = "type.googleapis.com/google.firestore.admin.v1.ExportDocumentsMetadata";
const IMPORT_TYPE = "type.googleapis.com/google.firestore.admin.v1.ImportDocumentsMetadata";
const uuid = z.uuid().refine(value => value === value.toLowerCase());
const databaseId = z.string().regex(/^[a-z][a-z0-9-]{2,61}[a-z0-9]$/u);
const timestampSchema = z.string().max(64).pipe(z.iso.datetime({offset:true}));
export interface FirebaseNativeRecoveryOperation {
  name: string; done?: boolean; metadata?: unknown; response?: unknown; error?: unknown;
}
export type FirebaseNativeRecoveryRequest = Readonly<{
  method: "GET"; url: string; params?: Readonly<{pageSize: 100; pageToken?: string}>;
  retry: false; timeout: 30000;
}> | Readonly<{
  method: "POST"; url: string;
  data: Readonly<{outputUriPrefix: string; snapshotTime: string}> | Readonly<{inputUriPrefix: string}>;
  retry: false; timeout: 30000;
}>;
export type FirebaseNativeRecoveryTransport = (request: FirebaseNativeRecoveryRequest) => Promise<Readonly<{status: number; data: unknown}>>;
export interface FirebaseNativeRecoveryOptions {
  projectId: string; sourceDatabaseId: string; targetDatabaseId: string; backupBucketName: string;
  request?: FirebaseNativeRecoveryTransport;
}
export interface FirebaseNativeRecovery {
  startExport(input: {backupId: string; snapshotTime: string}): Promise<FirebaseNativeRecoveryOperation>;
  startImport(input: {backupId: string; outputUriPrefix: string}): Promise<FirebaseNativeRecoveryOperation>;
  getExport(operationName: string): Promise<FirebaseNativeRecoveryOperation>;
  getImport(operationName: string): Promise<FirebaseNativeRecoveryOperation>;
  findExport(input: {backupId: string}): Promise<FirebaseNativeRecoveryOperation | null>;
  findImport(input: {backupId: string; outputUriPrefix: string}): Promise<FirebaseNativeRecoveryOperation | null>;
}
type Direction = "export" | "import";
type ErrorCode = "native_recovery_invalid" | "native_export_unknown" | "native_import_unknown"
  | "native_export_unavailable" | "native_import_unavailable" | "native_export_ambiguous" | "native_import_ambiguous"
  | "native_export_snapshot_conflict";
export class FirebaseNativeRecoveryError extends Error {
  readonly code: ErrorCode; readonly status: 400 | 409 | 503;
  constructor(code: ErrorCode,status: FirebaseNativeRecoveryError["status"]) {
    super(code);this.name="FirebaseNativeRecoveryError";this.code=code;this.status=status;
  }
}
function fail(code: ErrorCode,status: FirebaseNativeRecoveryError["status"]): never {throw new FirebaseNativeRecoveryError(code,status);}
function input<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value);if(!parsed.success)fail("native_recovery_invalid",400);return parsed.data;
}
const configSchema=z.object({
  projectId:z.string().regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u),sourceDatabaseId:databaseId,targetDatabaseId:databaseId,
  backupBucketName:z.string().min(3).max(222).regex(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/u),
  request:z.custom<FirebaseNativeRecoveryTransport>(value=>typeof value==="function").optional(),
}).strict().refine(value=>value.sourceDatabaseId!==value.targetDatabaseId);
const operationSchema:z.ZodType<FirebaseNativeRecoveryOperation>=z.object({
  name:z.string().min(1).max(1500),done:z.boolean().optional(),metadata:z.unknown().optional(),response:z.unknown().optional(),error:z.unknown().optional(),
}).passthrough();
const metadataRecord=(value:unknown):Record<string,unknown>|null =>
  value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** ADC supplies native headers, including quota-project headers. No auth-layer replay of a mutating request. */
function googleTransport():FirebaseNativeRecoveryTransport {
  let auth:GoogleAuth|undefined;
  return async request=>{
    auth??=new GoogleAuth({scopes:["https://www.googleapis.com/auth/datastore"]});
    const client=await auth.getClient(),headers=await client.getRequestHeaders(request.url);
    // OAuth2Client.request may refresh and replay on 401/403 even when gaxios retry is false.
    const response=await client.transporter.request<unknown>({
      ...request,headers,retry:false,retryConfig:{retry:0},maxRedirects:0,
    });
    return {status:response.status,data:response.data};
  };
}

/** Operator-only native jobs. Empty-target, paused-source, inventory and hold gates belong to the orchestrator. */
export function createFirebaseNativeRecovery(options:FirebaseNativeRecoveryOptions):FirebaseNativeRecovery {
  const config=input(configSchema,options),request=config.request??googleTransport();
  const resource=(direction:Direction)=>"projects/"+config.projectId+"/databases/"
    +(direction==="export"?config.sourceDatabaseId:config.targetDatabaseId);
  const operations=(direction:Direction)=>resource(direction)+"/operations/";
  function unavailable(direction:Direction):never {fail(direction==="export"?"native_export_unavailable":"native_import_unavailable",503);}
  function unknown(direction:Direction):never {fail(direction==="export"?"native_export_unknown":"native_import_unknown",503);}
  const output=(backupId:string)=>"gs://"+config.backupBucketName+"/firebase-backups/v1/"+backupId+"/firestore";
  function operationName(direction:Direction,value:unknown,caller=false):string {
    const prefix=operations(direction);
    if(typeof value!=="string"||!value.startsWith(prefix)) {
      if(caller)fail("native_recovery_invalid",400);unavailable(direction);
    }
    const id=value.slice(prefix.length);
    // An operation identifier is one URL segment; never accept a URL, traversal or encoded path.
    if(!/^[a-zA-Z0-9._~!$&'()*+,;=:@-]{1,1024}$/u.test(id)||id==="."||id==="..") {
      if(caller)fail("native_recovery_invalid",400);unavailable(direction);
    }
    return value;
  }
  function operation(direction:Direction,value:unknown):FirebaseNativeRecoveryOperation {
    const parsed=operationSchema.safeParse(value);if(!parsed.success)unavailable(direction);
    operationName(direction,parsed.data.name);
    const metadata=metadataRecord(parsed.data.metadata),type=metadata?.["@type"];
    if(type!==undefined && type!==(direction==="export"?EXPORT_TYPE:IMPORT_TYPE))unavailable(direction);
    return parsed.data;
  }
  function importPrefix(backupId:string,value:string):string {
    const root=output(backupId);
    if(value!==root&&!value.startsWith(root+"/"))fail("native_recovery_invalid",400);
    const path=value.slice("gs://".length);
    if(Buffer.byteLength(value)>1500||!value.isWellFormed()||/[\u0000-\u0020\u007f\\?#%]/u.test(value)
      ||path.split("/").some(part=>part===""||part==="."||part===".."))fail("native_recovery_invalid",400);
    return value;
  }
  function snapshot(value:string):number {
    const parsed=timestampSchema.safeParse(value),at=parsed.success?Date.parse(parsed.data):NaN;
    if(!parsed.success||!Number.isFinite(at)||at%60_000!==0
      ||!/T[0-9]{2}:[0-9]{2}:00(?:\.0{1,9})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/u.test(value))fail("native_recovery_invalid",400);
    return at;
  }
  async function get(direction:Direction,name:string) {
    operationName(direction,name,true);
    try {
      const id=name.slice(operations(direction).length);
      const response=await request({method:"GET",url:BASE_URL+operations(direction)+encodeURIComponent(id),
        retry:false,timeout:FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS});
      if(response.status!==200)unavailable(direction);
      const result=operation(direction,response.data);if(result.name!==name)unavailable(direction);return result;
    }catch {unavailable(direction);}
  }
  async function find(direction:Direction,backupId:string,prefix:string):Promise<FirebaseNativeRecoveryOperation|null> {
    const matches:FirebaseNativeRecoveryOperation[]=[],tokens=new Set<string>(),names=new Set<string>();
    let pageToken:string|undefined;
    try {
      for(let page=0;page<FIREBASE_NATIVE_RECOVERY_MAX_PAGES;page++){
        const response=await request({method:"GET",url:BASE_URL+resource(direction)+"/operations",
          params:{pageSize:FIREBASE_NATIVE_RECOVERY_PAGE_SIZE,...(pageToken===undefined?{}:{pageToken})},
          retry:false,timeout:FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS});
        if(response.status!==200)unavailable(direction);
        const parsed=z.object({operations:z.array(z.unknown()).max(FIREBASE_NATIVE_RECOVERY_PAGE_SIZE).optional(),
          nextPageToken:z.string().min(1).max(4096).optional()}).safeParse(response.data);
        if(!parsed.success)unavailable(direction);
        const rows=parsed.data.operations??[];
        for(const raw of rows){
          // Other admin operations in the same database are allowed, but none may escape its resource.
          const basic=operationSchema.safeParse(raw);if(!basic.success)unavailable(direction);
          operationName(direction,basic.data.name);
          if(names.has(basic.data.name))unavailable(direction);names.add(basic.data.name);
          const metadata=metadataRecord(basic.data.metadata),field=metadata?.[direction==="export"?"outputUriPrefix":"inputUriPrefix"];
          const matchesPrefix=typeof field==="string"&&(field===prefix||direction==="export"&&field.startsWith(prefix+"/"));
          if(matchesPrefix){
            if(direction==="export")importPrefix(backupId,field as string);
            matches.push(operation(direction,basic.data));
          }
        }
        if(parsed.data.nextPageToken===undefined){
          if(matches.length>1)fail(direction==="export"?"native_export_ambiguous":"native_import_ambiguous",409);
          return matches[0]??null;
        }
        if(!rows.length||tokens.has(parsed.data.nextPageToken))unavailable(direction);
        tokens.add(parsed.data.nextPageToken);pageToken=parsed.data.nextPageToken;
      }
      unavailable(direction);
    }catch(error){
      if(error instanceof FirebaseNativeRecoveryError && (error.code==="native_export_ambiguous"||error.code==="native_import_ambiguous"))throw error;
      unavailable(direction);
    }
  }
  async function post(direction:Direction,data:Readonly<{outputUriPrefix:string;snapshotTime:string}>|Readonly<{inputUriPrefix:string}>) {
    try {
      const response=await request({method:"POST",url:BASE_URL+resource(direction)+(direction==="export"?":exportDocuments":":importDocuments"),
        data,retry:false,timeout:FIREBASE_NATIVE_RECOVERY_TIMEOUT_MS});
      if(response.status!==200)unknown(direction);
      return operation(direction,response.data);
    }catch {unknown(direction);}
  }
  return {
    async startExport(value){
      const parsed=input(z.object({backupId:uuid,snapshotTime:timestampSchema}).strict(),value),at=snapshot(parsed.snapshotTime),now=Date.now();
      if(at>=now||now-at>55*60_000)fail("native_recovery_invalid",400);
      const prefix=output(parsed.backupId),existing=await find("export",parsed.backupId,prefix);
      if(existing){
        const current=metadataRecord(existing.metadata)?.snapshotTime;
        let existingAt:number;
        try {existingAt=typeof current==="string"?snapshot(current):NaN;}catch {existingAt=NaN;}
        if(existingAt!==at)fail("native_export_snapshot_conflict",409);
        return existing;
      }
      return post("export",{outputUriPrefix:prefix,snapshotTime:parsed.snapshotTime});
    },
    async startImport(value){
      const parsed=input(z.object({backupId:uuid,outputUriPrefix:z.string().min(1).max(1500)}).strict(),value);
      const prefix=importPrefix(parsed.backupId,parsed.outputUriPrefix),existing=await find("import",parsed.backupId,prefix);
      return existing??post("import",{inputUriPrefix:prefix});
    },
    getExport:name=>get("export",name),
    getImport:name=>get("import",name),
    async findExport(value){
      const parsed=input(z.object({backupId:uuid}).strict(),value);return find("export",parsed.backupId,output(parsed.backupId));
    },
    async findImport(value){
      const parsed=input(z.object({backupId:uuid,outputUriPrefix:z.string().min(1).max(1500)}).strict(),value);
      return find("import",parsed.backupId,importPrefix(parsed.backupId,parsed.outputUriPrefix));
    },
  };
}