import { z } from 'zod';
import { AgentStopped } from './agent-budget.ts';
import type { ChatDeliveryDraft } from './chat-delivery-review.ts';

export interface ChartReviewSource {
  sourceId: string;
  versionHash: string;
  pdfHash: string;
  physicalPage: number;
  purpose: 'original_lookup';
  fields: { label: string; value: string }[];
}

export const chartChecks = z.array(z.strictObject({
  paragraph: z.int().min(0).max(5),
  citationId: z.string().min(1).max(80),
  fields: z.array(z.strictObject({ index: z.int().min(0).max(11), value: z.string().min(1).max(80) })).max(12),
  passages: z.array(z.string().min(1).max(300)).max(12),
  supported: z.boolean(),
})).max(36);

export const chartReviewInstruction = '\n' + [
  '逐段核對本輪 userRequest 與引用的 chart。chart 及 excerpt 是同版實頁的已審解讀，只供查閱。先獨立辨認問題和回答所指的對象。',
  '每個段落與所引圖表各填一項 chartChecks。fields 填所用欄的零起始 index 及該段對應的值，以印本單位和記法表示。同義詞、中文數字和有根據的比較均可。比較時逐一對齊對象、原數值、單位和條件，重算所聲稱的差額或倍數及確認方向。',
  '沒有結構化欄位，或需參照標題、條件或備註時，passages 摘錄支持該說法的完整字句。欄列關係有歧義便要求修訂。綜合其他來源時只把該圖表支持的部分歸到它。',
  '錯欄、錯單位、無據計算、個人適用推論、把圖表解讀當出版者逐字原句，或未回答所問時，supported=false 並在 issues 指明段落及實際依據。只在每項陳述均有據時才可通過。',
].join('\n');

/** A general pass cannot approve an unchecked chart, a different cell or an invented supporting span. */
export function checkChartSupport(draft: ChatDeliveryDraft, checks?: z.infer<typeof chartChecks>) {
  const charts = new Map(draft.sources.filter(source => source.chart).map(source => [source.citationId, source]));
  const expected = draft.paragraphs.flatMap((row, paragraph) => [...new Set(row.citationIds)]
    .filter(id => charts.has(id)).map(citationId => ({ paragraph, citationId })));
  if ((checks?.length ?? 0) !== expected.length) throw new AgentStopped('delivery_review_incomplete');
  for (const { paragraph, citationId } of expected) {
    const check = checks?.find(row => row.paragraph === paragraph && row.citationId === citationId);
    if (!check) throw new AgentStopped('delivery_review_incomplete');
    const source = charts.get(citationId)!;
    if (!check.supported || (!check.fields.length && !check.passages.length)
      || new Set(check.fields.map(field => field.index)).size !== check.fields.length
      || check.fields.some(field => source.chart!.fields[field.index]?.value !== field.value)
      || check.passages.some(passage => !passage.trim() || !source.excerpt.includes(passage))) {
      throw new AgentStopped('delivery_review_rejected');
    }
  }
}
