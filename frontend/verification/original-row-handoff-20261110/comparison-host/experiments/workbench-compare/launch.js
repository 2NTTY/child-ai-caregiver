/* A thrown boundary script cannot fall through to a later static main tag. */
(function () {
  'use strict';
  const config=window.__HISTORICAL_COMPARE_CONFIG__, ready=window.__HISTORICAL_COMPARE_READY__;
  const fail=()=>{const note=document.createElement('p');note.setAttribute('role','alert');note.textContent='對照環境未能安全啟動；歷史主程式沒有執行。';document.body.replaceChildren(note);};
  if(!config || !ready || ready.epoch!==window.name.split(':').at(-1) || ready.main!==config.main || ready.mainSha256!==config.mainSha256 || ready.caseKey!==config.caseKey || ready.caseId!==config.caseId || ready.caseSha256!==config.caseSha256 || ready.loaded) {fail();return;}
  ready.loaded=true;
  const script=document.createElement('script');script.src='/'+config.main;script.integrity=config.mainIntegrity;script.crossOrigin='anonymous';script.onerror=fail;document.head.append(script);
})();
