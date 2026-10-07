import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const denied = new BlockList();
for (const [address, prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
  ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],
  ["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) denied.addSubnet(address, prefix);
export function publicSourceAddress(address: string): boolean { return isIP(address) === 4 && !denied.check(address); }

type SourceResponse = {status:number;location?:string;contentType:string;body:Buffer};
type SourceResult = {status:"response";response:SourceResponse}|{status:"failed";reason:"network"|"timeout"|"response"};
/** Shared public-network transport; callers must provide their own URL-scope validator. */
export async function fetchPublicSourceResponse(initialUrl:string,validate:(value:string)=>URL,outerSignal:AbortSignal,accept:string,options:{maxBytes?:number}={}):Promise<SourceResult>{
  const maxBytes=options.maxBytes??1024*1024;
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>32*1024*1024)throw new Error("source_max_bytes_invalid");
  const signal = AbortSignal.any([outerSignal, AbortSignal.timeout(20000)]);
  try {
    let url = validate(initialUrl);
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
          headers: { Accept: accept,
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
            if (bytes > maxBytes) response.destroy(new Error("source_body_too_large"));
            else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => resolve({ status, contentType: String(response.headers["content-type"] ?? ""), body: Buffer.concat(chunks) }));
        });
        req.on("error", reject); req.end();
      });
      if ([301,302,303,307,308].includes(result.status) && result.location && redirects < 2) {
        url = validate(new URL(result.location, url).href); continue;
      }
      return {status:"response",response:result};
    }
    return {status:"failed",reason:"response"};
  }catch{return {status:"failed",reason:signal.aborted?"timeout":"network"};}
}
