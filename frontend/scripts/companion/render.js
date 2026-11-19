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
    const physics = bytes('physics'), wave = bytes('wave');
    this.loadPhysics(physics, physics.byteLength);
    this.wave = this.loadMotion(wave, wave.byteLength, 'wave');
    this.wave.setEffectIds(new csmVector(), new csmVector());
    this.faces = ['smile', 'laugh'].map(name => {
      const face = bytes(name);
      return this.loadExpression(face, face.byteLength, name);
    });
    this.taps = 0;
  }
  greet() {
    this._motionManager.startMotionPriority(this.wave, false, 3);
    this._expressionManager.startMotion(this.faces[this.taps++ % this.faces.length], false);
  }
  advance(delta) {
    const model = this.getModel();
    model.loadParameters();
    this._motionManager.updateMotion(model, delta);
    model.saveParameters();
    this._expressionManager.updateMotion(model, delta);
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

  // Frame the face and raised hand using the mesh's actual coordinate system.
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
  const matrix = new CubismMatrix44();
  function draw(delta) {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(innerWidth * ratio)), height = Math.max(1, Math.round(innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const sy = Math.min(2 / ((top - bottom) * 0.62), (2 * width / height) / ((right - left) * 1.04));
    const sx = sy * height / width;
    matrix.scale(sx, sy);
    matrix.translate(-(left + right) * sx / 2, 0.94 - top * sy);
    avatar.advance(delta);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.setRenderState(null, [0, 0, width, height]);
    renderer.setMvpMatrix(matrix);
    renderer.drawModel();
  }
  let frame = 0, previous = 0, until = 0;
  function tick(now) {
    frame = 0;
    draw(Math.min(0.05, (now - previous) / 1000));
    previous = now;
    if (now < until && !document.hidden) frame = requestAnimationFrame(tick);
  }
  addEventListener('message', event => {
    if (event.source !== parent || event.data !== 'greet') return;
    avatar.greet();
    previous = performance.now();
    until = previous + (matchMedia('(prefers-reduced-motion: reduce)').matches ? 60 : 4500);
    if (!frame) frame = requestAnimationFrame(tick);
  });
  addEventListener('resize', () => draw(0));
  canvas.addEventListener('webglcontextlost', () => { cancelAnimationFrame(frame); notify('failed'); });
  draw(1 / 60);
  if (gl.getError() !== gl.NO_ERROR) throw Error('draw');
  notify('ready');
}
show().catch(() => notify('failed'));
