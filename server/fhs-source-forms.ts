import { load } from 'cheerio';
import { z } from 'zod';
import { platformMediaLink, platformMediaPage, youtubeVideoId, type PlatformMediaPage } from '../src/shared/platform-media.ts';
import { officialVideoPages } from './platform-materials.ts';
import type { fetchPublicSourceResponse } from './public-source-transport.ts';

export const officialScript = z.strictObject({ page: platformMediaPage,
  paragraphs: z.array(z.string().trim().min(1).max(3000)).min(1).max(512) })
  .refine(script => script.page.transcriptUrl === script.page.url + '#transcript');
export type OfficialScript = z.infer<typeof officialScript>;

/** Inspect publisher HTML only. Playback, captions and audio-description controls are separate resources. */
export function readOfficialMediaPage(url: string, body: string, linkedVideo?: string) {
  const $ = load(body);
  const headings = $('#content h2.title'), title = headings.text().replace(/\s+/gu, ' ').trim();
  if (headings.length !== 1 || !title) return null;
  const page = platformMediaPage.parse({ url, title });
  const block = $('#content #transcript');
  const players = new Set($('#content iframe[src],#content video[src],#content audio[src],#content source[src]').toArray()
    .map(el => platformMediaLink($(el).attr('src') ?? '', url)).filter(Boolean));
  if (linkedVideo && (players.size !== 1 || !players.has(linkedVideo))) return null;
  if (!players.size && $('#content a[href]').toArray().some(el => {
    const target = platformMediaLink($(el).attr('href') ?? '', url);
    return target && target !== url && target.endsWith('.html');
  })) return { page, directory: true };
  if (block.length !== 1 || players.size !== 1) return { page };
  const paragraphs = block.children('h4,p,ul,ol').not('#wcag-audio-toggle').toArray()
    .map(el => $(el).text().replace(/\s+/gu, ' ').trim()).filter(Boolean);
  if (!paragraphs.length) return { page };
  const script = officialScript.parse({ page: { ...page, transcriptUrl: url + '#transcript' }, paragraphs });
  return { page: script.page, script };
}

export async function readLinkedOfficialPages(links: readonly string[], transport: typeof fetchPublicSourceResponse, signal: AbortSignal) {
  const pages: PlatformMediaPage[] = [], scripts = new Map<string, OfficialScript>();
  const directories = new Set<string>();
  const bodies = new Map<string, string>();
  for (const link of links) {
    if (platformMediaLink(link) !== link) continue;
    const video = youtubeVideoId(new URL(link));
    const url = video ? officialVideoPages.get(video) : link;
    if (!url || !url.startsWith('https://www.fhs.gov.hk/') || !url.endsWith('.html')) continue;
    let body = bodies.get(url);
    if (body === undefined) {
      const fetched = await transport(url, value => {
        if (value !== url) throw Error('knowledge_media_url_invalid');
        return new URL(value);
      }, signal, 'text/html');
      if (fetched.status !== 'response') throw Error('knowledge_media_source_unavailable');
      if ([404, 410].includes(fetched.response.status)) continue;
      if (fetched.response.status !== 200 || (fetched.response.url ?? url) !== url || !/^text\/html(?:;|$)/iu.test(fetched.response.contentType))
        throw Error('knowledge_media_source_unavailable');
      body = new TextDecoder('utf-8', { fatal: true }).decode(fetched.response.body);
      bodies.set(url, body);
    }
    const read = readOfficialMediaPage(url, body, video ? link : undefined);
    if (read?.directory) { directories.add(link); continue; }
    if (read) pages.push({ ...read.page, url: link });
    if (read?.script) scripts.set(url, read.script);
  }
  return { links: links.filter(link => !directories.has(link)), pages, scripts: [...scripts.values()] };
}
