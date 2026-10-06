import { rejectLegacyFlow } from "../verification-flow-policy.mjs";

export async function setDateTime(page, label, date, time) {
  await page.getByRole("button", { name: `選擇${label}`, exact: true }).click();
  await page.getByRole("textbox", { name: `${label}日期`, exact: true }).fill(date);
  await page.getByRole("textbox", { name: `${label}時間`, exact: true }).fill(time);
  await page.getByRole("button", { name: `選用${label}`, exact: true }).click();
}

export async function verifyTasks() { rejectLegacyFlow("tasks"); }
export async function verifyMemory() { rejectLegacyFlow("memory"); }
