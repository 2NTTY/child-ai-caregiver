import { z } from "zod";

// Ground truth recorded against the rendered physical page, not the PDF text layer.
// Acceptance evidence only. The runtime never imports this reference.
const fileHash = "3b0975745750c9c450e34797f3d3ab43dd37090be8d0ab3210936bdd7a405f0f";
export const fhsLayoutSample = {
  physicalPage: 6, contentHash: fileHash,
  question: "第 6 頁「Baby food DIY」表格的 Fruit 一行，左邊照片中的水果和工具是甚麼？兩張照片之間箭嘴是甚麼顏色，指向哪一邊？",
};
export const layoutFactsSchema = z.strictObject({
  fruit: z.string().min(1).max(80), tool: z.string().min(1).max(80),
  arrowColour: z.string().min(1).max(80), arrowDirection: z.string().min(1).max(80),
});
const answers = {
  fruit: ["蘋果", "半個蘋果", "apple", "half an apple"],
  tool: ["匙羹", "金屬匙羹", "湯匙", "金屬湯匙", "spoon", "metal spoon"],
  arrowColour: ["藍色", "藍", "blue"],
  arrowDirection: ["向右", "右", "右邊", "向右邊", "右方", "向右方", "由左向右", "從左向右", "指向右邊", "指向右方", "right", "rightward", "to the right"],
};
export function matchesFhsLayout(facts: unknown) {
  const parsed = layoutFactsSchema.safeParse(facts);
  return parsed.success && (Object.keys(answers) as (keyof typeof answers)[]).every(key =>
    answers[key].includes(parsed.data[key].normalize("NFKC").trim().toLowerCase()));
}
