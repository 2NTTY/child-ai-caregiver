/* Synthetic preview only: do not open local files, camera, screen capture or microphone. */
(function () {
  'use strict';
  const deny = () => { throw new DOMException('Only bundled synthetic examples are available in this preview', 'NotAllowedError'); };
  const isFile = input => input instanceof HTMLInputElement && input.type === 'file';
  for (const method of ['click', 'showPicker']) {
    const original = HTMLInputElement.prototype[method];
    if (original) HTMLInputElement.prototype[method] = function (...args) { if (isFile(this)) return; return original.apply(this, args); };
  }
  for (const type of ['click', 'change']) document.addEventListener(type, event => {
    if (!isFile(event.target)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (type === 'change') event.target.value = '';
  }, true);
  for (const type of ['drop', 'dragover', 'paste']) document.addEventListener(type, event => {
    const data = event.dataTransfer || event.clipboardData;
    if (data?.files?.length || Array.from(data?.types || []).includes('Files')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  if (navigator.mediaDevices) for (const method of ['getUserMedia', 'getDisplayMedia']) navigator.mediaDevices[method] = async () => deny();
})();
