import type { SourceFetcher,SourceWatchDefinition } from "./knowledge-refresh-types.ts";
import { parseSourceContent } from "./knowledge-source-parser.ts";
import { fetchPublicSourceResponse } from "./public-source-transport.ts";
export { publicSourceAddress } from "./public-source-transport.ts";

export function sourceFetchUrl(value: string, definition: SourceWatchDefinition): URL {
  const url = new URL(value), registered = new URL(definition.url);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash
    || url.hostname !== registered.hostname || !["www.fhs.gov.hk","www.chp.gov.hk","news.rthk.hk","rthk9.rthk.hk"].includes(url.hostname)) {
    throw new Error("source_url_rejected");
  }
  return url;
}

export const fetchKnowledgeSource:SourceFetcher=async(definition,signal)=>{
  const fetched=await fetchPublicSourceResponse(definition.url,value=>sourceFetchUrl(value,definition),signal,
    definition.kind==="rss"?"application/rss+xml, application/xml, text/xml":"text/html");
  if(fetched.status!=="response")return fetched;
  const result=fetched.response;
  if(result.status===404||result.status===410)return {status:"unavailable",httpStatus:result.status};
  if(result.status!==200||!/^(text\/html|application\/(?:rss\+)?xml|text\/xml)(?:;|$)/i.test(result.contentType))return {status:"failed",reason:"response"};
  try{
    const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(result.contentType)?.[1]??"utf-8";
    if(!["utf-8","utf8"].includes(charset.toLowerCase()))return {status:"failed",reason:"response"};
    return {status:"ok",items:parseSourceContent(definition,new TextDecoder("utf-8",{fatal:true}).decode(result.body))};
  }catch{return {status:"failed",reason:"parse"};}
};
