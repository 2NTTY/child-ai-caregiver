import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";

const listOnly=process.argv.includes("--list");
const api="http://localhost:3101",web="http://localhost:8181";
if(!listOnly){
  if(Number(process.versions.node.split(".")[0])!==24)throw new Error("Node 24 required");
  if(process.env.P2_BROWSER_APPROVED!=="true")throw new Error("Consolidated browser acceptance approval required");
  let database;try{database=new URL(process.env.TEST_DATABASE_URL??"");}catch{throw new Error("Local synthetic database required");}
  if(!["postgres:","postgresql:"].includes(database.protocol)||!["localhost","127.0.0.1"].includes(database.hostname)
    ||database.port!=="5434"||database.pathname!=="/yuban_s06_test"||database.search||database.hash)throw new Error("Local synthetic database required");
  if(!process.env.STORAGE_KEY_FILE||!isAbsolute(process.env.STORAGE_KEY_FILE))throw new Error("Existing storage key path required");
  if(!process.env.TEST_ATTACHMENTS_DIR||!isAbsolute(process.env.TEST_ATTACHMENTS_DIR))throw new Error("Synthetic attachment directory required");
}
const quote=value=>'"'+value.replaceAll('"','\\"')+'"';
const env={DATABASE_URL:process.env.TEST_DATABASE_URL??"",STORAGE_KEY_FILE:process.env.STORAGE_KEY_FILE??"",
  BETTER_AUTH_SECRET:randomBytes(32).toString("hex"),SERVER_ORIGIN:api,WEB_ORIGIN:web,HOST:"127.0.0.1",PORT:"3101",
  NODE_ENV:"test",AI_ENABLED:"false",P2_AGENT_ENABLED:"true",ATTACHMENTS_DIR:process.env.TEST_ATTACHMENTS_DIR??"",WEB_PUSH_ENABLED:"false",TELEGRAM_ENABLED:"false",
  ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS:"false",DEBUG:"",PWDEBUG:"",EXPO_NO_DOTENV:"1"};
export default defineConfig({
  testDir:"./tests/browser",testMatch:"*.spec.mjs",fullyParallel:false,workers:1,retries:0,maxFailures:1,
  timeout:150000,globalTimeout:420000,expect:{timeout:8000},forbidOnly:true,
  reporter:[["line"]],outputDir:".cache/browser-results",
  use:{baseURL:web,trace:"off",screenshot:"off",video:"off",serviceWorkers:"block",actionTimeout:10000,navigationTimeout:20000},
  projects:[{name:"chromium",use:{browserName:"chromium"}},{name:"firefox",use:{browserName:"firefox"}}],
  webServer:listOnly?undefined:[
    {command:quote(process.execPath)+" server/index.ts",url:api+"/api/health",env,timeout:30000,reuseExistingServer:false,stdout:"ignore",stderr:"pipe"},
    {command:quote(process.execPath)+" node_modules/expo/bin/cli start --web --localhost --port 8181",
      url:web,env:{...env,NODE_ENV:"development",CI:"1",BROWSER:"none",EXPO_PUBLIC_API_BASE_URL:api+"/api",
        EXPO_OFFLINE:"1",EXPO_NO_TELEMETRY:"1",EXPO_NO_TELEMETRY_DETACH:"1"},
      timeout:90000,reuseExistingServer:false,stdout:"ignore",stderr:"pipe"},
  ],
});
