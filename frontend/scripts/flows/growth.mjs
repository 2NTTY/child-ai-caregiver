import { rejectLegacyFlow } from "../verification-flow-policy.mjs";

export async function verifyGrowth() { rejectLegacyFlow("growth"); }
export async function verifyGrowthText() { rejectLegacyFlow("growth-text"); }
