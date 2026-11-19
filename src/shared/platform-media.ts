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
export const mediaCue = z.strictObject({ start: z.number().nonnegative(), end: z.number().positive(), text: z.string().trim().min(1).max(1600) })
  .refine(cue => cue.end > cue.start);
export const mediaClip = z.strictObject({ link: mediaUrlSchema, url: mediaUrlSchema, evidenceHash: z.string().regex(/^[0-9a-f]{64}$/u), ...mediaCue.shape })
  .refine(cue => cue.end > cue.start);
export const platformCardMedia = z.strictObject({ enabled: z.boolean(), revision: z.int().nonnegative(),
  links: z.array(mediaUrlSchema).max(128), clips: z.array(mediaClip).max(200).optional() });
export type PlatformCardMedia = z.infer<typeof platformCardMedia>;
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
