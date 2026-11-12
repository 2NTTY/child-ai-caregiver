import { sourceVersionHash } from '../server/knowledge-inputs.ts';
import { validateKnowledgeAssessment, type KnowledgeReviewAssessment } from '../server/knowledge-review-assessment.ts';
import type { KnowledgeChunkInput, KnowledgeSourceInput } from '../src/shared/knowledge.ts';

export const LOCAL_OFFICIAL_SEED_IDS = [
  'fhs-solid-food',
  'fhs-toddler-development',
  'fhs-preschool-development',
  'fhs-child-vision',
  'fhs-feeding-booklet-en',
] as const;

type SeedReviewTemplate = {
  reviewedVersionHash: string;
  chunkNotes: Record<string, string>;
  checks: KnowledgeReviewAssessment['checks'];
  questions: KnowledgeReviewAssessment['questions'];
  growthRuleImpact: KnowledgeReviewAssessment['growthRuleImpact'];
  growthRuleReason: string;
};

const SEED_REVIEW_TEMPLATES: Record<string, SeedReviewTemplate> = {
  'fhs-toddler-development': {
    reviewedVersionHash: '91365018235f8e28d39d5cce6f191cdd927b0da61a16e85be9b2f0b647974479',
    chunkNotes: {
      'play-and-language': '匯入衞生署一至兩歲兒童發展官方指引，保留每個孩子發展速度不同及透過日常互動遊戲促進語言理解與表達的重點。',
    },
    checks: {
      age: '適用範圍為 12–24 個月（1–2 歲）幼兒，不套用於較小嬰兒或較大兒童。',
      numbersAndUnits: '僅保留 1–2 歲階段性發展觀察，無自創劑量或定量指標。',
      timing: '鼓勵在日常親子共讀、對話與遊戲中持續回應，無緊迫時間窗口限制。',
      conditions: '適用於一般一至兩歲幼兒發展與親子互動情境；保留香港地區與 development/play 主題限定。',
      exceptions: '個別孩子若有發展遲緩疑慮、聽力疑慮或特殊需要，需交由醫護或母嬰健康院人員評估。',
      prohibitions: '不可作出醫療診斷，並保留「每個孩子發展速度不同」的前提。',
      withdrawal: 'Curated hk-official-seed.json 已對照官方 15654.html；後續仍以發佈／停用狀態為準。',
    },
    questions: [
      {
        query: '歲半孩子可以一起玩甚麼遊戲幫助語言發展？',
        expectedKeys: ['play-and-language'],
        reason: '檢索 12–24 個月發展與遊戲互動官方建議。',
      },
    ],
    growthRuleImpact: 'reviewed',
    growthRuleReason: '與 growth-rules 中 toddler_play（12–24 個月）成長主題規則對齊；只供檢索參考，不自動寫入個人檔案。',
  },
  'fhs-preschool-development': {
    reviewedVersionHash: '31aa8a4ec2afbdfe16425601de23b7193ca5a30d2773966b9e98eef5c50b9243',
    chunkNotes: {
      'persistent-concerns': '匯入衞生署三至六歲學前兒童發展官方指引，保留多項問題持續出現時及早諮詢母嬰健康院、老師或醫護的建議。',
    },
    checks: {
      age: '適用範圍為 36–72 個月（3–6 歲學前兒童），不套用於其他年齡段。',
      numbersAndUnits: '保留三至六歲年齡邊界及「多項問題持續」描述，無新增數值門檻。',
      timing: '如持續出現多項發展困難或適應問題，建議盡早與學校老師、母嬰健康院或醫護人員商討。',
      conditions: '適用於香港學前兒童發展疑慮與轉介諮詢情境（development 主題）。',
      exceptions: '出現急性神經學或急症警號時應依安全分流即時求醫，而非只等候一般轉介。',
      prohibitions: '不可替家長診斷發展障礙或保證結果，僅提供官方求助途徑。',
      withdrawal: 'Curated hk-official-seed.json 已對照官方 14821.html；後續仍以發佈／停用狀態為準。',
    },
    questions: [
      {
        query: '幼稚園孩子持續出現多項發展困難，可向誰求助？',
        expectedKeys: ['persistent-concerns'],
        reason: '檢索學前兒童持續多項發展困難的官方求助與轉介資訊。',
      },
    ],
    growthRuleImpact: 'reviewed',
    growthRuleReason: '與 growth-rules 中 preschool_development（36–72 個月）成長主題規則對齊，不觸發自動提醒或寫入。',
  },
  'fhs-child-vision': {
    reviewedVersionHash: 'a6432201467e9ace706af530150446fdd2d51694be9e1a6fabb756c5f772027e',
    chunkNotes: {
      'preschool-screening': '匯入學前兒童（4–5 歲）視力普查服務官方指引，保留服務對象年齡（未滿六歲學前兒童）與篩查安排。',
      'school-eye-care': '匯入學童護眼與視力異常轉介官方指引，保留閱讀距離、光線、休息及有疑問請教醫生或視光師之原則。',
    },
    checks: {
      age: '嚴格區分學前視力普查（48–72 個月，不含 72 個月）及學童護眼（72–120 個月）。',
      numbersAndUnits: '保留原文歲數門檻（四至五歲學前普查；6 歲以上學童護眼），不改寫或補全距離與度數建議。',
      timing: '按學前定期普查或學童日常用眼護眼需要查閱；遇突然視力下降等緊急情況不依賴一般篩查時間表。',
      conditions: '適用於香港 vision／checkup 主題查詢，並依孩子目前年齡選取對應片段。',
      exceptions: '突發眼痛、紅腫、視物模糊劇變或外傷屬醫療情況，應即時求醫，不單靠一般護眼資訊。',
      prohibitions: '不可用學前普查取代眼科醫生或註冊視光師檢查，亦不代為評估視力結果。',
      withdrawal: 'Curated hk-official-seed.json 已對照官方 14812.html；後續仍以發佈／停用狀態為準。',
    },
    questions: [
      {
        query: '四歲兒童可以怎樣參加學前視力普查？',
        expectedKeys: ['preschool-screening'],
        reason: '確認 48–72 個月排他區間可檢索學前視力普查片段。',
      },
      {
        query: '小學生閱讀時如何保護眼睛，視力有疑問向誰查詢？',
        expectedKeys: ['school-eye-care'],
        reason: '確認 72–120 個月學童護眼片段可正確被檢索。',
      },
    ],
    growthRuleImpact: 'reviewed',
    growthRuleReason: '與 growth-rules 中 school_vision（72–120 個月）對齊，並保留 48–72 個月學前篩查邊界。',
  },
  'fhs-feeding-booklet-en': {
    reviewedVersionHash: 'e14d3a06106b4e8ebb28b02a740db717d67b746bb57b179e52f1e3fe7e18fd98',
    chunkNotes: {
      'introducing-solids-page-3': '匯入衞生署英文嬰幼兒加固小冊子第 3 頁原文，保留約六個月後鐵質需求上升、單一食物嘗試及不加糖鹽等官方原則。',
    },
    checks: {
      age: '適用範圍為 0–12 個月嬰兒；重點指明滿 6 個月後對鐵質需求上升。',
      numbersAndUnits: '保留 6 months 及原有年齡表述，不額外換算體重或鐵質毫克建議量。',
      timing: '約六個月時循序引入固體食物，觀察數天再試下一種新食物，不與急性食物過敏處置混淆。',
      conditions: '適用於香港地區 0–12 個月 feeding 主題之英文官方參考查詢。',
      exceptions: '早產或已知嚴重食物過敏嬰兒應按兒科／營養師個別指導，不單靠小冊子摘要。',
      prohibitions: '保留不應過早（<4 個月）或不適當添加調味料的官方限制。',
      withdrawal: 'Curated hk-official-seed.json 已對照官方 14727.pdf 第 3 頁；後續仍以發佈／停用狀態為準。',
    },
    questions: [
      {
        query: 'Why do babies need iron-rich solid foods around 6 months?',
        expectedKeys: ['introducing-solids-page-3'],
        reason: 'Verify retrieval of English FHS booklet page 3 for 6-month iron and solids guidance.',
      },
    ],
    growthRuleImpact: 'none',
    growthRuleReason: '與既有 fhs-solid-food 同屬 0–12 個月餵養參考，無需新增或修改成長規則。',
  },
};

function quoteForChunk(chunk: KnowledgeChunkInput): string {
  const candidates = [chunk.sourceExcerpt, chunk.originalText].filter((item): item is string => typeof item === 'string');
  for (const text of candidates) {
    const line = text.trim();
    if (line && [chunk.originalText, chunk.sourceExcerpt].some(field => field?.includes(line))) return line;
  }
  throw Error(`Local knowledge chunk ${chunk.key} lacks a verbatim quote`);
}

/**
 * Build and validate a reviewed assessment for a curated official seed source.
 */
export function buildLocalOfficialSeedAssessment(
  source: KnowledgeSourceInput,
  manifest?: { sourceId?: string; versionHash?: string; assessment?: unknown },
): KnowledgeReviewAssessment {
  if (manifest && source.sourceId === manifest.sourceId && sourceVersionHash(source) === manifest.versionHash) {
    return validateKnowledgeAssessment(manifest.assessment, source, null);
  }
  const template = SEED_REVIEW_TEMPLATES[source.sourceId];
  if (!template) throw Error(`Missing local review assessment template for ${source.sourceId}`);
  // These assessments apply only to the frozen editions whose meaning was reviewed.
  if (sourceVersionHash(source) !== template.reviewedVersionHash) {
    throw Error(`Local source ${source.sourceId} changed; a new meaning review is required`);
  }
  const assessment: KnowledgeReviewAssessment = {
    comparedVersionId: null,
    comparedHash: null,
    observationHash: null,
    changes: source.chunks.map(chunk => ({
      key: chunk.key,
      oldQuote: null,
      newQuote: quoteForChunk(chunk),
      meaning: 'new',
      explanation: template.chunkNotes[chunk.key] ?? `匯入 ${source.title} (${chunk.key}) 官方已核對內容。`,
    })),
    checks: template.checks,
    questions: template.questions,
    growthRuleImpact: template.growthRuleImpact,
    growthRuleReason: template.growthRuleReason,
    decision: 'approve',
  };
  return validateKnowledgeAssessment(assessment, source, null);
}

