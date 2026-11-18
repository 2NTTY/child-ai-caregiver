import { randomUUID } from "node:crypto";
import type { GrowthAttention } from "../../src/shared/growth.ts";

export function makeGrowthItem(options: {
  id?: string;
  childId: string;
  state: GrowthAttention["state"];
  createdAt?: string;
  updatedAt: string;
  title?: string;
}): GrowthAttention {
  const createdAt = options.createdAt ?? options.updatedAt;
  return {
    id: options.id ?? randomUUID(),
    childId: options.childId,
    topicId: "solid_food",
    version: 1,
    state: options.state,
    title: options.title ?? `Growth ${options.state}`,
    kind: "arrange",
    whyNow: "Synthetic whyNow",
    advice: "Synthetic advice",
    limits: "Synthetic limits",
    basis: { stage: "6-12", ruleRevision: "rev-1", sourceHash: "a".repeat(64), values: {} },
    evidence: { profileVersion: 1, facts: [] },
    source: {
      sourceId: "source-1",
      versionId: randomUUID(),
      chunkId: randomUUID(),
      contentHash: "b".repeat(64),
      url: "https://www.fhs.gov.hk/synthetic",
      title: "Synthetic source",
      section: "section-1",
      checkedAt: "2026-10-01T00:00:00.000Z",
      excerpt: "Synthetic excerpt",
    },
    sourceAvailable: true,
    createdAt,
    updatedAt: options.updatedAt,
    snoozeUntil: options.state === "snoozed" ? "2027-01-01T00:00:00.000Z" : null,
    previousId: null,
    newReason: "Synthetic reason",
    taskId: null,
    taskState: null,
    lastAction: options.state === "dismissed"
      ? "dismiss"
      : options.state === "accepted"
        ? "accept"
        : options.state === "snoozed"
          ? "snooze"
          : "",
    actorUserId: options.state === "proposed" ? null : "synthetic-user",
    note: "",
  };
}
