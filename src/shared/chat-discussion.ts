import { z } from 'zod';

export const discussionRoles = ['knowledge', 'parent', 'methods'] as const;
export type DiscussionRole = typeof discussionRoles[number];
export const discussionLabels: Record<DiscussionRole, string> = {
  knowledge: '育兒知識與經驗', parent: '新手家長', methods: '不同育兒方法',
};
export const discussionTranscriptSchema = z.array(z.object({
  role: z.enum(discussionRoles), text: z.string().trim().min(1).max(2400),
}).strict()).max(discussionRoles.length).refine(turns => turns.every((turn, i) => turn.role === discussionRoles[i]));
export type DiscussionTranscript = z.infer<typeof discussionTranscriptSchema>;
