const chosen=value=>value&&value!=='all';
export function selectPlacements(data,selection={}){
 const {route,module,level}=selection;
 const q=(selection.query??'').trim().toLocaleLowerCase();
 return data.placements.filter(p=>
  (!chosen(route)||p.routes.includes(route))&&
  (!chosen(module)||p.moduleIds.includes(module))&&
  (!chosen(level)||p.level===level)&&
  (!q||[p.title,...p.chain,p.mountCondition,p.visibleCondition,p.scope??'',...p.notes,...p.moduleIds,...p.moduleIds.map(id=>data.moduleTitles?.[id]??'')].join(' ').toLocaleLowerCase().includes(q))
 );
}
export function relationState(data,route,module){
 return data.placements.some(p=>p.routes.includes(route)&&p.moduleIds.includes(module))?'confirmed-placement':'not-proven-in-this-audit';
}
