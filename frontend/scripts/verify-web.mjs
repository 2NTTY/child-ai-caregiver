import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const baseURL = process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8081";
const screenshotDir = resolve("verification/screenshots");
await mkdir(screenshotDir, { recursive: true });

const browser = await chromium.launch({
  ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: "msedge" }),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-gpu-sandbox", "--disable-features=UseDawn,SkiaGraphite,Vulkan", "--use-gl=swiftshader"],
});

const pageErrors = [];
const widths = process.env.FRONTEND_VERIFY_WIDTHS?.split(",").map(Number) ?? [1586, 1440, 1024, 390, 320];
const routes = [
  { path: "/", name: "home", text: "把每天的細節，慢慢整理清楚。" },
  { path: "/chat", name: "chat", text: "育伴港 Agent 對話" },
  { path: "/care", name: "care", text: "照顧記錄" },
  { path: "/profile", name: "profile", text: "子女檔案" },
  { path: "/family", name: "family", text: "家庭協調" },
  { path: "/memory", name: "memory", text: "記憶與話題" },
  { path: "/settings", name: "settings", text: "設定" },
  { path: "/guide", name: "guide", text: "使用引導" },
  { path: "/login", name: "login", text: "歡迎回來" },
];

async function openPage(path, width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on("pageerror", error => pageErrors.push(path + " " + width + ": " + error.message));
  await page.goto(new URL(path, baseURL).toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForFunction(() => document.readyState === "complete", undefined, { timeout: 60_000 });
  await page.waitForFunction(() => {
    const logo = document.querySelector("[aria-label='育伴港'] img");
    const art = document.querySelector("[aria-label='照顧者與孩子在香港海旁同行'] img");
    return logo && logo.complete && logo.naturalWidth > 0
      && (!document.querySelector("[aria-label='照顧者與孩子在香港海旁同行']") || (art && art.complete && art.naturalWidth > 0));
  }, undefined, { timeout: 60_000 });
  await page.waitForTimeout(150);
  return page;
}

async function assertFits(page, width, label) {
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.equal(geometry.viewport, width, label + ": wrong viewport");
  assert.ok(geometry.page <= width + 1, label + ": document overflows: " + JSON.stringify(geometry));
  assert.ok(geometry.body <= width + 1, label + ": body overflows: " + JSON.stringify(geometry));
}

try {
  for (const width of process.env.FRONTEND_VERIFY_INTERACTIONS_ONLY ? [] : widths) {
    const height = width >= 1024 ? 992 : width === 390 ? 844 : 720;
    for (const route of routes) {
      if (width === 1586 && route.name !== "home") continue;
      if (width === 1024 && !["home", "chat", "settings", "guide", "login"].includes(route.name)) continue;
      if (width === 390 && !["home", "chat", "settings", "guide", "login"].includes(route.name)) continue;
      const page = await openPage(route.path, width, height);
      await page.getByText(route.text, { exact: true }).first().waitFor({ timeout: 60_000 });
      await assertFits(page, width, route.name + " " + width);
      if (width === 1586 || width === 1440 || width === 390 || (width === 320 && route.name === "home")) {
        await page.screenshot({ path: resolve(screenshotDir, route.name + "-" + width + ".png") });
      }
      console.log(route.name + " " + width + "px: rendered without horizontal page overflow");
      await page.close();
    }
  }

  const desktop = await openPage("/", 1440, 900);
  await desktop.getByText("已連接", { exact: true }).waitFor();
  await desktop.getByRole("button", { name: "進行對話" }).waitFor();
  const previewTodo = desktop.getByRole("checkbox", { name: "在預覽中標記核對本週睡眠觀察" });
  await previewTodo.waitFor();
  assert.equal(await previewTodo.isChecked(), false);
  await previewTodo.focus();
  await desktop.keyboard.press("Space");
  assert.equal(await previewTodo.isChecked(), true);
  await desktop.getByText("只在這個合成預覽標記；沒有保存正式任務", { exact: false }).waitFor();
  await desktop.getByRole("button", { name: "關閉預覽提示" }).click();
  await desktop.getByRole("button", { name: /開啟訊息提示/ }).click();
  await desktop.getByText("目前沒有需要處理的操作提示。").waitFor();
  await desktop.getByRole("button", { name: "關閉", exact: true }).last().click();
  assert.equal(await desktop.getByRole("button", { name: "關閉資訊側欄" }).count(), 0);
  await desktop.getByRole("button", { name: "收起資訊側欄" }).focus();
  await desktop.keyboard.press("Enter");
  await desktop.getByRole("button", { name: "開啟資訊側欄" }).focus();
  await desktop.keyboard.press("Enter");
  await desktop.getByText("資訊與提醒", { exact: true }).waitFor();
  assert.equal(await desktop.getByRole("checkbox", { name: "在預覽中標記核對本週睡眠觀察" }).isChecked(), true);
  await desktop.getByRole("button", { name: "切換合成預覽情境" }).focus();
  await desktop.keyboard.press("Enter");
  await desktop.getByRole("button", { name: "結果未知", exact: true }).click();
  await desktop.getByText("提交結果尚未確認", { exact: true }).first().waitFor();
  await desktop.getByRole("button", { name: "開啟訊息提示：1 項合成狀態需留意" }).click();
  await desktop.getByText("角標只表示此預覽有需留意的狀態", { exact: false }).waitFor();
  await desktop.waitForTimeout(450);
  await desktop.screenshot({ path: resolve(screenshotDir, "home-1440-bell-unknown.png") });
  await desktop.getByRole("button", { name: "查核原操作", exact: true }).last().click();
  await desktop.getByRole("button", { name: "查核原操作", exact: true }).first().click();
  await desktop.getByText("結果未知：正式操作須以原 opId 查核", { exact: false }).waitFor();
  await desktop.screenshot({ path: resolve(screenshotDir, "home-1440-unknown.png") });
  for (const [scenario, copy] of [
    ["待確認", "有一項內容等你確認"],
    ["處理中", "正在提交原操作"],
    ["已保存", "原操作已確認保存"],
    ["失敗", "原操作確定未成功"],
    ["離線", "目前離線；以下可能是較早讀取的資料"],
    ["讀取中", "正在讀取已確認記錄"],
    ["尚無孩子", "先建立第一位孩子的檔案"],
  ]) {
    await desktop.getByRole("button", { name: scenario, exact: true }).click();
    await desktop.getByText(copy, { exact: false }).first().waitFor();
    const expectedAttention = scenario === "待確認" || scenario === "失敗";
    assert.equal(await desktop.getByRole("button", { name: "開啟訊息提示：1 項合成狀態需留意" }).count(), expectedAttention ? 1 : 0);
  }
  await desktop.close();

  const guide = await openPage("/", 1440, 900);
  await guide.getByRole("button", { name: "切換合成預覽情境" }).click();
  await guide.getByRole("button", { name: "首次登入" }).click();
  await guide.getByRole("link", { name: "使用引導" }).waitFor();
  await guide.screenshot({ path: resolve(screenshotDir, "home-1440-first-login.png") });
  await guide.getByRole("button", { name: "前往使用引導" }).click();
  await guide.getByText("先把基本資料整理好", { exact: true }).waitFor();
  await guide.screenshot({ path: resolve(screenshotDir, "guide-1440-first-login.png") });
  await guide.getByRole("button", { name: "模擬設定已完成" }).click();
  await guide.getByRole("link", { name: "使用引導" }).waitFor({ state: "hidden" });
  await guide.getByRole("button", { name: "設定未完成" }).click();
  await guide.getByRole("link", { name: "使用引導" }).waitFor();
  await guide.getByRole("button", { name: "一般" }).click();
  await guide.getByRole("link", { name: "使用引導" }).waitFor({ state: "hidden" });
  await guide.getByRole("link", { name: "育伴港，返回主頁" }).click();
  await guide.getByRole("button", { name: "進行對話" }).waitFor();
  await guide.getByRole("link", { name: "設定" }).click();
  await guide.getByRole("button", { name: "開啟使用引導" }).waitFor();
  await guide.close();

  const child = await openPage("/", 390, 844);
  await child.getByRole("button", { name: "開啟資訊側欄" }).click();
  await child.getByText("待辦事項", { exact: true }).waitFor();
  await child.waitForTimeout(450);
  await child.screenshot({ path: resolve(screenshotDir, "home-390-rail.png") });
  await child.getByRole("button", { name: "收起資訊側欄" }).click();
  await child.getByRole("button", { name: /選擇孩子/ }).click();
  await child.getByRole("radio", { name: "阿樂 · 約 8 歲 · 截至 2026 年 9 月" }).click();
  await child.locator('[aria-label="阿樂的關鍵資料"]').waitFor();
  await child.getByRole("button", { name: "開啟資訊側欄" }).click();
  await child.getByText("整理課後觀察", { exact: true }).waitFor();
  assert.equal(await child.getByText("核對本週睡眠觀察", { exact: true }).count(), 0);
  await child.getByRole("button", { name: "收起資訊側欄" }).click();
  await child.getByText("課後記錄", { exact: true }).first().waitFor();
  await child.getByRole("textbox", { name: "篩選下方已載入的記錄" }).fill("不存在的資料");
  await child.getByText("這幾項已載入記錄中沒有符合的內容。", { exact: true }).waitFor();
  await child.close();

  const chat = await openPage("/chat", 390, 844);
  await chat.getByRole("textbox", { name: "撰寫對話問題" }).fill("想整理睡前流程");
  await chat.getByRole("button", { name: "預覽輸入" }).click();
  await chat.getByText("本地預覽 · 未送出", { exact: true }).waitFor();
  await chat.close();

  const mobileMore = await openPage("/", 390, 844);
  await mobileMore.getByRole("button", { name: "更多頁面" }).click();
  await mobileMore.getByRole("button", { name: "記憶與話題" }).click();
  await mobileMore.getByText("記憶與話題", { exact: true }).first().waitFor();
  await mobileMore.close();

  const tinyBell = await openPage("/", 320, 720);
  await tinyBell.getByRole("button", { name: /開啟訊息提示/ }).click();
  await tinyBell.getByText("訊息提示", { exact: true }).waitFor();
  await tinyBell.waitForTimeout(450);
  await assertFits(tinyBell, 320, "bell 320");
  await tinyBell.screenshot({ path: resolve(screenshotDir, "home-320-bell.png") });
  await tinyBell.close();

  const settings = await openPage("/settings", 1440, 900);
  await settings.getByRole("tab", { name: "應用偏好" }).click();
  await settings.getByRole("textbox", { name: "安靜時段開始預覽" }).fill("21:30");
  await settings.getByText("預覽設定：21:30–08:00", { exact: false }).waitFor();
  await settings.close();

  const login = await openPage("/login", 1440, 900);
  await login.getByRole("button", { name: "登入（預覽）" }).click();
  await login.getByText("請輸入有效電郵地址。這是本地表單檢查。", { exact: true }).waitFor();
  await login.getByRole("tab", { name: "註冊帳戶" }).click();
  await login.getByRole("textbox", { name: "稱呼" }).fill("媽媽");
  await login.getByRole("textbox", { name: "電郵地址" }).fill("parent@example.com");
  await login.getByRole("textbox", { name: "密碼" }).fill("short");
  await login.getByRole("button", { name: "建立帳戶（預覽）" }).click();
  await login.getByText("建立帳戶需要至少 12 個字元的密碼", { exact: false }).waitFor();
  await login.close();

  assert.deepEqual(pageErrors, [], "browser exceptions: " + pageErrors.join("; "));
  console.log("Interaction states and all sampled page widths passed");
} finally {
  await browser.close();
}
