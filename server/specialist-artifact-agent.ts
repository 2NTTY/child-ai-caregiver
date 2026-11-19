import { z } from "zod";
import { projectDocumentExport } from "../src/shared/document-export-view.ts";
import {
  SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS,
  SPECIALIST_ARTIFACT_POLICY_VERSION,
  specialistArtifactInputSchema,
  specialistArtifactResultSchema,
  type SpecialistArtifactInput,
  type SpecialistArtifactMetadata,
  type SpecialistArtifactResult,
  type SpecialistArtifactVerificationReport,
} from "../src/shared/specialist-artifact.ts";
import { AgentStopped, agentBudgetFingerprint, type AgentBudget } from "./agent-budget.ts";
import type { AgentRunContext, AgentTool, AgentToolResult } from "./agent-runtime.ts";
import { FamilyError } from "./family-access.ts";
import type { FamilyDocumentStore } from "./family-document-store.ts";
import { FirestoreDomainError } from "./firestore-domain-data.ts";
import {
  buildFamilyArtifactHtml,
  buildFamilyArtifactPdf,
  inspectHtmlArtifactIsolated,
  inspectPdfArtifactIsolated,
  type ArtifactFaultMode,
  type BuiltArtifact,
  type VisualArtifactRendererPort,
} from "./specialist-artifact-renderer.ts";

export const SPECIALIST_ARTIFACT_TOOL_NAME = "prepare_family_artifact";

export const SPECIALIST_ARTIFACT_TOOL_DESCRIPTION =
  "僅在需要產出複雜家庭簡報／列印預覽（PDF 或隔離 HTML）並完成獨立版面與安全核對時委派此專家工具；"
  + "先建構草稿再於隔離環境檢驗溢位、重疊、缺字、空頁與不安全連結，最多自動修復兩輪；"
  + "不會自動正式保存或發布。清楚的普通文件建立、文字編修或日常問答請勿委派。";

const activeSpecialistScopes = new Set<string>();

export interface SpecialistArtifactExecutionOutcome {
  result: SpecialistArtifactResult;
  bytes: Uint8Array | null;
  blockedCode?: string;
}

export interface RunSpecialistArtifactOptions {
  documents: FamilyDocumentStore;
  run: AgentRunContext;
  trustedUserMessage: string;
  input: unknown;
  safeHttpsUrl?: string;
  visualRenderer?: VisualArtifactRendererPort;
  /** Server/test harness fault hooks; never exposed to model tool parameters. */
  initialFaultMode?: ArtifactFaultMode;
  repairFaultMode?: ArtifactFaultMode;
  maxRepairIterations?: number;
  /** Test-only delay inside the build step to verify single-flight lock contention. */
  onBeforeBuild?: (attempt: number) => Promise<void>;
}

async function consumeSpecialistToolUnit(
  budget: AgentBudget,
  attemptKey: string,
  fingerprintPayload: unknown,
): Promise<void> {
  budget.check();
  if (budget.durable) {
    await budget.admit({
      kind: "tool_batch",
      key: attemptKey,
      units: 1,
      fingerprint: agentBudgetFingerprint(fingerprintPayload),
    });
    return;
  }
  budget.take("toolCalls", 1);
}

function buildMetadata(
  input: SpecialistArtifactInput,
  title: string,
  artifactVersion: number,
  built: BuiltArtifact,
): SpecialistArtifactMetadata {
  return {
    artifactId: `${input.documentId}:v${input.expectedVersion}:a${artifactVersion}:${built.hash.slice(0, 12)}`,
    documentId: input.documentId,
    expectedVersion: input.expectedVersion,
    authorityVersion: input.authorityVersion,
    artifactVersion,
    artifactHash: built.hash,
    format: input.format,
    mimeType: input.format === "pdf" ? "application/pdf" : "text/html",
    byteLength: built.bytes.byteLength,
    pageCount: built.pageCount,
    title,
  };
}

function blockedOutcome(
  stopReason: "source_quote_mismatch" | "version_mismatch" | "document_not_ready",
  blockedCode: string,
): SpecialistArtifactExecutionOutcome {
  return {
    result: specialistArtifactResultSchema.parse({
      policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
      status: "blocked",
      repairIterations: 0,
      stopReason,
      formalSave: false,
      published: false,
      requiresFormalConfirmation: true,
      artifact: null,
      verification: null,
    }),
    bytes: null,
    blockedCode,
  };
}

function isBudgetStopReason(reason: string): reason is "tool_limit" | "model_limit" | "deadline" {
  return reason === "tool_limit" || reason === "model_limit" || reason === "deadline";
}

export async function runSpecialistArtifactLoop(
  options: RunSpecialistArtifactOptions,
): Promise<SpecialistArtifactExecutionOutcome> {
  const parsed = specialistArtifactInputSchema.parse(options.input);
  const { scope, budget } = options.run;
  const scopeKey = `${scope.workspaceId}:${scope.userId}:${scope.childId}`;
  if (activeSpecialistScopes.has(scopeKey)) {
    throw new FamilyError(409, "specialist_task_in_progress");
  }

  activeSpecialistScopes.add(scopeKey);
  try {
    budget.check();
    const trustedUserMessage = options.trustedUserMessage.trim();
    if (!trustedUserMessage || !trustedUserMessage.includes(parsed.sourceQuote)) {
      return blockedOutcome("source_quote_mismatch", "agent_source_mismatch");
    }

    const description = await options.documents.describe(scope.userId, scope.childId, parsed.documentId);
    const item = description?.item ?? null;
    const current = item?.current ?? null;
    if (!description || !item || !current) {
      return blockedOutcome("version_mismatch", "not_found");
    }
    if (item.version !== parsed.expectedVersion) {
      return blockedOutcome("version_mismatch", "version_conflict");
    }
    if (description.authorityVersion !== parsed.authorityVersion) {
      return blockedOutcome("version_mismatch", "authority_conflict");
    }
    if (item.readState !== "ready") {
      return blockedOutcome("document_not_ready", "document_not_ready");
    }

    const view = projectDocumentExport(current, {
      snapshotId: current.id,
      snapshotVersion: current.version,
      authorityVersion: description.authorityVersion,
      purpose: item.purpose === "outing" ? "handoff" : item.purpose,
      includeSources: parsed.includeSources,
      includeRevision: parsed.includeRevision,
    });

    const maxRepairs = Math.min(
      Math.max(0, Math.trunc(options.maxRepairIterations ?? SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS)),
      SPECIALIST_ARTIFACT_MAX_REPAIR_ITERATIONS,
    );
    const requiredSections = view.sections.map(section => section.title);

    let latestBytes: Uint8Array | null = null;
    let latestMetadata: SpecialistArtifactMetadata | null = null;
    let latestVerification: SpecialistArtifactVerificationReport | null = null;
    let completedRepairs = 0;

    for (let attempt = 0; attempt <= maxRepairs; attempt += 1) {
      const artifactVersion = attempt + 1;
      try {
        await consumeSpecialistToolUnit(
          budget,
          `tool:${SPECIALIST_ARTIFACT_TOOL_NAME}:${parsed.documentId}:a${artifactVersion}`,
          {
            runId: options.run.runId,
            documentId: parsed.documentId,
            expectedVersion: parsed.expectedVersion,
            authorityVersion: parsed.authorityVersion,
            format: parsed.format,
            artifactVersion,
          },
        );
      } catch (error) {
        if (error instanceof AgentStopped && isBudgetStopReason(error.reason)) {
          return {
            result: specialistArtifactResultSchema.parse({
              policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
              status: "partial",
              repairIterations: completedRepairs,
              stopReason: error.reason,
              formalSave: false,
              published: false,
              requiresFormalConfirmation: true,
              artifact: latestMetadata,
              verification: latestVerification,
            }),
            bytes: latestBytes,
          };
        }
        throw error;
      }

      if (options.onBeforeBuild) {
        await options.onBeforeBuild(attempt);
      }

      const faultMode: ArtifactFaultMode = attempt === 0
        ? (options.initialFaultMode ?? "none")
        : (options.repairFaultMode ?? "none");

      const built = parsed.format === "pdf"
        ? buildFamilyArtifactPdf(view, {
          repairCompact: attempt > 0,
          faultMode,
          safeHttpsUrl: options.safeHttpsUrl,
        })
        : buildFamilyArtifactHtml(view, {
          repairCompact: attempt > 0,
          faultMode,
          safeHttpsUrl: options.safeHttpsUrl,
        });

      const inspectOptions = {
        artifactVersion,
        expectedHash: built.hash,
        expectedTitle: view.title,
        requiredSections,
        signal: budget.signal,
        visualRenderer: options.visualRenderer,
      };

      const verification = parsed.format === "pdf"
        ? await inspectPdfArtifactIsolated(built.bytes, inspectOptions)
        : await inspectHtmlArtifactIsolated(built.bytes, inspectOptions);

      latestBytes = built.bytes;
      latestMetadata = buildMetadata(parsed, view.title, artifactVersion, built);
      latestVerification = verification;
      completedRepairs = attempt;

      if (verification.passed) {
        return {
          result: specialistArtifactResultSchema.parse({
            policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
            status: "verified",
            repairIterations: completedRepairs,
            stopReason: "verified",
            formalSave: false,
            published: false,
            requiresFormalConfirmation: true,
            artifact: latestMetadata,
            verification: latestVerification,
          }),
          bytes: latestBytes,
        };
      }
    }

    return {
      result: specialistArtifactResultSchema.parse({
        policyVersion: SPECIALIST_ARTIFACT_POLICY_VERSION,
        status: "partial",
        repairIterations: completedRepairs,
        stopReason: "repair_limit_reached",
        formalSave: false,
        published: false,
        requiresFormalConfirmation: true,
        artifact: latestMetadata,
        verification: latestVerification,
      }),
      bytes: latestBytes,
    };
  } finally {
    activeSpecialistScopes.delete(scopeKey);
  }
}

export function createSpecialistArtifactTools(options: {
  documents: FamilyDocumentStore;
  run: AgentRunContext;
  authorize: () => Promise<boolean>;
  trustedUserMessage: string;
  visualRenderer?: VisualArtifactRendererPort;
  initialFaultMode?: ArtifactFaultMode;
  repairFaultMode?: ArtifactFaultMode;
}): AgentTool[] {
  const authorize = options.run.authorize ?? options.authorize;
  const guard = async (action: () => Promise<AgentToolResult>): Promise<AgentToolResult> => {
    if (!await authorize()) return { status: "rejected", data: { formalSave: false } };
    try {
      return await action();
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { status: "rejected", data: { code: "invalid_input", formalSave: false } };
      }
      if (error instanceof AgentStopped) {
        if (["cancelled", "deadline", "unauthorized", "quota_exceeded"].includes(error.reason)) throw error;
        return { status: "rejected", data: { code: error.reason, formalSave: false } };
      }
      if (error instanceof FamilyError || error instanceof FirestoreDomainError) {
        return {
          status: error.status === 409 ? "conflict" : error.status >= 500 ? "failed" : "rejected",
          data: { code: error.code, formalSave: false },
        };
      }
      throw error;
    }
  };

  return [{
    name: SPECIALIST_ARTIFACT_TOOL_NAME,
    description: SPECIALIST_ARTIFACT_TOOL_DESCRIPTION,
    authorize,
    parameters: specialistArtifactInputSchema,
    execute: args => guard(async () => {
      const outcome = await runSpecialistArtifactLoop({
        documents: options.documents,
        run: options.run,
        trustedUserMessage: options.trustedUserMessage,
        input: args,
        visualRenderer: options.visualRenderer,
        initialFaultMode: options.initialFaultMode,
        repairFaultMode: options.repairFaultMode,
      });

      if (outcome.result.status === "blocked") {
        return {
          status: "rejected",
          data: {
            code: outcome.blockedCode ?? outcome.result.stopReason,
            formalSave: false,
            published: false,
            requiresFormalConfirmation: true,
          },
        };
      }

      return {
        status: "succeeded",
        reference: outcome.result.artifact?.artifactId ?? outcome.result.policyVersion,
        data: outcome.result,
      };
    }),
  }];
}
