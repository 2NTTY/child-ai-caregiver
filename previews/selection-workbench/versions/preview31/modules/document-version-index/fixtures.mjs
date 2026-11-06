// All names, IDs, dates and metadata are fabricated for DV01.
export function fixturePage(ticket,{empty=false,remove=null,invalidate=null}={}) {
  const b=ticket.binding,prefix=b.documentId==='doc-aurora'?'aur':b.documentId==='doc-aurora-copy'?'sea':'lan';
  let rows=ticket.cursor===null?[
    {snapshotId:`${prefix}-s7`,version:7,generatedAt:'2026-10-30T08:10:00Z',invalidated:false},
    {snapshotId:`${prefix}-s6`,version:6,generatedAt:'2026-10-26T10:30:00Z',invalidated:false},
    {snapshotId:`${prefix}-s4`,version:4,generatedAt:'2026-10-22T06:45:00Z',invalidated:true}
  ]:[
    {snapshotId:`${prefix}-s3`,version:3,generatedAt:'2026-10-18T08:15:00Z',invalidated:false},
    {snapshotId:`${prefix}-s1`,version:1,generatedAt:'2026-10-11T09:20:00Z',invalidated:false}
  ];
  rows=rows.filter(r=>r.snapshotId!==remove).map(r=>r.snapshotId===invalidate?{...r,invalidated:true}:r);
  if(b.filter==='readable')rows=rows.filter(r=>!r.invalidated);
  if(b.filter==='invalidated')rows=rows.filter(r=>r.invalidated);
  return {page:{documentId:b.documentId,documentVersion:b.documentVersion,items:empty?[]:rows,nextCursor:ticket.cursor===null?`synthetic:${prefix}:${b.filter}:page-2`:null}};
}
