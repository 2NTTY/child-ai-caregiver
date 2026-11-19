export const fileLink = /\.(?:pdf|docx?|png|jpe?g|webp)(?:$|[?#])/iu;
export const downloadLabel = /(?:\bdownload\b|下載|下载|附件|\bPDF\b|\bWord\b)/iu;
export const nextLabel = /^(?:下一頁|下一页|下頁|更多|next(?:\s+page)?|load more|show more|[›»→])\s*$/iu;
export const mutation = /(?:^|[^a-z])(?:logout|logoff|delete|remove|unsubscribe|checkout|purchase|submit|update|create|edit|cancel|confirm|pay|save|set|toggle|reset)(?:[^a-z]|$)|登出|刪除|付款|退訂|確認購買/iu;
export function classifyGate(notice, otp, captcha, password) {
  if (otp || /two.factor|one.time (?:code|password)|verification code|雙重驗證|一次性密碼/iu.test(notice)) return 'mfa';
  if (captcha || /captcha|人機驗證/iu.test(notice)) return 'captcha';
  if (/purchase (?:required|to (?:access|download))|subscribe to (?:read|access)|paywall|需(?:要)?購買|訂閱後.{0,8}(?:閱讀|下載)/iu.test(notice)) return 'purchase';
  if (password || /login required|sign in to (?:access|continue)|請先登入/iu.test(notice)) return 'login';
  return null;
}
