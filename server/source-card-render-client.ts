import { request } from 'node:http';
import { z } from 'zod';

export interface RenderResource { url: string; mime: string; body: string }
export interface RenderInput { url: string; resources: RenderResource[] }
const locators = z.array(z.string().max(3000)).max(64);
const renderResult = z.object({ links: locators, assets: locators,
  gate: z.enum(['login','captcha','mfa','purchase']).nullable(), limited: z.boolean(), unresolved: z.boolean() }).strict();
export type RenderResult = z.infer<typeof renderResult>;

/** The renderer has no network interface. Only the worker can obtain remote bytes. */
export async function renderSourceCard(input: RenderInput, signal: AbortSignal): Promise<RenderResult> {
  const body = Buffer.from(JSON.stringify(input));
  if (body.length > 6 * 1024 * 1024) throw Error('limit');
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: '/run/source-browser/render.sock', path: '/render', method: 'POST', signal,
      headers: { 'content-type':'application/json', 'content-length':body.length } }, response => {
      const chunks: Buffer[] = [];
      let size = 0;
      response.on('error', reject);
      response.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) response.destroy(Error('limit'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw Error('unavailable');
          resolve(renderResult.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
        } catch { reject(Error('unavailable')); }
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}
