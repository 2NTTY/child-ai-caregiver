import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { knowledgeReviewHash, validateKnowledgeAssessment } from '../server/knowledge-review-assessment.ts';
import { oralPrint } from '../server/fhs-verified-oral-excerpts.ts';
import { embeddingForChunk, parseKnowledgeSource, sourceVersionHash } from '../server/knowledge-inputs.ts';
import { nativeResponseSchema } from '../server/structured-output-schema.ts';

const locations = ['封面右半頁上方，彩色的大字冊名。','右側粉紅色「發燒」欄，從欄題以下轉錄第一句，至第一個句號。',
  '左上粉紅「6個月以下」之下，藍字第一段的第一句，由段首至第一個句號。',
  '印刷頁26，第一幅牙齒照片正右方的三行紅字說明，由段首至第一個句號。'];
export const printedCorrection = {
  sourceId:oralPrint.sourceId,
  pdfHash:oralPrint.pdfHash,
  packetHash: 'a761a002dda69cc5ae7c074d6cd14798b20d53a67335ae2be11e610c4f2f818f',
  totalPages:oralPrint.totalPages,
  passages:oralPrint.passages.map(({page,quote},i)=>({page,where:locations[i],quote})),
};
const response = z.strictObject(Object.fromEntries(printedCorrection.passages.map(p => ['page' + p.page, z.string().min(1).max(240)])));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Copy the four physical leaves in their original order without adding a text overlay. */
export async function copyPrintedPages(bytes) {
  if (digest(bytes) !== printedCorrection.pdfHash) throw Error('fhs_printed_parent_changed');
  const source = await PDFDocument.load(bytes, {updateMetadata:false});
  if (source.getPageCount() !== printedCorrection.totalPages) throw Error('fhs_printed_parent_changed');
  const output = await PDFDocument.create({updateMetadata:false});
  for (const page of await output.copyPages(source, printedCorrection.passages.map(p => p.page - 1))) output.addPage(page);
  const pdf = Buffer.from(await output.save());
  const hash = digest(pdf);
  if (hash !== printedCorrection.packetHash) throw Error('fhs_printed_packet_changed');
  return {pdf, hash};
}

export function makePrintedCorrectionRequest(parent, packetHash) {
  const system = '你是香港繁體中文印本的獨立校對員。只看附件實際印出的字形，按指定位置逐字轉錄。保留原字、數字、標點和語序。可略去版面換行。若任何一處不能辨認，該欄填「無法辨認」。';
  const user = JSON.stringify({source:printedCorrection.pdfHash,
    locations:printedCorrection.passages.map(({page,where},i) => ({attachmentPage:i+1,physicalPage:page,where}))});
  const responseJsonSchema = nativeResponseSchema(response);
  const attemptKey = 'knowledge-print-review:' + knowledgeReviewHash([parent,packetHash,system,user,responseJsonSchema]);
  return {system,user,attemptKey,responseJsonSchema,role:'knowledge_review',purpose:'knowledge_review'};
}

export function checkPrintedTranscription(raw) {
  const result = response.parse(raw);
  return printedCorrection.passages.map(({page,quote}) => {
    const actual = result['page' + page].replace(/\s+/gu, '');
    if (actual !== quote) throw Error('fhs_printed_transcription_mismatch_page_' + page);
    return actual;
  });
}

export function correctedPrintedEdition(prior, versionId, observation, observationHash, quotes) {
  const old = prior.source, pages = observation.pages;
  if (prior.versionHash !== sourceVersionHash(old) || prior.assessment.decision !== 'approve'
      || old.extraction?.contentHash !== oralPrint.pdfHash || pages.length !== 4 || old.chunks.length !== pages.length)
    throw Error('fhs_printed_baseline_changed');
  const source = parseKnowledgeSource({...old,extraction:observation.extraction,chunks:old.chunks.map((chunk,i)=>{
    const {page,text} = pages[i];
    if ((chunk.excerptPage ?? chunk.pageStart) !== page || quotes[i] !== text || text !== oralPrint.passages[i].quote)
      throw Error('fhs_printed_passage_changed');
    const corrected = {...chunk,originalText:text,sourceExcerpt:text,originalKind:'page_excerpt',excerptPage:page};
    if (embeddingForChunk(old.title,chunk).hash !== embeddingForChunk(old.title,corrected).hash)
      throw Error('fhs_printed_embedding_changed');
    return corrected;
  })});
  const assessment = {...prior.assessment,comparedVersionId:versionId,comparedHash:prior.versionHash,observationHash,
    changes:source.chunks.map((chunk,i)=>({key:chunk.key,oldQuote:old.chunks[i].sourceExcerpt,newQuote:chunk.sourceExcerpt,meaning:'unchanged',
      explanation:'修正印本引文的字形映射。原有適用年齡、條件、數據、整理文字及實頁範圍沿用原先兩份已核讀稿。'}))};
  validateKnowledgeAssessment(assessment,source,old);
  return {source,assessment,versionHash:sourceVersionHash(source)};
}
