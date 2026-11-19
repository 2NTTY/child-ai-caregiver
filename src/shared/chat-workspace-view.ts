/** This marker keeps account-wide names out of a single child's saved transcript. */
export const CHILD_PROFILES_CHAT_TEXT = '可在「子女檔案」查看目前帳戶的孩子名單。';

export type ChatWorkspaceView = 'child_profiles' | 'conversation_memory';

const directoryRequests = [
  /^(?:我|我(?:的|嘅)?(?:帳戶|帳號|賬戶|賬號|家庭)(?:裏|裡|內|中|入面)?)(?:有|登記(?:了|咗)?|包括)(?:哪些|哪幾(?:個|位)|什麼|甚麼|什么|邊幾(?:個|位)|咩)(?:小孩|孩子|子女|小朋友)$/u,
  /^(?:列出|列一列|顯示|查看|看看|打開|睇下)?(?:我(?:的|嘅)?)?(?:孩子|子女|小孩|小朋友)(?:的|嘅)?名單$/u,
  /^(?:(?:list|show)(?: me)? my (?:children|kids)|which (?:children|kids) (?:are on my account|do i have))$/iu,
];

const conversationRequests = [
  /^(?:(?:你(?:能不能|可以|可否)?|幫我)?(?:檢查(?:看看)?|查看|看看|核對)?)(?:助手的?|你的?)?短期(?:對話)?(?:記憶|脈絡)(?:有(?:什麼|甚麼|咩)問題)?$/u,
  /^(?:你|助手)(?:現在|目前)?(?:能|可以|睇到|看得到|看到)(?:看到|讀到)?(?:多少|幾多)(?:則|條)?(?:對話|訊息)$/u,
];

// This qualifies optional fixed UI answers only. Free-form questions use normal agent tools.
export function requestedWorkspaceView(message: string | undefined): ChatWorkspaceView | null {
  const text = message?.normalize('NFKC').trim().replace(/[。.!！?？]+$/u, '').trim();
  if (!text) return null;
  const request = text.replace(/^(?:請問|請|麻煩你|麻煩)(?:你)?\s*/u, '');
  if (directoryRequests.some(pattern => pattern.test(request))) return 'child_profiles';
  if (conversationRequests.some(pattern => pattern.test(request))) return 'conversation_memory';
  return null;
}
