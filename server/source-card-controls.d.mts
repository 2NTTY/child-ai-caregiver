export const fileLink: RegExp, downloadLabel: RegExp, nextLabel: RegExp, mutation: RegExp;
export function classifyGate(notice: string, otp: boolean, captcha: boolean, password: boolean): 'login' | 'mfa' | 'captcha' | 'purchase' | null;
