// Frontend-only conversational intake. None of these fields belong to SharedInputCreate.
export type SourceIntakeStage = "awaiting_read" | "reading" | "read_unknown" | "unavailable" | "clarifying" | "review" | "confirmed_pending_connection" | "connection_unknown" | "saved";
export type SourceIntakeReadOutcome = "ready" | "unavailable" | "unknown";
export type SourceIntakeConnectionOutcome = "not_connected" | "unknown";
export type SourceIntakeProposal = {
  purpose: "answer_reference" | "record_candidate" | "track_topic";
  nature: "unspecified" | "external_material" | "claimed_official" | "personal_observation";
  timeScope: "unspecified" | "long_reference" | "recent" | "specific_period";
  validityText: string;
};
export type SourceIntake = {
  intention: string; clarification: string; stage: SourceIntakeStage;
  proposal: SourceIntakeProposal | null; proposalOrigin: "manual" | "assisted";
};
export type SourceIntakeView = {
  mode: "synthetic" | "production";
  intention: string;
  selected: SourceIntake | null;
};
export type SourceIntakeActions = {
  setIntention(value: string): void;
  read(): void;
  checkRead(): void;
  setClarification(value: string): void;
  propose(): void;
  editManually(): void;
  editProposal(value: SourceIntakeProposal): void;
  confirmProposal(): void;
  checkConnection(): void;
  discuss?(): void;
};
export const sourcePurposeOptions: { value: SourceIntakeProposal["purpose"]; label: string }[] = [
  { value: "answer_reference", label: "回答時參考" },
  { value: "record_candidate", label: "整理成待核對孩子記錄" },
  { value: "track_topic", label: "作為持續關注的話題" },
];
export const sourceNatureOptions: { value: SourceIntakeProposal["nature"]; label: string }[] = [
  { value: "unspecified", label: "尚未確定" },
  { value: "external_material", label: "外部參考材料" },
  { value: "claimed_official", label: "使用者稱為官方來源，尚未核實" },
  { value: "personal_observation", label: "本人提供的觀察" },
];
export const sourceTimeOptions: { value: SourceIntakeProposal["timeScope"]; label: string }[] = [
  { value: "unspecified", label: "時效尚未確定" },
  { value: "long_reference", label: "較長期參考，使用前仍須核對" },
  { value: "recent", label: "近期資訊，使用前須重新核對" },
  { value: "specific_period", label: "只適用指定期間或條件" },
];
export function createSourceIntake(intention: string): SourceIntake {
  return { intention, clarification: "", stage: "awaiting_read", proposal: null, proposalOrigin: "assisted" };
}
export function sourceIntakeReadResult(value: SourceIntake, outcome: SourceIntakeReadOutcome): SourceIntake {
  if (value.stage !== "reading" && value.stage !== "read_unknown") return value;
  return { ...value, stage: outcome === "ready" ? "clarifying" : outcome === "unavailable" ? "unavailable" : "read_unknown", proposal: null };
}
export function proposeSourceIntake(value: SourceIntake): SourceIntake {
  if (value.stage !== "clarifying" || !validSourceIntakeText(value.clarification)) return value;
  // A controlled presentation sample, never an inference about supplied content.
  return { ...value, stage: "review", proposal: { purpose: "answer_reference", nature: "unspecified", timeScope: "unspecified", validityText: "" } };
}
export function validSourceIntakeText(value: string) {
  return value.length <= 1000 && !/[\u0000\uD800-\uDFFF]/u.test(value);
}
export function validSourceIntakeProposal(value: SourceIntakeProposal | null) {
  return !!value && sourcePurposeOptions.some(option => option.value === value.purpose)
    && sourceNatureOptions.some(option => option.value === value.nature)
    && sourceTimeOptions.some(option => option.value === value.timeScope)
    && value.validityText.length <= 300 && !/[\u0000\uD800-\uDFFF]/u.test(value.validityText)
    && (value.timeScope !== "specific_period" || !!value.validityText.trim());
}
export function confirmSourceIntake(value: SourceIntake, outcome: SourceIntakeConnectionOutcome): SourceIntake {
  if (value.stage !== "review" || !validSourceIntakeProposal(value.proposal)) return value;
  return { ...value, stage: outcome === "unknown" ? "connection_unknown" : "confirmed_pending_connection" };
}
export function sourceIntakeIsUnresolved(value: SourceIntake | null | undefined) {
  return !!value && ["reading", "read_unknown", "connection_unknown"].includes(value.stage);
}
export function sourceIntakePurposeLabel(value: SourceIntake | undefined) {
  if (!value?.proposal) return "用途待討論";
  const purpose = sourcePurposeOptions.find(option => option.value === value.proposal?.purpose)?.label ?? "用途待討論";
  return value.stage === "review" ? `建議：${purpose} · 待確認` : value.stage === "connection_unknown" ? "接入結果未知，須查核" : `${purpose} · 正式接入未連線`;
}
