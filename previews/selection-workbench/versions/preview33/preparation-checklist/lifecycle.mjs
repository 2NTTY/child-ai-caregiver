// Lifecycle for this offline candidate, not a browser-storage recovery guarantee.
const sessions=new WeakMap();
export function mountSession({window,create,mount,setTimer=window.setTimeout.bind(window),clearTimer=window.clearTimeout.bind(window),now=window.performance?.now?.bind(window.performance)}){
 if(sessions.has(window))return sessions.get(window);
 const fixture=create({now});let active=true,timer=null,generation=0,timerKey=null;
 const cancel=()=>{generation++;if(timer!==null)clearTimer(timer);timer=null;timerKey=null;};
 const schedule=()=>{const plan=fixture.timerPlan();if(!active||!plan){cancel();return;}
  // A projection is not an edit. Keep the original timer unless its draft changes.
  if(timer!==null&&timerKey===plan.key)return;
  cancel();const stamp=generation;timerKey=plan.key;
  timer=setTimer(()=>{if(!active||stamp!==generation)return;timer=null;timerKey=null;
   const due=fixture.timerPlan();if(due?.key!==plan.key)return;
   // Clocked hosts read elapsed time; the standalone event model advances its logical clock.
   fixture.advance(due.delay);
  },plan.delay);
 };
 const view=mount(fixture),unsubscribe=fixture.subscribe(schedule);
 const hide=e=>{if(!active)return;if(e.persisted){cancel();fixture.suspend();}else destroy();};
 const show=e=>{if(active&&e.persisted)fixture.resume();};
 const destroy=()=>{if(!active)return;active=false;cancel();unsubscribe();window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);view.destroy();fixture.dispose();sessions.delete(window);};
 const session={fixture,view,destroy};sessions.set(window,session);
 window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);schedule();return session;
}
