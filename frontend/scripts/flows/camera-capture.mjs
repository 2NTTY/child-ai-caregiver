import assert from "node:assert/strict";
import { resolve } from "node:path";
import { openPreview, assertFits } from "../preview-browser.mjs";

async function installSyntheticCamera(page) {
  await page.evaluate(() => {
    globalThis.fakeCameraMode = "live";
    globalThis.fakeCameraCalls = [];
    globalThis.fakeCameraStreams = [];
    const createStream = () => {
      const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d"); context.fillStyle = "#F6F4EC"; context.fillRect(0, 0, 640, 480);
      context.fillStyle = "#005E53"; context.font = "28px sans-serif"; context.fillText("Synthetic camera preview", 100, 245);
      const stream = canvas.captureStream(10); globalThis.fakeCameraStreams.push(stream);
      stream.getVideoTracks()[0].requestFrame(); return stream;
    };
    navigator.mediaDevices.getUserMedia = async constraints => {
      globalThis.fakeCameraCalls.push(constraints);
      if (globalThis.fakeCameraMode === "denied") throw new DOMException("Synthetic denial", "NotAllowedError");
      if (globalThis.fakeCameraMode === "pending") {
        globalThis.fakeCameraPending = new Promise(resolve => { globalThis.releaseFakeCamera = () => resolve(createStream()); });
        return globalThis.fakeCameraPending;
      }
      return createStream();
    };
  });
}
async function cameraReady(page) {
  await page.waitForFunction(() => {
    const video = document.querySelector('video[aria-label="相機即時預覽"]');
    return video?.videoWidth > 0 && video.readyState >= 2;
  });
  assert.equal(await page.getByRole("button", { name: "拍下照片", exact: true }).isDisabled(), false);
}
async function streamsStopped(page) {
  await page.waitForFunction(() => globalThis.fakeCameraStreams.every(stream => stream.getTracks().every(track => track.readyState === "ended")));
}

export async function verifyCameraCapture(browser, failures, directory) {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await openPreview(browser, "/chat", width, width < 400 ? 844 : 992, failures);
    await installSyntheticCamera(page);
    const input = page.getByRole("textbox", { name: "撰寫對話問題", exact: true });
    const draft = "拍照後先核對，保留原有問題。";
    await input.fill(draft);
    assert.equal(await page.evaluate(() => globalThis.fakeCameraCalls.length), 0, "No camera access before a press");
    const captureButton = page.getByTestId("agent-input-toolbar").getByRole("button", { name: "拍照", exact: true });
    await captureButton.focus(); await page.keyboard.press("Enter");
    const camera = page.getByTestId("web-camera-dialog");
    await camera.waitFor(); await cameraReady(page);
    assert.equal(new URL(page.url()).pathname, "/chat");
    const constraints = await page.evaluate(() => globalThis.fakeCameraCalls[0]);
    assert.equal(constraints.audio, false, "The camera never requests microphone access");
    assert.equal(constraints.video.facingMode.ideal, "environment");
    await assertFits(page, `camera dialog ${width}`);
    await page.screenshot({ path: resolve(directory, `camera-open-${width}.png`) });
    await camera.getByRole("button", { name: "拍下照片", exact: true }).click();
    await camera.waitFor({ state: "hidden" });
    const photo = page.getByTestId("composer-photo-preview");
    await photo.getByText(/^拍照-.*\.(jpg|png)$/).waitFor();
    const image = photo.locator("img"); await image.evaluate(element => element.decode());
    assert.deepEqual(await image.evaluate(element => [element.naturalWidth, element.naturalHeight]), [640, 480], "Capture preserves the full source frame");
    await streamsStopped(page);
    assert.equal(await input.inputValue(), draft);
    await assertFits(page, `captured camera photo ${width}`);
    await page.screenshot({ path: resolve(directory, `captured-photo-${width}.png`) });
    if (width === 1440) {
      const retainedUri = await image.getAttribute("src");
      await page.evaluate(() => { globalThis.fakeCameraMode = "pending"; });
      await captureButton.click(); await camera.waitFor();
      await page.waitForFunction(() => !!globalThis.releaseFakeCamera);
      assert.equal(await camera.getByRole("button", { name: "拍下照片", exact: true }).isDisabled(), true);
      await camera.getByRole("button", { name: "取消拍照", exact: true }).click();
      await camera.waitFor({ state: "hidden" });
      await page.evaluate(async () => { globalThis.releaseFakeCamera(); await globalThis.fakeCameraPending; await new Promise(requestAnimationFrame); });
      await streamsStopped(page);
      assert.equal(await image.getAttribute("src"), retainedUri, "Cancel during permission wait preserves the previous photo");
      assert.equal(await input.inputValue(), draft);
    }
    if (width === 390) {
      await page.evaluate(() => { globalThis.fakeCameraMode = "denied"; });
      await captureButton.click();
      await camera.getByRole("alert").getByText(/未獲相機權限/).waitFor();
      await assertFits(page, "camera permission denied 390");
      await page.screenshot({ path: resolve(directory, "camera-denied-390.png") });
      await page.evaluate(() => { globalThis.fakeCameraMode = "live"; });
      await camera.getByRole("button", { name: "重新開啟相機", exact: true }).click(); await cameraReady(page);
      await page.keyboard.press("Escape"); await camera.waitFor({ state: "hidden" }); await streamsStopped(page);
      assert.equal(await input.inputValue(), draft);
      assert.equal(await photo.count(), 1, "Closing the live camera does not replace the selected photo");
    }
    await page.close();
  }
  return "camera: 4 widths, single Enter opens inline camera without navigation, canvas MediaStream captures complete local image, audio=false, tracks stop on capture/cancel, permission-wait cancellation disposes late stream, denial/explicit retry/Escape retain prior input; synthetic streams only, no real device permissions or Server";
}
