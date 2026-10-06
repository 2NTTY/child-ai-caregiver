import { rejectLegacyFlow } from "../verification-flow-policy.mjs";

export async function verifySummary() { rejectLegacyFlow("summary"); }
export async function verifySummaryText() { rejectLegacyFlow("summary-text"); }
