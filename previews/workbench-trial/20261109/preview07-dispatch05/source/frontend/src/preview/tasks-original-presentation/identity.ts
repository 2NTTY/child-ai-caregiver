/** Historical evidence facts, NOT a registry entry, admission grant or reconstructed app. */
export const originalFragmentEvidence = Object.freeze({
  label: 'verified historical Original presentation fragments; composite identity unverified',
  kind: 'composite',
  appCommit: null,
  sourceTree: 'de0cbacb583c923fba8f88f27fd5f6b8d5409c1c',
  recipeSha256: 'e49b453d98d3bcb34ea51bb67d068078d90e9c50c8862ae70b81f3bbe237074b',
  receiptSha256: '979f1911d6132bf3bb2e08d62483619b67ada7f5ef6fb769ebe8ec6448f5bba1',
  identityPacketSha256: '4d0d866d207866900a2ab75e4400f0790cdf4950b3266db52378a8821c9fb844',
  availability: false, runtimeAdmission: false, compositeIdentityVerified: false,
  globalAppearanceImplemented: false,
  slots: Object.freeze(['header-actions', 'filters', 'date-list', 'calendar-layout'] as const),
  historicalRootZoom: Object.freeze({ default: 1.4, below900: 1.2, exceptPath: '/login', implemented: false }),
  historicalLoginZoom: 1,
} as const);
