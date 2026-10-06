import { cp, stat } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("frontend/dist/", root);

await stat(output);
await cp(new URL("public/", root), output, { recursive: true });
await cp(new URL("licenses/", root), new URL("licenses/", output), { recursive: true });
await cp(new URL("THIRD_PARTY_NOTICES.md", root), new URL("THIRD_PARTY_NOTICES.md", output));
