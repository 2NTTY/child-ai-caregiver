import { load } from "cheerio";
import { fetchPublicSourceResponse } from "./public-source-transport.ts";
import type { ObservedContent } from "./knowledge-refresh-types.ts";

export function personalSourceUrl(value:string,original:string):URL {
  const url=new URL(value),first=new URL(original);
  if(url.protocol!=="https:"||url.username||url.password||url.port||url.hostname!==first.hostname)
    throw new Error("personal_source_url_rejected");
  url.hash="";
  return url;
}
export function parsePersonalPage(body:string,url:string):ObservedContent {
  if(body.length>1024*1024)throw new Error("personal_source_too_large");
  const $=load(body);
  const title=$("title").first().text().trim()||$("h1").first().text().trim()||new URL(url).hostname;
  $("script,style,nav,header,footer,form,input,button,iframe,noscript,[hidden],[aria-hidden='true']").remove();
  const section=$("main").length===1?$("main"):$("article").length===1?$("article"):$("body");
  section.find("br,hr").replaceWith("\n");
  section.find("h1,h2,h3,h4,p,li,div,section,article,blockquote,pre,tr,td,dt,dd").each((_,node)=>{$(node).prepend("\n").append("\n");});
  const text=section.text().replace(/[ \t]+/gu," ").replace(/\n[ \t]*/gu,"\n").replace(/\n{3,}/gu,"\n\n").trim();
  if(!text||text.length>64000||title.length>300)throw new Error("personal_source_unreadable");
  return {url,title,text,sourcePublishedAt:null,sourceUpdatedAt:null,sourceDateText:null};
}
/** Explicit one-off owner request. No login session, script execution, retries or knowledge publication. */
export async function fetchPersonalPage(url:string,signal:AbortSignal):Promise<ObservedContent|null>{
  const fetched=await fetchPublicSourceResponse(url,value=>personalSourceUrl(value,url),signal,"text/html");
  if(fetched.status!=="response"||fetched.response.status!==200)return null;
  const {contentType,body}=fetched.response;
  if(!/^text\/html(?:;|$)/i.test(contentType))return null;
  const charset=/charset\s*=\s*["']?([^;\s"']+)/i.exec(contentType)?.[1]??"utf-8";
  if(!["utf-8","utf8"].includes(charset.toLowerCase()))return null;
  try{return parsePersonalPage(new TextDecoder("utf-8",{fatal:true}).decode(body),url);}catch{return null;}
}
