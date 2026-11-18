import { load } from 'cheerio';
import { knowledgeTokens } from './knowledge-ranking.ts';
import type { SourceWatchDefinition } from './knowledge-refresh-types.ts';
import { createKnowledgeSourceFetcher, sourceFetchUrl } from './knowledge-source-fetch.ts';
import { fetchPublicSourceResponse } from './public-source-transport.ts';

// The department publishes its service profiles under one directory and copyright notice.
// This lookup never registers a watch, imports a document or sends the personal query to the publisher.
export const healthServiceDirectory: SourceWatchDefinition = {
  id: 'dh-services', kind: 'page', classification: 'official_guidance', audience: 'public_noncommercial',
  url: 'https://www.dh.gov.hk/tc_chi/main/main.html', title: '主要服務範圍', publisher: '香港特別行政區政府衞生署',
  termsUrl: 'https://www.dh.gov.hk/tc_chi/notices/notices.html', selector: '#mainContent',
};

export function serviceProfile(id: string): SourceWatchDefinition | undefined {
  if (id === healthServiceDirectory.id) return healthServiceDirectory;
  const slug = /^dh-services-([a-z0-9]+(?:-[a-z0-9]+)*)$/u.exec(id)?.[1]?.replaceAll('-', '_');
  if (!slug || slug.length > 40) return undefined;
  return { ...healthServiceDirectory, id, url: new URL('main_' + slug + '/main_' + slug + '.html', healthServiceDirectory.url).href };
}

export function createServiceDirectory(transport = fetchPublicSourceResponse) {
  const exactTransport: typeof fetchPublicSourceResponse = (address, validate, signal, accept, options) =>
    transport(address, value => {
      const url = validate(value);
      if (url.href !== address) throw Error('live_source_locator_changed');
      return url;
    }, signal, accept, options);
  const read = createKnowledgeSourceFetcher({ transport: exactTransport });
  return { read, async discover(tokens: ReadonlySet<string>, signal: AbortSignal) {
    const directory = healthServiceDirectory;
    const result = await exactTransport(directory.url, url => sourceFetchUrl(url, directory), signal, 'text/html');
    if (result.status !== 'response' || result.response.status !== 200 || !/^text\/html(?:;|$)/iu.test(result.response.contentType))
      throw Error('live_source_directory_unavailable');
    const $ = load(new TextDecoder('utf-8', { fatal: true }).decode(result.response.body));
    const entries = $('#mainContent a[href]');
    if (!entries.length) throw Error('live_source_directory_unavailable');
    const hits = new Map<string, { profile: SourceWatchDefinition; score: number }>();
    for (const link of entries) {
      const href = $(link).attr('href');
      if (!href || !URL.canParse(href, directory.url)) continue;
      const url = new URL(href, directory.url);
      const slug = /^\/tc_chi\/main\/main_([a-z0-9_]+)\/main_\1\.html$/u.exec(url.pathname)?.[1];
      const profile = slug && serviceProfile('dh-services-' + slug.replaceAll('_', '-'));
      if (!profile || url.href !== profile.url) continue;
      const label = knowledgeTokens($(link).text().replace(/\s+/gu, ' '));
      const score = [...tokens].filter(token => label.has(token)).length;
      if (score && score > (hits.get(profile.id)?.score ?? 0)) hits.set(profile.id, { profile, score });
    }
    return [...hits.values()].sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id)).slice(0, 3).map(hit => hit.profile);
  } };
}
