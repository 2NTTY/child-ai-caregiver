import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';
import { knowledgeReviewHash } from '../server/knowledge-review-assessment.ts';
import { nativeResponseSchema } from '../server/structured-output-schema.ts';

export const printedCorrection = {
  sourceId: 'resource-af8c3e8cc813be',
  pdfHash: '79ff818d17f7da0898a2dfeb52330caca99ae51818026cddb97c9413444b7998',
  packetHash: 'a761a002dda69cc5ae7c074d6cd14798b20d53a67335ae2be11e610c4f2f818f',
  totalPages: 18,
  passages: [
    {page:1, where:'封面右半頁上方，彩色的大字冊名。', quote:'幼兒口腔護理全接觸'},
    {page:6, where:'右側粉紅色「發燒」欄，從欄題以下轉錄第一句，至第一個句號。', quote:'寶寶不會因出牙而發燒。'},
    {page:12, where:'左上粉紅「6個月以下」之下，藍字第一段的第一句，由段首至第一個句號。', quote:'6個月以下的寶寶，由於年紀太小，仍未建立固定的飲食模式，尤其初生嬰兒，主要的營養來源是奶。'},
    {page:15, where:'印刷頁26，第一幅牙齒照片正右方的三行紅字說明，由段首至第一個句號。', quote:'開始時在上排門牙的表面會出現很大範圍的蛀牙洞。'},
  ],
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
