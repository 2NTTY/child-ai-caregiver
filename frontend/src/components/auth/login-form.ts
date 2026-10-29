import { z } from "zod";

export type LoginMode = "signIn" | "signUp";
export type LoginFormValues = { name: string; email: string; password: string };
const email = z.string().refine(value => /^\S+@\S+\.\S+$/.test(value.trim()), "請輸入有效電郵地址。");
const password = z.string().max(128, "密碼最多 128 個字元。");
/** UI validation keeps the existing auth contract; credentials are not normalised here. */
export const loginFormSchemas = {
  signIn: z.object({ name: z.string(), email, password: password.min(1, "請輸入密碼。") }),
  signUp: z.object({ name: z.string().refine(value => !!value.trim(), "請填寫稱呼。"), email, password: password.min(12, "建立帳戶需要至少 12 個字元的密碼。") }),
};
