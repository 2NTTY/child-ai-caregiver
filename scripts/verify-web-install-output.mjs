import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Validate the final deployable directory, after the root public overlay.
export async function verifyWebInstallOutput(output) {
  const manifest = JSON.parse(await readFile(new URL("manifest.webmanifest", output), "utf8"));
  assert.equal(manifest.display, "standalone", "Home Screen display mode missing");
  assert.equal(manifest.start_url, "/", "Home Screen must start in the existing app");
  assert.equal(manifest.scope, "/", "Home Screen must cover the existing routes");
  const pngSize = async (path, size) => {
    const bytes = await readFile(new URL(path, output));
    assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `Invalid PNG: ${path}`);
    assert.equal(bytes.readUInt32BE(16), size, `Wrong icon width: ${path}`);
    assert.equal(bytes.readUInt32BE(20), size, `Wrong icon height: ${path}`);
  };
  for (const size of [192, 512]) {
    const icon = manifest.icons.find(icon => icon.sizes === `${size}x${size}` && icon.type === "image/png");
    assert.ok(icon && /^\/icons\/[\w-]+\.png$/u.test(icon.src), `Missing ${size}px manifest icon`);
    await pngSize(icon.src.slice(1), size);
  }
  await pngSize("icons/apple-touch-icon.png", 180);
  for (const path of ["index.html", "login.html", "guide.html"]) {
    const html = await readFile(new URL(path, output), "utf8");
    assert.match(html, /<html[^>]*lang="zh-HK"/u, `Missing app language: ${path}`);
    assert.match(html, /rel="manifest"[^>]*href="\/manifest\.webmanifest"/u, `Missing manifest link: ${path}`);
    assert.match(html, /rel="apple-touch-icon"[^>]*href="\/icons\/apple-touch-icon\.png"/u, `Missing Apple icon: ${path}`);
    assert.match(html, /name="apple-mobile-web-app-capable"[^>]*content="yes"/u, `Missing standalone metadata: ${path}`);
  }
}
