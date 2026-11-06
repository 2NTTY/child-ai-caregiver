/** Invented metadata only. No family data, contacts, photos, invitation codes,
 * documents, child content, or production IDs are present. */
const uuid = number => `10000000-0000-4000-8000-${String(number).padStart(12,'0')}`;
export const IDS = Object.freeze({teacher:uuid(1),teacher2:uuid(2),classroom:uuid(11),classroom2:uuid(12),classroom3:uuid(13),directClass:uuid(14),family:uuid(21),family2:uuid(22)});
const stamp='2026-11-04T23:30:00-08:00';
function space(id,kind,name,extra={}) {return {id,kind,name,version:4,role:'viewer',managerUserId:'synthetic-member-01',transferTargetUserId:null,createdAt:'2026-08-01T09:00:00+08:00',updatedAt:stamp,...extra};}
const teacher=space(IDS.teacher,'teachers','星港教師空間（合成）',{version:7});
const teacher2=space(IDS.teacher2,'teachers','海風教師空間（合成）');
const inherited={teacherSpaceId:IDS.teacher,teacherSpaceName:teacher.name,teacherSpaceVersion:teacher.version};
const classroom=space(IDS.classroom,'class','晨光班（合成）',inherited);
const classroom2=space(IDS.classroom2,'class','月灣班（合成）',inherited);
const classroom3=space(IDS.classroom3,'class','一起看見每一步的長名稱班級（合成）',inherited);
const direct=space(IDS.directClass,'class','獨立小島班（合成）');
const family=space(IDS.family,'family','小橙共享空間（合成）');
const family2=space(IDS.family2,'family','薄荷共享空間（合成）');
const spaces=[teacher,teacher2,classroom,classroom2,classroom3,direct,family,family2];
const member=(i)=>({userId:`synthetic-member-${String(i).padStart(2,'0')}`,label:`示例成員 ${String(i).padStart(2,'0')}（合成）`,role:i===1?'owner':i===2?'caregiver':'viewer',version:2,joinedAt:i===2?'2026-11-05T01:30:00+14:00':stamp});
const members=[1,2,3,4,5].map(member);
const grant=(i,spaceId)=>({childId:uuid(100+i),childName:`${i===1||i===2?'同名小星':i===6?'名字很長也保留完整識別的示例孩子':`示例孩子 ${String(i).padStart(2,'0')}`}（合成）`,modules:i%2?['profile','care','tasks']:['profile','growth'],sharedBy:spaceId===IDS.family?'synthetic-member-02':`space:${spaceId}`,version:3,canWithdraw:false});
const grants=id=>id===IDS.classroom2||id===IDS.family2?[]:Array.from({length:id===IDS.family?4:7},(_,i)=>grant(i+1,id));
const cursor=(kind,id,offset)=>`synthetic:${kind}:${id}:${offset}`;
function makePage(items,kind,id,start=0,size=3) {const end=Math.min(items.length,start+size);return {items:items.slice(start,end),nextCursor:end<items.length?cursor(kind,id,end):null};}
function startAt(value,kind,id){if(!value)return 0;const prefix=`synthetic:${kind}:${id}:`;if(!value.startsWith(prefix)||!/^\d+$/u.test(value.slice(prefix.length)))throw Object.assign(new Error('Invalid local fixture cursor'),{code:'invalid_cursor'});return Number(value.slice(prefix.length));}
export function readFixture(op,args={}) {
  const {mode='teachers',spaceId,cursor:position}=args;
  if(op==='spaces'){const list=spaces.filter(s=>s.kind===mode);return structuredClone(makePage(list,'spaces',mode,startAt(position,'spaces',mode),mode==='teachers'?1:2));}
  const selected=spaces.find(s=>s.id===spaceId);if(!selected)throw Object.assign(new Error('Unknown synthetic space'),{status:404});
  const memberList=selected.id===IDS.teacher2?members.slice(0,2):members;
  const children=selected.kind==='teachers'?[]:grants(spaceId);
  const classes=selected.id===IDS.teacher?[classroom,classroom2,classroom3]:[];
  if(op==='detail')return structuredClone({selected,members:makePage(memberList,'members',spaceId),shares:makePage(children,'shares',spaceId),teacherClasses:makePage(classes,'teacherClasses',spaceId,0,2)});
  const list=op==='members'?memberList:op==='shares'?children:op==='teacherClasses'?classes:null;
  if(!list)throw new Error('No mutation or unknown operation supported');
  return structuredClone(makePage(list,op,spaceId,startAt(position,op,spaceId),op==='teacherClasses'?2:3));
}
