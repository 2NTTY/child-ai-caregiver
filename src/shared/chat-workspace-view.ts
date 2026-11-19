/** This marker keeps account-wide names out of a single child's saved transcript. */
export const CHILD_PROFILES_CHAT_TEXT = '可在「子女檔案」查看目前帳戶的孩子名單。';

/** Single-child history stores this pointer. The signed-in owner reads the reviewed account answer from its run. */
export const ACCOUNT_DIRECTORY_ANSWER = '這則回覆使用了你的帳戶名單。';

const directoryRequests = [
  /^(?:我|我(?:的|嘅)?(?:帳戶|帳號|賬戶|賬號|家庭)(?:裏|裡|內|中|入面)?)(?:有|登記(?:了|咗)?|包括)(?:哪些|哪幾(?:個|位)|什麼|甚麼|什么|邊幾(?:個|位)|咩)(?:小孩|孩子|子女|小朋友)$/u,
  /^(?:列出|列一列|顯示|查看|看看|打開|睇下)?(?:我(?:的|嘅)?)?(?:孩子|子女|小孩|小朋友)(?:的|嘅)?名單$/u,
  /^(?:(?:list|show)(?: me)? my (?:children|kids)|which (?:children|kids) (?:are on my account|do i have))$/iu,
];

// Only for old release receipts. This is never used to choose the agent's tools.
export function matchesLegacyDirectoryQuestion(message: string | undefined): boolean {
  const text = message?.normalize('NFKC').trim().replace(/[。.!！?？]+$/u, '').trim();
  if (!text) return false;
  const request = text.replace(/^(?:請問|請|麻煩你|麻煩)(?:你)?\s*/u, '');
  return directoryRequests.some(pattern => pattern.test(request));
}
