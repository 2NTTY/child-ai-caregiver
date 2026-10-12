import { createHash } from "node:crypto";
import { z } from "zod";
import { documentRequestSchema, documentPeriodSchema, documentChangeSchema, documentPatchSchema, type DocumentContentQuery, type FamilyDocument } from "../src/shared/family-documents.ts";
import { agentProposalSchema } from "../src/shared/product-agent.ts";
import type { FamilyDocumentStore } from "./family-document-store.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import type { ProductAgentStore } from "./product-agent-store.ts";
import { FamilyError } from "./family-access.ts";
import { AGENT_DOCUMENT_TOOL_DESCRIPTIONS } from "./agent-document-tool-descriptions.ts";

const structuralEdit = z.discriminatedUnion("op", [
  z.object({ op: z.literal("remove_section"), sectionId: z.string().min(1).max(80) }).strict(),
  z.object({ op: z.literal("move_section"), sectionId: z.string().min(1).max(80), beforeId: z.string().min(1).max(80).nullable() }).strict(),
  z.object({ op: z.literal("remove_item"), sectionId: z.string().min(1).max(80), itemId: z.string().min(1).max(100) }).strict(),
  z.object({ op: z.literal("move_item"), sectionId: z.string().min(1).max(80), itemId: z.string().min(1).max(100), beforeId: z.string().min(1).max(100).nullable() }).strict(),
]);
// Vertex-compatible anyOf declarations; strict validators remain on each disjoint branch.
const documentChangeParameters = z.union([...documentChangeSchema.options.filter(option => option.shape.action.safeParse("patch").success === false),
  documentPatchSchema.extend({ edits: z.array(z.union(structuralEdit.options)).min(1).max(12) })]);
const patchParameters = documentPatchSchema.extend({ edits: z.array(z.union(documentPatchSchema.shape.edits.element.options)).min(1).max(12) });
const receiptId = (runId: string, callId: string) => {
  const hash = createHash("sha256").update(`family-document:${runId}:${callId}`).digest("hex");
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
};
const metadata = (item: FamilyDocument) => ({ id: item.id, kind: item.kind, purpose: item.purpose, version: item.version,
  status: item.status, readState: item.readState, title: item.current?.title ?? item.report?.title ?? null, report: item.report ?? null,
  snapshotId: item.current?.id ?? item.manifest?.snapshotId ?? null, snapshotVersion: item.current?.version ?? item.manifest?.snapshotVersion ?? null,
  autoRefresh: item.autoRefresh, path: item.kind === "growth_report" ? "/growth?tab=archive" : "/summary?tab=preparation" });
export function createAgentDocumentTools(store: FamilyDocumentStore, agent: ProductAgentStore, run: AgentRunContext, authorize: () => Promise<boolean>): AgentTool[] {
  const { scope, runId } = run;
  type Description = NonNullable<Awaited<ReturnType<FamilyDocumentStore["describe"]>>>;
  type SavedReceipt = { receiptId: string; message?: string };
  const fits = (result: AgentToolResult) => JSON.stringify(result).length <= Math.min(8000, run.budget.toolResponseCharacters) - 256;
  const minimal = (item: FamilyDocument, saved?: SavedReceipt, authorityVersion?: string): AgentToolResult => ({
    status: "succeeded", ...(saved ? { reference: item.id } : {}), data: {
      ...(saved ? { receiptId: saved.receiptId } : {}), document: { id: item.id, version: item.version },
      ...(authorityVersion ? { authorityVersion } : {}), contentPartial: true, readRequired: true, snapshot: null,
    },
  });
  const view = (description: Description, saved?: SavedReceipt): AgentToolResult => {
    const item = description.item;
    const result: AgentToolResult = { status: "succeeded", ...(saved ? { reference: item.id } : {}), data: {
      ...(saved ?? {}), authorityVersion: description.authorityVersion, document: metadata(item),
      manifest: item.manifest ? { snapshotId: item.manifest.snapshotId, snapshotVersion: item.manifest.snapshotVersion,
        invalidated: item.manifest.invalidated, sections: item.manifest.sections.slice(0, 20).map(section => ({ id: section.id, kind: section.kind, itemCount: section.itemIds.length })) } : null,
      manifestPartial: (item.manifest?.sections.length ?? 0) > 20, contentPartial: true, readRequired: true, snapshot: null,
    } };
    if (item.readState === "ready" && item.current && !item.manifest?.invalidated) {
      const complete: AgentToolResult = { ...result, data: { ...result.data, snapshot: item.current, contentPartial: false, readRequired: false } };
      if (fits(complete)) return complete;
    }
    return fits(result) ? result : minimal(item, saved, description.authorityVersion);
  };
  const savedView = async (item: FamilyDocument, saved: SavedReceipt): Promise<AgentToolResult> => {
    // A successful write receipt survives any failed or changed readback; never invite a duplicate write.
    const fallback = minimal(item, saved);
    try {
      if (!await authorize()) return fallback;
      const description = await store.describe(scope.userId, scope.childId, item.id);
      if (!description || description.item.id !== item.id || description.item.version !== item.version) return fallback;
      const written = metadata(item), current = metadata(description.item);
      if (current.snapshotId !== written.snapshotId || current.snapshotVersion !== written.snapshotVersion) return fallback;
      return view(description, saved);
    } catch { return fallback; }
  };
  const guard = async (action: () => Promise<AgentToolResult>): Promise<AgentToolResult> => {
    if (!await authorize()) return { status: "rejected" };
    try { return await action(); } catch(error) {
      if (error instanceof z.ZodError) return { status: "rejected", data: { code: "invalid_input" } };
      if (error instanceof FamilyError) return { status: error.status === 409 ? "conflict" : "rejected", data: { code: error.code } };
      throw error;
    }
  };
  return [
    { name: "read_family_documents", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.read_family_documents, authorize,
      parameterErrorHints: () => [{ path: "documentId", reason: "invalid_parameters", expected: 'To list documents use {"documentId":null}; to read one use the exact UUID returned by that list. Optional cursor must be null or a returned nextCursor; optional status is all, active or archived. Omit other keys.' }],
      parameters: z.object({ documentId: z.uuid().nullable(), cursor: z.string().max(2048).nullable().optional(), status: z.enum(["all", "active", "archived"]).optional() }).strict(), execute: args => guard(async () => {
        if (!args.documentId) {
          const page = await store.list(scope.userId, scope.childId, { cursor: args.cursor as string | null ?? null, status: args.status as "all" | "active" | "archived" ?? "all", limit: 10 });
          return page ? { status: "succeeded", data: { authorityVersion: page.authorityVersion, hasMore: page.hasMore, nextCursor: page.nextCursor ?? null, items: page.items.map(metadata) } } : { status: "rejected" };
        }
        if (args.cursor) return { status: "rejected", data: { code: "invalid_input" } };
        const description = await store.describe(scope.userId, scope.childId, args.documentId as string);
        if (!description) return { status: "rejected" };
        return view(description);
      }) },
    { name: "read_family_document_content", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.read_family_document_content, authorize,
      parameters: z.object({ documentId: z.uuid(), snapshotId: z.uuid(), snapshotVersion: z.number().int().min(1), offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(), execute: args => guard(async () => {
        const { documentId, ...input } = args;
        const page = await store.readContent(scope.userId, scope.childId, documentId as string, input as DocumentContentQuery);
        if (!page) return { status: "rejected", data: { code: "not_found" } };
        // JSON escaping and function-response wrappers also consume the current tool budget.
        const allowance = Math.min(8000, run.budget.toolResponseCharacters) - 256;
        while (page.text.length && JSON.stringify({ status: "succeeded", data: page }).length > allowance) {
          page.text = page.text.slice(0, Math.max(0, page.text.length - 128));
          page.nextOffset = page.offset + page.text.length; page.complete = false;
        }
        return page.text.length || page.complete ? { status: "succeeded", data: { ...page } } : { status: "rejected", data: { code: "response_limit" } };
      }) },
    { name: "list_family_document_versions", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.list_family_document_versions, authorize,
      parameters: z.object({ documentId: z.uuid(), cursor: z.string().max(2048).nullable() }).strict(), execute: args => guard(async () => {
        const page = await store.listVersions(scope.userId, scope.childId, args.documentId as string, args.cursor as string | null);
        return page ? { status: "succeeded", data: { ...page } } : { status: "rejected", data: { code: "not_found" } };
      }) },
    { name: "generate_family_document", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.generate_family_document, authorize,
      parameters: z.object({ sourceQuote: z.string().min(1).max(1000).refine(value => Boolean(value.trim())), kind: z.enum(["preparation", "growth_report"]), purpose: z.enum(["appointment", "school", "outing", "handoff", "family"]), eventDate: z.string().nullable(), period: documentPeriodSchema, reportMode: z.enum(["fixed", "living"]).optional() }).strict(),
      execute: (args, context) => guard(async () => {
        const labels = { appointment: "到診準備", school: "入學／轉校準備", outing: "外出／旅行準備", handoff: "照顧交接", family: "家庭成長報告" };
        const { sourceQuote, ...values } = args;
        const request = documentRequestSchema.parse({ ...values, title: args.kind === "growth_report" ? "家庭成長報告" : labels[args.purpose as keyof typeof labels] });
        const opId = receiptId(runId, context.callId), item = await agent.writeDocument(scope, runId, opId, sourceQuote as string, { request });
        return item ? savedView(item, { receiptId: opId, message: item.report?.phase === "building" ? "已保存報告整理工作，資料仍在分批處理；尚未完成報告。" : "已保存家庭資料整理；不是新確認事實或照護完成。" }) : { status: "rejected" };
      }) },
    { name: "change_family_document", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.change_family_document, authorize,
      parameters: z.object({ sourceQuote: z.string().min(1).max(1000).refine(value => Boolean(value.trim())), documentId: z.uuid(), change: documentChangeParameters }).strict(), execute: (args, context) => guard(async () => {
        const input = documentChangeParameters.parse(args.change);
        const change = documentChangeSchema.parse(input.action === "patch" ? { ...input, confirmShared: true } : input);
        const opId = receiptId(runId, context.callId), item = await agent.writeDocument(scope, runId, opId, args.sourceQuote as string, { id: args.documentId as string, change });
        return item ? savedView(item, { receiptId: opId }) : { status: "rejected" };
      }) },
    { name: "propose_family_document_change", description: AGENT_DOCUMENT_TOOL_DESCRIPTIONS.propose_family_document_change, authorize,
      parameters: z.object({ documentId: z.uuid(), change: patchParameters }).strict(), execute: (args, context) => guard(async () => {
        const value = agentProposalSchema.parse({ kind: "family_document_change", ...args });
        if (JSON.stringify(value).length + 1500 > Math.min(8000, run.budget.toolResponseCharacters)) return { status: "rejected", data: { code: "confirmation_too_large" } };
        const proposal = await agent.propose(scope, runId, context.callId, value);
        return proposal ? { status: "succeeded", reference: proposal.id, data: { ...proposal } } : { status: "rejected" };
      }) },
  ];
}
