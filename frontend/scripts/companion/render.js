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
    this.expression = null;
    this.look = 0;
    this.modelIds = Object.fromEntries(['ParamBreath', 'ParamAngleX', 'ParamAngleY', 'ParamAngleZ',
      'ParamEyeBallX', 'ParamEyeBallY', 'ParamEyeLOpen', 'ParamEyeROpen', 'ParamMouthForm', 'ParamMouthOpenY'].map(
      id => [id, CubismFramework.getIdManager().getId(id)]));
    this.getModel().saveParameters();
  }
  rest() {
    this.expression = null;
    this.look = 0;
    this._motionManager.stopAllMotions();
  }
  play(action) {
    this.expression = { action, elapsed: 0 };
    if (action === 'answer' || action === 'acknowledge') return;
    this._motionManager.startMotionPriority(action === 'wave' ? this.motions.wave : this.motions.nod, false, 3);
  }
  advance(delta, idleTime = 0, listen = 0) {
    const model = this.getModel(), ids = this.modelIds;
    model.loadParameters();
    this._motionManager.updateMotion(model, delta);
    this.look += (listen - this.look) * (1 - Math.exp(-5 * delta));
    if (idleTime) {
      const breath = (1 - Math.cos(idleTime * 1.5)) / 2;
      model.setParameterValueById(ids.ParamBreath, breath * .65);
      model.addParameterValueById(ids.ParamAngleX, this.look * 9);
      model.addParameterValueById(ids.ParamAngleZ, Math.sin(idleTime * .85) * 1.8 - this.look * 6);
      model.addParameterValueById(ids.ParamEyeBallX, this.look * .49 + Math.sin(idleTime * .72) * .09);
      model.addParameterValueById(ids.ParamEyeBallY, -.12 * Math.abs(this.look));
      const blink = Math.min(1, Math.abs((idleTime % 4.8) - 3.6) / .15);
      model.multiplyParameterValueById(ids.ParamEyeLOpen, blink);
      model.multiplyParameterValueById(ids.ParamEyeROpen, blink);
    }
    const face = this.expression;
    if (face) {
      face.elapsed += delta;
      const answering = face.action === 'answer', nodding = face.action === 'acknowledge';
      const duration = answering ? 1.55 : nodding ? .72 : 1.15;
      const t = Math.min(1, face.elapsed / duration), warmth = Math.sin(Math.PI * t);
      model.addParameterValueById(ids.ParamMouthForm, warmth * .75);
      if (nodding) model.addParameterValueById(ids.ParamAngleY, -17 * Math.sin(Math.PI * t) ** 2);
      if (answering) {
        const syllable = Math.max(0, Math.sin(t * 5.5 * Math.PI));
        model.setParameterValueById(ids.ParamMouthOpenY, .5 * warmth * syllable);
        model.addParameterValueById(ids.ParamAngleZ, 4 * warmth);
      }
      if (t === 1) this.expression = null;
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
  function draw(delta, idleTime = 0, listen = 0) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(innerWidth * ratio)), height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const sy = Math.min(1.88 / (top - bottom), (1.91 * width / height) / (right - left));
    const sx = sy * height / width;
    matrix.scale(sx, sy);
    matrix.translate(-(left + right) * sx / 2, -(bottom + top) * sy / 2);
    avatar.advance(delta, idleTime, listen);
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
    const ambient = mode === 'idle' || mode.startsWith('listen-');
    draw(Math.max(0, Math.min(.15, (now - last) / 1000)), ambient && !reduced.matches ? now / 1000 : 0,
      mode === 'listen-left' ? -1 : mode === 'listen-right' ? 1 : 0);
    last = now;
    if (!reduced.matches && (playing || ambient)) timer = setTimeout(schedule, playing ? 33 : 80);
  }
  addEventListener('message', event => {
    if (event.source !== parent) return;
    if (event.data === 'status') { notify('ready'); return; }
    if (['idle', 'quiet', 'hidden', 'listen-left', 'listen-right'].includes(event.data)) {
      mode = event.data;
      if (mode === 'quiet' || mode === 'hidden') {
        avatar.rest(); activeUntil = 0;
      }
    } else if (['nod', 'wave', 'arrive', 'acknowledge', 'answer'].includes(event.data) && mode !== 'hidden') {
      if (reduced.matches) return;
      avatar.play(event.data);
      activeUntil = performance.now() + (event.data === 'wave' ? 4700 : 3900);
    } else return;
    schedule();
  });
  addEventListener('resize', schedule);
  document.addEventListener('visibilitychange', schedule);
  reduced.addEventListener('change', () => {
    if (reduced.matches) { avatar.rest(); activeUntil = 0; }
    schedule();
  });
  canvas.addEventListener('webglcontextlost', () => { clearTimeout(timer); mode = 'hidden'; notify('failed'); });
  draw(1 / 60);
  if (gl.getError() !== gl.NO_ERROR) throw Error('draw');
  notify('ready');
}
show().catch(() => notify('failed'));
