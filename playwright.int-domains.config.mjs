import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const api = "http://localhost:3101", web = "http://localhost:8181";
if (Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Node 24 required");
if (process.env.INT_DOMAIN_BROWSER_APPROVED !== "true") throw new Error("INT-W03 bounded browser approval required");
let database;
try { database = new URL(process.env.TEST_DATABASE_URL ?? ""); } catch { throw new Error("Local synthetic database required"); }
if (!["postgres:", "postgresql:"].includes(database.protocol) || !["localhost", "127.0.0.1"].includes(database.hostname)
  || database.port !== "5434" || database.pathname !== "/yuban_s06_test" || database.search || database.hash) throw new Error("Local synthetic database required");
if (!process.env.STORAGE_KEY_FILE || !isAbsolute(process.env.STORAGE_KEY_FILE)) throw new Error("Existing storage key path required");
if (!process.env.TEST_ATTACHMENTS_DIR || !isAbsolute(process.env.TEST_ATTACHMENTS_DIR)) throw new Error("Synthetic attachment directory required");
const executablePath = join(process.env.LOCALAPPDATA ?? "", "ms-playwright", "chromium_headless_shell-1243", "chrome-headless-shell-win64", "chrome-headless-shell.exe");
if (!existsSync(executablePath)) throw new Error("Approved Chromium headless shell unavailable; no download allowed");
const quote = value => '"' + value.replaceAll('"', '\\"') + '"';
const env = {
  DATABASE_URL: process.env.TEST_DATABASE_URL, STORAGE_KEY_FILE: process.env.STORAGE_KEY_FILE,
  BETTER_AUTH_SECRET: randomBytes(32).toString("hex"), SERVER_ORIGIN: api, WEB_ORIGIN: web, HOST: "127.0.0.1", PORT: "3101", NODE_ENV: "test",
  AI_ENABLED: "false", P2_AGENT_ENABLED: "true", GEMINI_MODEL: "gemini-3.1-flash-lite", VERTEX_LOCATION: "global",
  GCP_PROJECT_ID: "", ATTACHMENTS_DIR: process.env.TEST_ATTACHMENTS_DIR,
  WEB_PUSH_ENABLED: "false", TELEGRAM_ENABLED: "false", AGENT_DIAGNOSTICS: "false",
  ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS: "false", DEBUG: "", PWDEBUG: "", EXPO_NO_DOTENV: "1",
};
export default defineConfig({
  testDir: "./tests/browser", testMatch: "int-domains.spec.mjs", fullyParallel: false, workers: 1, retries: 0, maxFailures: 1,
  timeout: 180000, globalTimeout: 300000, expect: { timeout: 10000 }, forbidOnly: true,
  reporter: [["line"], ["json", { outputFile: ".cache/int-domains-browser-report.json" }]], outputDir: ".cache/int-domains-browser-results",
  use: { baseURL: web, trace: "off", screenshot: "off", video: "off", serviceWorkers: "block", actionTimeout: 10000,
    navigationTimeout: 20000, viewport: { width: 1440, height: 1000 }, launchOptions: { executablePath } },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    { command: quote(process.execPath) + " server/index.ts", url: api + "/api/health", env, timeout: 30000, reuseExistingServer: false, stdout: "ignore", stderr: "pipe" },
    { command: quote(process.execPath) + " ../node_modules/expo/bin/cli start --web --localhost --port 8181", cwd: "frontend", url: web,
      env: { ...env, NODE_ENV: "development", CI: "1", BROWSER: "none", EXPO_PUBLIC_API_BASE_URL: api + "/api", EXPO_OFFLINE: "1",
        EXPO_NO_TELEMETRY: "1", EXPO_NO_TELEMETRY_DETACH: "1" }, timeout: 90000, reuseExistingServer: false, stdout: "ignore", stderr: "pipe" },
  ],
});
