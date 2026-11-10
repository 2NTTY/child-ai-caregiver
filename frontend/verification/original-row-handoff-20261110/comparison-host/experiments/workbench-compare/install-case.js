/* Runs after the exact complete historical safety chain and before the boundary/main. */
(function () {
  'use strict';
  const config = window.__HISTORICAL_COMPARE_CONFIG__;
  const chain = window.__HISTORICAL_CHAIN__?.snapshot();
  if (!config || !chain?.complete || chain.failed || chain.transport !== window.fetch) throw new Error('HISTORICAL_FIXTURE_CHAIN_INCOMPLETE');
  const fixture = window.__CREATE_HISTORICAL_SHARED_READER__(location.origin, config.caseKey);
  if (fixture.caseKey !== config.caseKey || fixture.caseId !== config.caseId || fixture.caseSha256 !== config.caseSha256) throw new Error('SHARED_CASE_IDENTITY_MISMATCH');
  Object.defineProperty(window,'__HISTORICAL_SHARED_READER__',{value:fixture,configurable:false});
  window.fetch = fixture.transport;
})();
