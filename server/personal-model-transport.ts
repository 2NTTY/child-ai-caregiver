import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { personalBaseUrlSchema } from '../src/shared/model-settings-schema.ts';
import { publicSourceAddress } from './public-source-transport.ts';
import { PersonalProviderError, personalProviderHttpError, providerConfigurationError } from './personal-provider-error.ts';

export type PersonalModelTransport = (baseUrl: string, key: string, payload: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
/** No redirects, second DNS lookup, ambient proxy credentials or hidden retries. */
export const postPersonalModel: PersonalModelTransport = async (baseUrl, key, payload, signal) => {
  const parsed = personalBaseUrlSchema.safeParse(baseUrl);
  if (!parsed.success) throw providerConfigurationError('model_endpoint_invalid');
  const url = new URL(parsed.data.endsWith('/chat/completions') ? parsed.data : parsed.data + '/chat/completions');
  try {
    signal.throwIfAborted();
    const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      void lookup(url.hostname, { all: true, family: 4 }).then(resolve, reject)
        .finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => !publicSourceAddress(item.address)))
      throw providerConfigurationError('model_endpoint_invalid');
    const bytes = Buffer.from(JSON.stringify(payload));
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(url, { method: 'POST', signal, agent: false, family: 4,
        lookup: (_host, _options, done) => done(null, addresses[0]!.address, 4),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json',
          'Accept-Encoding': 'identity', 'Content-Length': bytes.length } }, res => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.destroy(); reject(providerConfigurationError('model_endpoint_redirected')); return;
        }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') {
          res.destroy(); reject(providerConfigurationError('model_response_invalid')); return;
        }
        let size = 0; const chunks: Buffer[] = [];
        const maxBytes = status >= 400 ? 16384 : 2 * 1024 * 1024;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) res.destroy(providerConfigurationError('model_response_invalid'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error', reject); req.end(bytes);
    });
    if (response.status < 200 || response.status >= 300) throw personalProviderHttpError(response.status, response.body);
    try { return JSON.parse(response.body); } catch { throw providerConfigurationError('model_response_invalid'); }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof PersonalProviderError) throw error;
    throw providerConfigurationError('model_network_error');
  }
};
