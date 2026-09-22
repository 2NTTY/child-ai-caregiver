import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

const secret = () => randomBytes(32).toString("hex");
const dbPassword = secret();
const testDbPassword = secret();
const contents = [
  "# Local synthetic development configuration. Never commit or share this file.",
  "EXPO_PUBLIC_API_BASE_URL=http://localhost:3001/api",
  `DB_PASSWORD=${dbPassword}`,
  `TEST_DB_PASSWORD=${testDbPassword}`,
  `DATABASE_URL=postgresql://yuban:${dbPassword}@127.0.0.1:5433/yuban`,
  `TEST_DATABASE_URL=postgresql://yuban:${testDbPassword}@127.0.0.1:5434/yuban_s06_test`,
  `BETTER_AUTH_SECRET=${secret()}`,
  "SERVER_ORIGIN=http://localhost:3001",
  "WEB_ORIGIN=http://localhost:8081",
  "HOST=127.0.0.1",
  "PORT=3001",
  "NODE_ENV=development",
  "",
].join("\n");

try {
  await writeFile(new URL("../.env", import.meta.url), contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.info("local_configuration_created");
} catch (error) {
  if (error?.code === "EEXIST") console.info("local_configuration_already_exists");
  else { console.error("local_configuration_failed"); process.exitCode = 1; }
}
