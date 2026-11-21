import { CubismFramework } from 'cubism/live2dcubismframework';
import { CubismUserModel } from 'cubism/model/cubismusermodel';
import { csmVector } from 'cubism/type/csmvector';
import { CubismMatrix44 } from 'cubism/math/cubismmatrix44';

// This document runs inside an opaque sandbox. Its only input is a gesture.
const canvas = document.querySelector('canvas');
const files = JSON.parse(document.querySelector('#assets').textContent);
const bytes = name => Uint8Array.from(atob(files[name]), c => c.charCodeAt(0)).buffer;
const notify = state => parent.postMessage({ companion: state }, '*');

class Companion extends CubismUserModel {
  constructor() {
    super();
    this.loadModel(bytes('model'), true);
    if (!this.getModel()) throw Error('model');
    const physics = bytes('physics');
    this.loadPhysics(physics, physics.byteLength);
    this.motions = Object.fromEntries(['wave', 'nod'].map(name => {
      const data = bytes(name), motion = this.loadMotion(data, data.byteLength, name);
      motion.setEffectIds(new csmVector(), new csmVector());
      motion.setLoop(false);
      return [name, motion];
    }));
    this.faces = ['smile', 'laugh'].map(name => {
      const face = bytes(name);
      return this.loadExpression(face, face.byteLength, name);
    });
    this.taps = 0;
    this.modelIds = Object.fromEntries(['ParamBreath', 'ParamAngleZ', 'ParamEyeLOpen', 'ParamEyeROpen'].map(
      id => [id, CubismFramework.getIdManager().getId(id)]));
    this.getModel().saveParameters();
  }
  play(action) {
    const motion = action === 'wave' ? this.motions.wave : this.motions.nod;
    this._motionManager.startMotionPriority(motion, false, 3);
    if (action !== 'arrive') this._expressionManager.startMotion(this.faces[this.taps++ % 2], false);
  }
  advance(delta, idleTime = 0) {
    const model = this.getModel(), ids = this.modelIds;
    model.loadParameters();
    this._motionManager.updateMotion(model, delta);
    this._expressionManager.updateMotion(model, delta);
    if (idleTime) {
      const breath = (1 - Math.cos(idleTime * 1.5)) / 2;
      model.setParameterValueById(ids.ParamBreath, breath * 0.65);
      model.addParameterValueById(ids.ParamAngleZ, Math.sin(idleTime * .85) * 2);
      const blink = Math.min(1, Math.abs((idleTime % 4.8) - 3.6) / .15);
      model.multiplyParameterValueById(ids.ParamEyeLOpen, blink);
      model.multiplyParameterValueById(ids.ParamEyeROpen, blink);
    }
    this._physics.evaluate(model, delta);
    model.update();
  }
}
async function show() {
  const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
  if (!gl) throw Error('webgl');
  // Core 5.2 exposes its API before its embedded WebAssembly has finished instantiating.
  const started = performance.now();
  for (;;) {
    try { if (Live2DCubismCore.Version.csmGetVersion()) break; } catch { /* still initializing */ }
    if (performance.now() - started > 8000) throw Error('core_timeout');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
  CubismFramework.startUp();
  CubismFramework.initialize();
  const avatar = new Companion();
  avatar.createRenderer();
  const renderer = avatar.getRenderer();
  renderer.startUp(gl);
  const texture = new Image();
  texture.src = 'data:image/png;base64,' + files.texture;
  await texture.decode();
  const id = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, id);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  renderer.bindTexture(0, id);
  renderer.setIsPremultipliedAlpha(true);

  // Fit both axes to the model's bounds. Leave room for the ears and the moving hand.
  avatar.advance(0);
  const model = avatar.getModel();
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
  for (let i = 0; i < model.getDrawableCount(); i++) {
    if (!model.getDrawableOpacity(i)) continue;
    const xy = model.getDrawableVertexPositions(i);
    for (let j = 0; j < xy.length; j += 2) {
      left = Math.min(left, xy[j]); right = Math.max(right, xy[j]);
      bottom = Math.min(bottom, xy[j + 1]); top = Math.max(top, xy[j + 1]);
    }
  }
  // The wave lifts the ears above the rest pose, then extends the hand to the
  // viewer's left. Fit that motion envelope once so the feet and camera stay still.
  top += (top - bottom) * .08;
  left -= (right - left) * .12;
  const matrix = new CubismMatrix44();
  function draw(delta, idleTime = 0) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(innerWidth * ratio)), height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const sy = Math.min(1.88 / (top - bottom), (1.91 * width / height) / (right - left));
    const sx = sy * height / width;
    matrix.scale(sx, sy);
    matrix.translate(-(left + right) * sx / 2, -(bottom + top) * sy / 2);
    avatar.advance(delta, idleTime);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.setRenderState(null, [0, 0, width, height]);
    renderer.setMvpMatrix(matrix);
    renderer.drawModel();
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mode = 'quiet', timer = 0, last = performance.now(), activeUntil = 0;
  function schedule() {
    clearTimeout(timer);
    if (document.hidden || mode === 'hidden') return;
    const now = performance.now(), playing = now < activeUntil;
    draw(Math.max(0, Math.min(.1, (now - last) / 1000)), mode === 'idle' && !reduced.matches ? now / 1000 : 0);
    last = now;
    if (!reduced.matches && (playing || mode === 'idle')) timer = setTimeout(schedule, playing ? 33 : 80);
  }
  addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data === 'status') { notify('ready'); return; }
    if (['idle', 'quiet', 'hidden'].includes(event.data)) {
      mode = event.data;
      if (mode !== 'idle') { activeUntil = 0; avatar._motionManager.stopAllMotions(); }
    } else if (['nod', 'wave', 'arrive'].includes(event.data) && mode !== 'hidden') {
      avatar.play(event.data);
      if (reduced.matches) { avatar.advance(0); avatar.advance(.35); }
      activeUntil = performance.now() + (event.data === 'wave' ? 4700 : 3900);
    } else return;
    schedule();
  });
  addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', schedule);
  canvas.addEventListener('webglcontextlost', () => { clearTimeout(timer); mode = 'hidden'; notify('failed'); });
  draw(1 / 60);
  if (gl.getError() !== gl.NO_ERROR) throw Error('draw');
  notify('ready');
}
show().catch(() => notify('failed'));
