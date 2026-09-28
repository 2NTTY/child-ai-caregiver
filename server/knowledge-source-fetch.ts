import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { SourceFetcher, SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import { parseSourceContent } from "./knowledge-source-parser.ts";

const denied = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],
  ["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(address, prefix);
export function publicSourceAddress(address: string): boolean { return isIP(address) === 4 && !denied.check(address); }

export function sourceFetchUrl(value: string, definition: SourceWatchDefinition): URL {
  const url = new URL(value), registered = new URL(definition.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || url.hostname !== registered.hostname || !["www.fhs.gov.hk","www.chp.gov.hk","news.rthk.hk","rthk.hk"].includes(url.hostname)) {
    throw new Error("source_url_rejected");
  }
  return url;
}

/** Public HTTPS only, pinned DNS address, bounded redirects/body/deadline, no cookies or retries. */
export const fetchKnowledgeSource: SourceFetcher = async (definition, outerSignal) => {
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(20000)]);
  try {
    let url = sourceFetchUrl(definition.url, definition);
    for (let redirects = 0; redirects <= 2; redirects++) {
      signal.throwIfAborted();
      // Prefer IPv4 deliberately; never fall back to unchecked IPv6 or a second DNS lookup.
      const addresses = await new Promise<{ address: string; family: number }[]>((resolve, reject) => {
        const abort = () => reject(new Error("source_request_aborted"));
        signal.addEventListener("abort", abort, { once: true });
        void lookup(url.hostname, { family: 4, all: true }).then(resolve, reject)
          .finally(() => signal.removeEventListener("abort", abort));
      });
      signal.throwIfAborted();
      if (!addresses.length || addresses.some(({ address }) => !publicSourceAddress(address))) return { status: "failed", reason: "response" };
      const address = addresses[0]!.address;
      const result = await new Promise<{ status: number; location?: string; contentType: string; body: Buffer }>((resolve, reject) => {
        const req = request(url, { method: "GET", signal, agent: false, family: 4,
          lookup: (_hostname, _options, done) => done(null, address, 4),
          headers: { Accept: definition.kind === "rss" ? "application/rss+xml, application/xml, text/xml" : "text/html",
            "Accept-Encoding": "identity", "User-Agent": "YubanHKSourceCheck/1.0" } }, response => {
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            response.destroy(); resolve({ status, location: response.headers.location, contentType: "", body: Buffer.alloc(0) }); return;
          }
          if (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity") {
            response.destroy(); reject(new Error("source_encoding_rejected")); return;
          }
          const chunks: Buffer[] = []; let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 1024 * 1024) response.destroy(new Error("source_body_too_large"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => resolve({ status, contentType: String(response.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        });
        req.on("error", reject); req.end();
      });
      if ([301,302,303,307,308].includes(result.status) && result.location && redirects < 2) {
        url = sourceFetchUrl(new URL(result.location, url).href, definition); continue;
      }
      if (result.status === 404 || result.status === 410) return { status: "unavailable", httpStatus: result.status };
      if (result.status !== 200 || !/^(text\/html|application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(result.contentType)) return { status: "failed", reason: "response" };
      try {
        const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(result.contentType)?.[1] ?? "utf-8";
        if (!["utf-8","utf8"].includes(charset.toLowerCase())) return { status: "failed", reason: "response" };
        return { status: "ok", items: parseSourceContent(definition, new TextDecoder("utf-8", { fatal: true }).decode(result.body)) };
      } catch { return { status: "failed", reason: "parse" }; }
    }
    return { status: "failed", reason: "response" };
  } catch { return { status: "failed", reason: signal.aborted ? "timeout" : "network" }; }
};
