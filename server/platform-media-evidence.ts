import { load } from 'cheerio';
import { z } from 'zod';
import { mediaCue, platformMediaLink, youtubeVideoId, type MediaCue } from '../src/shared/platform-media.ts';
import { officialVideoPages, knownVideoDurations } from './platform-materials.ts';
import { fetchPublicSourceResponse } from './public-source-transport.ts';
import { knowledgeHash } from './knowledge-inputs.ts';

const cues = z.array(mediaCue).min(1).max(200);
function time(raw: string) {
  if (!/^(?:\d{2,}:)?[0-5]\d:[0-5]\d[.]\d{3}$/u.test(raw)) return NaN;
  return raw.split(':').reduce((n, part) => n * 60 + Number(part), 0);
}
export function readWebVtt(body: string): MediaCue[] {
  const blocks = body.replace(/^\uFEFF/u, '').trim().split(/\r?\n\s*\r?\n/u);
  if (!/^WEBVTT(?:\s|$)/u.test(blocks.shift() ?? '')) throw Error('knowledge_media_caption_invalid');
  return cues.parse(blocks.filter(block => !/^(?:NOTE|STYLE|REGION)(?:\s|$)/u.test(block)).map(block => {
    const lines = block.split(/\r?\n/u);
    if (!lines[0]?.includes('-->')) lines.shift();
    const match = /^(\S+) --> (\S+)(?:\s.*)?$/u.exec(lines.shift() ?? '');
    if (!match) throw Error('knowledge_media_caption_invalid');
    return { start: time(match[1]!), end: time(match[2]!), text: load(lines.join(' '), null, false).text().trim() };
  }));
}
export interface MediaOriginal { url: string; hash: string; transcript: string; captions: MediaCue[]; duration?: number }

export async function loadMediaOriginals(link: string, signal: AbortSignal, fetcher = fetchPublicSourceResponse): Promise<MediaOriginal[]> {
  const canonical = platformMediaLink(link);
  if (!canonical) throw Error('knowledge_media_url_invalid');
  const id = youtubeVideoId(new URL(canonical)), page = id ? officialVideoPages.get(id) : canonical;
  let transcript = '', captions: MediaCue[] = [], streams = [canonical];
  async function exact(url: string, accept: string) {
    const result = await fetcher(url, value => {
      if (value !== url || new URL(value).origin !== 'https://www.fhs.gov.hk') throw Error('knowledge_media_url_invalid');
      return new URL(value);
    }, signal, accept);
    if (result.status !== 'response' || result.response.status !== 200) throw Error('knowledge_media_source_unavailable');
    return new TextDecoder('utf-8', { fatal: true }).decode(result.response.body);
  }
  if (page && page.endsWith('.html')) {
    const html = load(await exact(page, 'text/html'));
    transcript = html('#transcript').text().replace(/\s+/gu, ' ').trim();
    if (transcript.length > 64000) throw Error('knowledge_media_transcript_too_large');
    streams = [...new Set(html('iframe[src],video[src],audio[src],source[src]').toArray()
      .map(el => platformMediaLink(html(el).attr('src') ?? '', page)).filter((s): s is string => !!s && !s.endsWith('.html')))];
    if (id) streams = streams.filter(url => youtubeVideoId(new URL(url)) === id);
    if (!streams.length) throw Error('knowledge_media_source_unavailable');
    if (streams.length === 1) {
      const tracks = html('track[src]').toArray().filter(el => ['captions','subtitles'].includes(html(el).attr('kind') ?? 'subtitles'));
      const track = tracks.find(el => /^zh/iu.test(html(el).attr('srclang') ?? '')) ?? tracks[0];
      if (track) {
        const url = new URL(html(track).attr('src')!, page);
        if (url.origin === 'https://www.fhs.gov.hk' && url.pathname.endsWith('.vtt')) captions = readWebVtt(await exact(url.href, 'text/vtt'));
      }
    } else transcript = '';
  }
  return streams.map(url => {
    const video = youtubeVideoId(new URL(url)), duration = video ? knownVideoDurations[video] : undefined;
    return { url, hash: knowledgeHash(['public-media/1', url, captions, transcript]), captions, transcript, ...(duration ? { duration } : {}) };
  });
}
