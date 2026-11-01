/** Finite presentation-origin ports. Domain owner context itself stays stable.
 * Old visual callbacks cannot mutate disclosures/anchors or invoke an action after
 * their committed mode/route origin expires. Accepted owner timers are untouched. */
const callbacks=['setActionMenu','onAgent','onHistory','rememberList','setQuery','setTab','setFilter','setPage','setSelectedDay','setCalendarMonth','setCalendarOpen','changeFilter','selectCalendarDay','changeRoute','changeView'];
export function bindSlotInteractions(store,props){
 const token=store.authority(),current=()=>store.isCurrent(token),result={...props};
 const guard=fn=>(...args)=>current()?fn(...args):undefined;
 for(const key of callbacks)if(typeof props[key]==='function')result[key]=guard(props[key]);
 for(const key of ['actions','recovery'])if(props[key])result[key]=Object.fromEntries(Object.entries(props[key]).map(([name,fn])=>[name,typeof fn==='function'?guard(fn):fn]));
 if(props.anchor)result.anchor={get current(){return props.anchor.current;},set current(value){if(current())props.anchor.current=value;}};
 return result;
}
