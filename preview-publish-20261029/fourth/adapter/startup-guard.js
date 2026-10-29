  // Reject bad fourth selections after networking is denied, before creating any fixture.
  for (const key of ['experiment', 'previewScenario', 'previewLoading']) if (query.has(key) && query.get(key) === '') throw new Error('Empty fourth preview selection');
  for (const key of query.keys()) if (key.startsWith('previewWork') || key.startsWith('initialWork')) throw new Error('Unsupported fourth preview work selection');
  const fourthMode = query.has('previewScenario') ? query.get('previewScenario') : 'ready';
  if (query.has('previewLoading') && fourthMode !== 'loading') throw new Error('Unexpected fourth preview loading');
