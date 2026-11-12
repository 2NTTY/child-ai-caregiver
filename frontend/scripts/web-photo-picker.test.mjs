import assert from "node:assert/strict";
import test from "node:test";
import { harness } from "./scope-transition-harness.mjs";

function setup(prepareWebPhoto = async file => file) {
  const picked = [], errors = [];
  const h = harness({ "./web-photo-file": { prepareWebPhoto }, "./photo-styles": { photoStyles: {} },
    "./WebCameraCapture.web": { WebCameraCapture: "Camera" } });
  const Picker = h.load("src/components/photos/PhotoFilePicker.web.tsx").PhotoFilePicker;
  const render = (disabled = false) => h.render(h.jsx(Picker, { disabled, onPick: value => picked.push(value), onError: value => errors.push(value) }));
  const select = file => h.hosts().find(node => node.type === "input").props.onChange({ currentTarget: { files: file ? [file] : [], value: "selected" } });
  render(); return { h, render, select, picked, errors };
}

test("gallery cancel leaves selection unchanged and a chosen photo becomes a local candidate", async () => {
  const f = setup();
  await f.select(); assert.equal(f.picked.length, 0); assert.deepEqual(f.errors, []);
  await f.select(new File(["local-photo"], "photo.jpg", { type: "image/jpeg" }));
  assert.equal(f.picked.length, 1);
  const photo = f.picked[0];
  assert.equal(photo.mimeType, "image/jpeg"); assert.equal(photo.bytes, 11);
  assert.match(photo.sha256, /^[a-f0-9]{64}$/u); assert.match(photo.imageSource.uri, /^blob:/u);
  assert.equal(typeof photo.readBase64, "function");
  photo.dispose(); f.h.unmount();
});

test("late conversion is discarded after disable or unmount without replacing the draft", async () => {
  for (const mode of ["disabled", "unmount"]) {
    let finish;
    const f = setup(() => new Promise(resolve => { finish = resolve; }));
    const selecting = f.select(new File(["heic"], "photo.heic", { type: "image/heic" }));
    if (mode === "disabled") f.render(true); else f.h.unmount();
    finish(new File(["jpeg"], "photo.jpg", { type: "image/jpeg" })); await selecting;
    assert.deepEqual(f.picked, []); assert.deepEqual(f.errors, []);
    if (mode === "disabled") f.h.unmount();
  }
});
