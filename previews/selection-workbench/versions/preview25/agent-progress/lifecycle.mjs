// Cached-page retention is not final disposal, and never replays an operation.
export function bindLifecycle(target,fixture,view){
  let disposed=false;
  const dispose=()=>{if(disposed)return;disposed=true;view.retireFocus();view.destroy();fixture.dispose();target.removeEventListener('pagehide',hide);target.removeEventListener('pageshow',show)};
  const hide=event=>{if(disposed)return;if(event.persisted){view.retireFocus();fixture.suspend()}else dispose()};
  const show=()=>{if(!disposed)fixture.resume()};
  target.addEventListener('pagehide',hide);target.addEventListener('pageshow',show);
  return dispose;
}
