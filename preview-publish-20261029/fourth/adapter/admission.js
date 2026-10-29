/* Fourth-only packaging admission. The combined R2 synthetic business core is unchanged. */
(function (root) {
  'use strict';
  const parent = root.__YU_PREVIEW_FACTORY__;
  const modes = new Set(['ready', 'complete-profile', 'populated', 'long-content', 'empty', 'error', 'signedout', 'loading', 'no-child', 'mutation-unknown', 'unknown-age-zero-records', 'core-journeys', 'core-no-child']);
  const loading = new Set(['children', 'child-reads', 'documents']);
  root.__YU_PREVIEW_FACTORY__ = (options = {}) => {
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Unsupported fourth preview options');
    const comparison = options.comparison;
    const variant = options.variant === undefined ? comparison?.version : options.variant;
    const mode = options.mode === undefined ? 'ready' : options.mode;
    if (variant !== 'uiux-upgrade' || !modes.has(mode)) throw new Error('Unsupported fourth preview admission');
    if (!comparison || !Object.isFrozen(comparison) || comparison.version !== variant) throw new Error('Missing fourth preview identity');
    if (mode === 'loading' ? !loading.has(options.loadingTarget) : options.loadingTarget !== undefined) throw new Error('Unsupported fourth preview loading');
    for (const key of Object.keys(options)) if (key.startsWith('previewWork') || key.startsWith('initialWork')) {
      if (options[key] !== undefined) throw new Error('Unsupported fourth preview work option');
    }
    return parent(options);
  };
})(globalThis);
