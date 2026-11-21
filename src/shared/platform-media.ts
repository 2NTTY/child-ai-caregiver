import { z } from 'zod';

export function youtubeVideoId(url: URL) {
  const id = url.hostname === 'youtu.be' ? url.pathname.slice(1)
    : ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com'].includes(url.hostname)
      ? url.pathname === '/watch' ? url.searchParams.get('v') : /^\/(?:embed|shorts)\/([^/]+)$/u.exec(url.pathname)?.[1] : null;
  return id && /^[A-Za-z0-9_-]{11}$/u.test(id) ? id : null;
}
export function platformMediaLink(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null;
    const video = youtubeVideoId(url);
    if (video) return 'https://www.youtube.com/watch?v=' + video;
    if (url.hostname !== 'www.fhs.gov.hk' || !/^\/(?:tc_chi|sc_chi|english)\/mulit_med\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(?:html|mp4|mp3|m4a)$/iu.test(url.pathname)) return null;
    return url.origin + url.pathname;
  } catch { return null; }
}

export const mediaUrlSchema = z.string().max(2048).refine(url => platformMediaLink(url) === url);
const officialPage = mediaUrlSchema.refine(url => url.startsWith('https://www.fhs.gov.hk/') && url.endsWith('.html'));
const transcriptUrl = z.string().max(2048).refine(url => url.endsWith('#transcript') && officialPage.safeParse(url.slice(0, -'#transcript'.length)).success);
export const platformMediaPage = z.strictObject({ url: mediaUrlSchema, title: z.string().trim().min(1).max(300),
  transcriptUrl: transcriptUrl.optional() }).refine(page => !page.transcriptUrl || !page.url.endsWith('.html') || page.transcriptUrl === page.url + '#transcript');
export type PlatformMediaPage = z.infer<typeof platformMediaPage>;
export const scriptPassage = z.strictObject({ url: transcriptUrl, title: z.string().trim().min(1).max(300),
  firstParagraph: z.int().positive(), lastParagraph: z.int().positive() }).refine(p => p.firstParagraph <= p.lastParagraph);
export type ScriptPassage = z.infer<typeof scriptPassage>;
export const mediaCue = z.strictObject({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().trim().min(1).max(1600) })
  .refine(cue => cue.end > cue.start);
export const mediaClip = z.strictObject({ link: mediaUrlSchema, url: mediaUrlSchema, evidenceHash: z.string().regex(/^[0-9a-f]{64}$/u), ...mediaCue.shape })
  .refine(cue => cue.end > cue.start);
export const platformCardMedia = z.strictObject({ enabled: z.boolean(), revision: z.int().nonnegative(),
  links: z.array(mediaUrlSchema).max(128), clips: z.array(mediaClip).max(200).optional(), pages: z.array(platformMediaPage).max(128).optional()
}).refine(card => !card.pages || new Set(card.pages.map(p => p.url)).size === card.pages.length && card.pages.every(p => card.links.includes(p.url)));
export type PlatformCardMedia = z.infer<typeof platformCardMedia>;
export function mediaWithoutPages({ pages: _pages, ...prior }: PlatformCardMedia) { return prior; }
export type PlatformMediaClip = z.infer<typeof mediaClip>;
export type MediaCue = z.infer<typeof mediaCue>;
export function mediaTimestamp(seconds: number) {
  const s = Math.floor(seconds);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
export function mediaPlaybackUrl(raw: string, start: number) {
  const url = new URL(mediaUrlSchema.parse(raw));
  if (youtubeVideoId(url)) url.searchParams.set('t', String(Math.floor(start)));
  else url.hash = 't=' + Math.floor(start);
  return url.href;
}
