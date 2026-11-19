import assert from "node:assert/strict";
import test from "node:test";
import { assembleTurnBackground } from "../server/agent-context-assembly.ts";
import { discoverDailyNeeds } from "../server/daily-needs-discovery.ts";

test("missing-age clarification distinguishes elapsed time from an explicit child age", async () => {
  const background = await assembleTurnBackground({
    scope: { userId: "u", childId: "c", workspaceId: "w", authorizationVersion: "a", dataVersion: "d" },
    mode: "ephemeral",
    userText: "",
    authorize: async () => true,
  });
  const promptsForAge = (userText: string) => discoverDailyNeeds({ userText, background }).signals
    .some(signal => signal.id === "missing-age-condition");
  for (const duration of [
    "最近 2 週，BB 睡眠時間應該幾長？",
    "最近兩週BB睡眠時間點解變短咗？",
    "BB 2 個月前開始加固，宜家食幾多？",
    "BB 一歲半之前嘅睡眠時間仲適用嗎？",
    "BB 睡眠時間已經亂咗半個月，可以點調整？",
    "My baby's sleep schedule has changed over the past 2 weeks.",
    "We started solid food 2 months ago. What next?",
    "My baby is 2 weeks into weaning. What should we try next?",
  ]) assert.equal(promptsForAge(duration), true, duration);
  for (const age of [
    "BB 8 個月大，睡眠時間應該幾長？",
    "我個仔而家六個月，點開始加固？",
    "8 個月 BB 食幾多？",
    "8個月，可以加固嗎？",
    "月齡為8個月，睡眠時間應該幾長？",
    "BB 2 週大，睡眠時間應該幾長？",
    "BB 一歲半，最近 2 週睡眠時間有變。",
    "What sleep schedule suits my 8-month-old?",
    "My baby is 8 months. What sleep schedule is usual?",
    "My child is 2 years old. What sleep schedule is usual?",
  ]) assert.equal(promptsForAge(age), false, age);
});
