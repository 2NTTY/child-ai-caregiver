export interface KnowledgeArchive {
  entries: readonly {sourceId:string; versionHash:string; sha256:string}[];
  readEdition(index:number):Promise<unknown>;
  close():Promise<void>;
}
export function writeKnowledgeArchive(path: string, selection: readonly { sourceId: string; versionHash: string }[],
  readEdition: (entry: { sourceId: string; versionHash: string }) => Promise<unknown>): Promise<{ sha256: string; count: number }>;
export function openKnowledgeArchive(path:string, digest:string, signal?:AbortSignal):Promise<KnowledgeArchive>;
