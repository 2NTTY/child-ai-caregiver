import type { SourceWatchDefinition } from "./knowledge-refresh-types.ts";

/** Reviewed noncommercial source scope. Adding a feed requires source/terms review, not a model URL. */
export const SOURCE_WATCHES: readonly SourceWatchDefinition[] = ([
  ["fhs-solid-food", "30039"], ["fhs-toddler-development", "15654"],
  ["fhs-preschool-development", "14821"], ["fhs-child-vision", "14812"],
].map(([id, page]) => ({ id: id!, url: `https://www.fhs.gov.hk/tc_chi/health_info/child/${page}.html`,
  kind: "page", classification: "official_guidance", publisher: "香港特別行政區政府衞生署家庭健康服務",
  termsUrl: "https://www.fhs.gov.hk/english/notice/notice.html", selector: "#content", audience: "public_noncommercial" })) as SourceWatchDefinition[]).concat([
  { id: "chp-recent", url: "https://www.chp.gov.hk/rss/pressreleases_zh_tw_RSS.xml", kind: "rss",
    classification: "recent_information", publisher: "香港特別行政區政府衞生署衞生防護中心",
    termsUrl: "https://www.chp.gov.hk/tc/static/24027.html", itemHosts: ["www.chp.gov.hk"], audience: "internal_noncommercial" },
  { id: "rthk-recent", url: "https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_clocal.xml", kind: "rss",
    classification: "recent_information", publisher: "香港電台", termsUrl: "https://www.rthk.hk/copyright/preview/index.html",
    itemHosts: ["news.rthk.hk"], audience: "internal_noncommercial" },
]);
