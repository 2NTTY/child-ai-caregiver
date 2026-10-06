import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { launchPreviewBrowser, openPreview, assertFits } from "./preview-browser.mjs";
import { verifyProfile, verifyFamily } from "./flows/profile-family.mjs";
import { verifyShell, verifySettings, verifyDatesAndIsolation, verifyLogin, verifyAgentEntry } from "./flows/shell-settings.mjs";
import { verifyDeletion } from "./flows/deletion.mjs";
import { verifyDesign } from "./flows/design.mjs";
import { verifyChannels } from "./flows/channels.mjs";
import { verifyAgentConversation } from "./flows/agent-conversation.mjs";
import { verifyMobileDensity } from "./flows/mobile-density.mjs";
import { verifyPhotos } from "./flows/photos.mjs";
import { verifyModelSettings, verifyModelSettingsText } from "./flows/model-settings.mjs";
import { verifySources, verifySourcesText } from "./flows/shared-inputs.mjs";
import { verifyContact, verifyContactText } from "./flows/contact.mjs";
import { verifyEmergencyHelp } from "./flows/emergency-help.mjs";
import { verifyComposerSurfaces } from "./flows/composer-surfaces.mjs";
import { verifyCameraCapture } from "./flows/camera-capture.mjs";
import { verifyAppearance } from "./flows/appearance.mjs";
import { verifyToolbarSafety } from "./flows/toolbar-safety.mjs";

import { currentLayoutRoutes, resolveVerificationSelection } from "./verification-flow-policy.mjs";

// Reject obsolete/unknown selections before launching a browser or creating evidence.
const requested = resolveVerificationSelection(process.argv.slice(2));
const directory = resolve(process.env.FRONTEND_VERIFICATION_DIR ?? "verification/fe-w06");
await mkdir(directory, { recursive: true });
const browser = await launchPreviewBrowser();
const failures = [];
const passed = [];
const run = name => requested.has(name);
const routes = currentLayoutRoutes;
try {
  if (run("layout")) {
    for (const width of [1440, 1024, 390, 320]) for (const path of routes) {
      const page = await openPreview(browser, path, width, width >= 1024 ? 992 : width === 390 ? 844 : 720, failures);
      await assertFits(page, `${path} ${width}`);
      await page.screenshot({ path: resolve(directory, `${path === "/" ? "home" : path.slice(1)}-${width}.png`) });
      passed.push(`layout ${path} ${width}`); console.log(passed.at(-1)); await page.close();
    }
  }
  for (const [name, verify] of [["profile", verifyProfile], ["family", verifyFamily], ["shell", verifyShell], ["settings", verifySettings], ["shared", verifyDatesAndIsolation], ["login", verifyLogin], ["deletion", verifyDeletion], ["design", verifyDesign], ["channels", verifyChannels], ["agent", verifyAgentEntry], ["agent-flow", verifyAgentConversation], ["mobile-density", verifyMobileDensity], ["photos", verifyPhotos], ["model-settings", verifyModelSettings], ["model-settings-text", verifyModelSettingsText], ["sources", verifySources], ["sources-text", verifySourcesText], ["contact", verifyContact], ["contact-text", verifyContactText], ["emergency-help", verifyEmergencyHelp], ["composer-surfaces", verifyComposerSurfaces], ["camera", verifyCameraCapture], ["appearance", verifyAppearance], ["toolbar-safety", verifyToolbarSafety]]) {
    if (run(name)) { passed.push(await verify(browser, failures, directory)); console.log(passed.at(-1)); }
  }
  assert.deepEqual(failures, []);
  await writeFile(resolve(directory, `checks-${requested.size ? [...requested].join("-") : "all"}.json`), JSON.stringify({ scope: "Synthetic frontend only; no Server or device acceptance", previewUrl: process.env.FRONTEND_PREVIEW_URL ?? "http://localhost:8082", at: new Date().toISOString(), passed, failures }, null, 2) + "\n");
} finally { await browser.close(); }
