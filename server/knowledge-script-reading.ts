import { z } from 'zod';
import type { KnowledgeChunkInput } from '../src/shared/knowledge.ts';
import { originalOrganizerApplicability } from './knowledge-inputs.ts';
import { bindPublisherAgeExamples, type AgeExampleRegistration } from './knowledge-age-examples.ts';

type Unit = { id: string; originalText: string; scriptPassage?: { title: string; firstParagraph?:number } };
export type PublisherAudience = {title?:string; audience:string; beforeMonths?:number};
export const publisherReviewInstruction = 'Review this verbatim reference edition for the family library. A source audience, when present, is the publisher’s literal wording. Numeric eligibility is unknown. A reading-only unit cannot authorise advice or proactive use, including when a child’s age is known. Check that the audience wording is faithful, paragraph ranges and age-specific examples remain exact, and no numeric inference or unrestricted eligibility is introduced. The conditions list quotes selected age-specific examples, not a numeric interval for the whole unit. Assess unchanged material and carry forward prior unresolved concerns. A textRef refers to repeatedText by zero-based index; optional start and end select the exact UTF-16 substring, end excluded. textIsOriginal marks a complete verbatim unit.';

/** Repeated originals, excerpts and conditions must reach the reviewer without consuming the input allowance twice. */
export function compactPublisherReview(payload:object,originals:readonly string[]) {
  const counts=new Map<string,number>();
  function visit(value:unknown):void {
    if(typeof value==='string'&&value.length>=60)counts.set(value,(counts.get(value)??0)+1);
    else if(value&&typeof value==='object')Object.values(value).forEach(visit);
  }
  visit(payload);
  const repeatedText=[...new Set(originals.filter(text=>text.length>=60))];
  for(const [text,count] of counts)if(count>1&&!repeatedText.some(original=>original.includes(text)))repeatedText.push(text);
  const refs=new Map(repeatedText.map((text,index)=>[text,index]));
  const evidence=JSON.parse(JSON.stringify(payload,(_,v:unknown)=>{
    if(typeof v!=='string'||v.length<60)return v;
    if(refs.has(v))return {textRef:refs.get(v)};
    const index=repeatedText.findIndex(text=>text.includes(v));
    if(index<0)return v;
    const start=repeatedText[index]!.indexOf(v);
    return {textRef:index,start,end:start+v.length};
  }));
  return {...evidence,repeatedText};
}

/** Literal-only editions keep each restriction inside its original paragraph. An unconfirmed range never grants advice eligibility. */
export function publisherScriptReading(units:readonly Unit[],materialTitle:string,labels:readonly PublisherAudience[],materialText='',exclusiveLookup=false,
  examples:readonly AgeExampleRegistration[] = [], topic:'official-transcript'|'official-material' = 'official-transcript') {
  const bound = bindPublisherAgeExamples(units,examples);
  for(const label of labels) {
    const evidence = label.title ? units.filter(u=>u.scriptPassage?.title===label.title).flatMap(u=>[u.scriptPassage!.title,u.originalText])
      : [materialTitle,materialText];
    if(!evidence.some(text=>text.includes(label.audience))) throw Error('knowledge_script_audience_evidence');
  }
  return units.map(unit=>{
    const title=unit.scriptPassage?.title ?? materialTitle;
    const specific=labels.filter(l=>l.title===title);
    const applicable=specific.length?specific:labels.filter(l=>l.title===undefined);
    const audiences=applicable.map(l=>l.audience);
    const before=applicable.length===1?applicable[0]?.beforeMonths:undefined;
    const sentences=(unit.originalText.match(/[^。！？；\n]+[。！？；]?/gu)??[]).map(s=>s.trim());
    const conditions=[...new Set(sentences.filter(s=>s.length<=600 &&
      /(?:[\d零〇一二兩三四五六七八九十百半]+\s*(?:個?月|歲|星期大|週大|日大)|學前|初生|新生)/u.test(s)))].slice(0,8);
    const applicability:KnowledgeChunkInput['applicability']={region:'HK',topics:[topic],conditions,
      ...(bound.has(unit.id) ? {ageExamples:bound.get(unit.id)!} : {}),
      use:'original_lookup',ageBasis:audiences.length?'publisher':'unconfirmed',minAgeMonths:null,maxAgeMonths:before??null,
      ...(before!==undefined?{maxAgeMonthsExclusive:true}:{}),
      ...(audiences.length?{publisherAudiences:audiences}:{})};
    const searchText=exclusiveLookup && !unit.scriptPassage?[...unit.originalText.trim()].slice(0,150).join(''):unit.originalText;
    return {unitId:unit.id,section:[...title].slice(0,100).join(''),text:searchText,
      keywords:[title.slice(0,80).toWellFormed()],applicability,treatment:{kind:'overview' as const,policyVersion:1 as const}};
  });
}
const numeric = z.strictObject({ basis: z.enum(['actual', 'corrected']), from: z.number().min(0).max(120),
  to: z.number().min(0).max(120), exclusive: z.boolean() });
const description = z.strictObject({ audience: z.union([z.enum(['lookup', 'general']), numeric]),
  conditions: z.array(z.string().min(1).max(20)).max(5), topics: originalOrganizerApplicability.shape.topics.max(3) });

export const scriptScopeInstruction = 'Return only the small metadata object for each numbered unit. The Server keeps its complete original. In conditions select existing keys from this unit’s wording (s1, s2, title or material), never copy or paraphrase the text. Include whole-unit publisher audience, age and other essential restrictions. Use general only if the entire unit is general. For a numeric interval both endpoints must be explicitly established for the whole unit; supply the actual or corrected basis and select the evidence. For one-sided, qualitative, unclear, cross-paragraph or otherwise unrepresentable scope use lookup: reading the original only. Never invent an age endpoint. Use one to three short topical slugs.';
export const scriptReviewInstruction = 'Independently compare each complete original, its official heading, audience and conditions. Candidate chunks with overview treatment are for finding and reading the quoted text only: their open search audience is not eligibility for advice. Confirm restricted units preserve the publisher wording, context and exceptions, and that each detailed unit really supports its proposed audience. Read priorHold when present and hold again if a concern still applies. Where textIsOriginal is true, text is the entire verbatim original. Keep change explanations concise.';

export function scriptReadingContract(units: readonly Unit[], materialTitle: string) {
  const inputs = units.map((unit, i) => {
    const title = unit.scriptPassage?.title ?? materialTitle;
    const wording: Record<string,string> = {title, material:materialTitle};
    // Offsets and punctuation stay in publisher order. Labels only refer to this unit.
    const pieces = unit.originalText.match(/[^。！？；\n]+[。！？；\n]*|[。！？；\n]+/gu) ?? [];
    let n = 0;
    for (const piece of pieces) {
      for (const part of piece.match(/.{1,280}/gsu) ?? []) wording['s' + (++n)] = part;
    }
    return { label:'u' + (i + 1), unit, title, wording };
  });
  const schema = z.strictObject(Object.fromEntries(inputs.map(({label}) => [label, description])));
  return { schema, inputs: inputs.map(({ label, wording }) => ({label, wording})),
    parse(raw: unknown) {
      const values = schema.parse(raw);
      return inputs.map(({label, unit, title, wording}) => {
        const {audience, conditions: keys, topics} = values[label]!;
        if (keys.some(key => !Object.hasOwn(wording,key) || !wording[key]!.trim())
          || typeof audience === 'object' && !keys.length) throw Error('knowledge_script_scope_quote');
        const conditions = [...new Set(keys.map(key => wording[key]!.trim()))];
        const applicability: KnowledgeChunkInput['applicability'] = originalOrganizerApplicability.parse({ region: 'HK', topics, conditions,
          ageBasis: typeof audience === 'object' ? audience.basis : 'any',
          minAgeMonths: typeof audience === 'object' ? audience.from : null,
          maxAgeMonths: typeof audience === 'object' ? audience.to : null,
          ...(typeof audience === 'object' && audience.exclusive ? { maxAgeMonthsExclusive: true } : {}) });
        const treatment: KnowledgeChunkInput['treatment'] = audience === 'lookup' ? {kind:'overview',policyVersion:1} : undefined;
        if (audience === 'lookup') applicability.use = 'original_lookup';
        return { unitId:unit.id, section:[...title].slice(0,100).join(''), text:unit.originalText,
          keywords:[title.slice(0,80).toWellFormed()], applicability, ...(treatment ? {treatment} : {}) };
      });
    } };
}
