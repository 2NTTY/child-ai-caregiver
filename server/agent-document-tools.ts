import { createHash } from "node:crypto";
import { z } from "zod";
import { documentRequestSchema, documentPeriodSchema, documentChangeSchema, type FamilyDocument } from "../src/shared/family-documents.ts";
import type { FamilyDocumentStore } from "./family-document-store.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import { FamilyError } from "./family-access.ts";

// The disjoint action branches retain their strict validators but declare Vertex-compatible anyOf.
const documentChangeParameters = z.union(documentChangeSchema.options);

const receiptId = (runId: string, callId: string) => {
  const hash = createHash("sha256").update(`family-document:${runId}:${callId}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
};
const metadata = (item: FamilyDocument) => ({ id: item.id, kind: item.kind, purpose: item.purpose, version: item.version,
  status: item.status, readState: item.readState, title: item.current?.title ?? null,
  snapshotId: item.current?.id ?? null, snapshotVersion: item.current?.version ?? null,
  autoRefresh: item.autoRefresh, path: item.kind === "growth_report" ? "/growth?tab=archive" : "/summary?tab=preparation" });
export function createAgentDocumentTools(store: FamilyDocumentStore, agent: ProductAgentStore, run: AgentRunContext, authorize: () => Promise<boolean>): AgentTool[] {
  const { scope, runId } = run;
  const guard = async (action: () => Promise<AgentToolResult>): Promise<AgentToolResult> => {
    if (!await authorize()) return { status: "rejected" };
    try { return await action(); } catch(error) {
      if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
      if (error instanceof FamilyError) return { status: error.status === 409 ? "conflict" : "rejected", data: { code: error.code } };
      throw error;
    }
  };
  return [
    { name: "read_family_documents", description: "讀共享準備文件及成長報告；documentId=null 列清單，指定 ID 讀已核對來源的版本。invalidated 不讀舊正文。hasMore／contentPartial=true 表示範圍有限，不稱完整看過。", authorize,
      parameters: z.object({ documentId: z.uuid().nullable() }).strict(), execute: args => guard(async () => {
        const page = await store.list(scope.userId, scope.childId);
        if (!page) return { status: "rejected" };
        if (!args.documentId) return { status: "succeeded", data: { authorityVersion: page.authorityVersion, hasMore: page.hasMore || page.items.length > 20, items: page.items.slice(0,20).map(metadata) } };
        const item = await store.get(scope.userId, scope.childId, args.documentId as string);
        if (!item) return { status: "rejected" };
        const content = item.current;
        const includeContent = !!content && JSON.stringify(content).length <= 7000;
        return { status: "succeeded", data: { authorityVersion: page.authorityVersion, document: metadata(item), snapshot: includeContent ? content : null, contentPartial: !includeContent } };
      }) },
    { name: "generate_family_document", description: "家長明確要求時，直接按既有家庭共享資料整理準備文件或成長報告，回傳真實 ID／版本；不複製聊天或私人來源、不加入新健康事實、不通知人。報告後續按來源變化更新；準備單保留選定用途／期間。sourceQuote 逐字引用本次家長要求；日期不明先補問，不任意猜年齡或聲稱完整涵蓋。", authorize,
      parameters: z.object({ sourceQuote: z.string().min(2).max(1000), kind: z.enum(["preparation", "growth_report"]), purpose: z.enum(["appointment", "school", "outing", "handoff", "family"]), eventDate: z.string().nullable(), period: documentPeriodSchema }).strict(),
      execute: (args, context) => guard(async () => {
        const labels = { appointment: "到診準備", school: "入學／轉校準備", outing: "外出／旅行準備", handoff: "照顧交接", family: "家庭成長報告" };
        const { sourceQuote, ...values } = args;
        const request = documentRequestSchema.parse({ ...values, title: args.kind === "growth_report" ? "家庭成長報告" : labels[args.purpose as keyof typeof labels] });
        const opId = receiptId(runId, context.callId);
        const item = await agent.writeDocument(scope, runId, opId, sourceQuote as string, { request });
        return item ? { status: "succeeded", reference: item.id, data: { receiptId: opId, document: metadata(item), message: "已保存家庭資料整理；不是新確認事實或照護完成。" } } : { status: "rejected" };
      }) },
    { name: "change_family_document", description: "sourceQuote 逐字引用本次家長要求；先查原文件 ID／版本／authorityVersion，按家長明確要求重整、歸檔、重開或勾選文件清單。只改這份文件，不完成照護任務；來源已變先 refresh。歸檔保留歷史，不刪資料；不能改共享權限或複製私人原文。", authorize,
      parameters: z.object({ sourceQuote: z.string().min(2).max(1000), documentId: z.uuid(), change: documentChangeParameters }).strict(), execute: (args, context) => guard(async () => {
        const opId = receiptId(runId, context.callId), change = documentChangeSchema.parse(args.change);
        const item = await agent.writeDocument(scope, runId, opId, args.sourceQuote as string, { id: args.documentId as string, change });
        return item ? { status: "succeeded", reference: item.id, data: { receiptId: opId, document: metadata(item) } } : { status: "rejected" };
      }) },
  ];
}
