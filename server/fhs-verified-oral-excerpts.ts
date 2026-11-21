import type { ObservedContent, SourceWatchDefinition } from './knowledge-refresh-types.ts';

// B033-13. A separate blind transcription of the four original printed leaves matched every character.
export const oralPrint = {
  sourceId:'resource-af8c3e8cc813be',
  url:'https://www.fhs.gov.hk/tc_chi/archive/files/oral_health/oral_health_care_for_your_children(tc).pdf',
  pdfHash:'79ff818d17f7da0898a2dfeb52330caca99ae51818026cddb97c9413444b7998',
  totalPages:18,
  passages:[
    {page:1, quote:'幼兒口腔護理全接觸'},
    {page:6, quote:'寶寶不會因出牙而發燒。'},
    {page:12, quote:'6個月以下的寶寶，由於年紀太小，仍未建立固定的飲食模式，尤其初生嬰兒，主要的營養來源是奶。'},
    {page:15, quote:'開始時在上排門牙的表面會出現很大範圍的蛀牙洞。'},
  ],
} as const;

export function verifiedOralExcerpts(watch:SourceWatchDefinition, fileHash:string, totalPages:number,
  title:string, sourceDateText:string|null): ObservedContent | undefined {
  if (watch.id !== oralPrint.sourceId || watch.kind !== 'pdf' || watch.url !== oralPrint.url || watch.leafletPage !== oralPrint.url
    || watch.audience !== 'public_noncommercial' || fileHash !== oralPrint.pdfHash || totalPages !== oralPrint.totalPages) return;
  const pages = oralPrint.passages.map(({page,quote}) => ({page,text:quote,status:'text' as const}));
  return {url:watch.url,title,text:pages.map(p=>p.text).join('\n\n'),pages,sourceDateText,sourcePublishedAt:null,sourceUpdatedAt:null,
    extraction:{format:'text_pdf',contentHash:fileHash,extractionQuality:'requires_review',totalPages,pageStart:1,pageEnd:totalPages,complete:false}};
}
