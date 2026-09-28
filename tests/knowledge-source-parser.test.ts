import assert from "node:assert/strict";
import test from "node:test";
import { parseSourceContent } from "../server/knowledge-source-parser.ts";
import type { SourceWatchDefinition } from "../server/knowledge-refresh-types.ts";

const page: SourceWatchDefinition = {
  id: "synthetic-page", url: "https://source.example/guide", kind: "page", selector: "#content",
  classification: "official_guidance", publisher: "Synthetic publisher", termsUrl: "https://source.example/terms",
  audience: "public_noncommercial",
};
const rss: SourceWatchDefinition = { ...page, id: "synthetic-feed", url: "https://source.example/feed.xml",
  kind: "rss", classification: "recent_information", audience: "internal_noncommercial" };

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function feed(...items: string[]): string {
  return `<?xml version="1.0"?><rss version="2.0"><channel><title>Synthetic feed</title>${items.join("")}</channel></rss>`;
}

function entry(values: { title?: string; link?: string; description?: string; date?: string } = {}): string {
  const { title = "合成資料", link = "/items/a", description = "合成內容", date } = values;
  return `<item><title>${escapeXml(title)}</title><link>${escapeXml(link)}</link>`
    + `<description><![CDATA[${description}]]></description>`
    + (date === undefined ? "" : `<pubDate>${escapeXml(date)}</pubDate>`) + "</item>";
}

function assertInvalid(body: string, definition = page): void {
  assert.throws(() => parseSourceContent(definition, body), { name: "Error", message: "Invalid source content" });
}

test("page parsing keeps reviewed content boundaries and raw month precision", () => {
  const body = `<html><head><title>Other title</title></head><body><nav>外部導航</nav><div id="content">
    <h2>健康  指引</h2><div id="content-rev-date">(02/2026 修訂內容)</div>
    <p>第一段 <em>不改字句</em></p><p>第二段<br>下一行</p><ul><li>項目甲</li><li>項目乙</li></ul>
    <script>throw new Error("Do not execute")</script><style>hidden</style><nav>導航</nav>
    <footer>版權 2026</footer><iframe>框架</iframe><div id="qrcode-block-wrapper">QR</div>
    <div id="related-sections">其他資料</div><div id="print-version">列印</div></div></body></html>`;
  assert.deepEqual(parseSourceContent(page, body), [{ url: page.url, title: "健康 指引",
    text: "健康 指引 第一段 不改字句 第二段 下一行 項目甲 項目乙", sourcePublishedAt: null,
    sourceUpdatedAt: null, sourceDateText: "(02/2026 修訂內容)" }]);
});

test("whitespace and navigation changes leave page observations stable", () => {
  const content = "<div id='content'><h2>標題</h2><p>第一段</p><p>第二段</p><footer>copyright 2026</footer></div>";
  const changed = "<nav>新導航</nav>" + content.replaceAll("><", ">\n\t<").replace("copyright 2026", "copyright 2027")
    .replace("<h2>", "<nav><h2>導航標題</h2></nav><h2>");
  assert.deepEqual(parseSourceContent(page, content), parseSourceContent(page, changed));
  assert.equal(parseSourceContent(page, content)[0]!.sourceDateText, null);
});

test("missing, ambiguous, invalid or empty page selectors and titles fail with a fixed error", () => {
  assertInvalid("<div id='content'><h2>標題</h2></div>", { ...page, selector: undefined });
  assertInvalid("<main><h2>標題</h2></main>");
  assertInvalid("<div id='content'><h2>標題</h2></div>", { ...page, selector: "[" });
  assertInvalid("<div id='content'><h2>A</h2></div><div id='content'><h2>B</h2></div>");
  assertInvalid("<div id='content'><nav>導航</nav></div>");
  assertInvalid("<div id='content'><h2> </h2><p>內容</p></div>");
});

test("page field and input limits reject overflow without truncation", () => {
  const boundary = `<div id='content'><h2>T</h2><p>${"a".repeat(63_998)}</p></div>`;
  assert.equal(parseSourceContent(page, boundary)[0]!.text.length, 64_000);
  assertInvalid(boundary.replace("</p>", "a</p>"));
  assert.equal(parseSourceContent(page, `<div id='content'><h2>${"t".repeat(300)}</h2></div>`)[0]!.title.length, 300);
  assertInvalid(`<div id='content'><h2>${"t".repeat(301)}</h2></div>`);
  const date = `<div id='content'><h2>T</h2><div id='content-rev-date'>${"d".repeat(200)}</div></div>`;
  assert.equal(parseSourceContent(page, date)[0]!.sourceDateText!.length, 200);
  assertInvalid(date.replace("</div></div>", "d</div></div>"));
  const prefix = "<div id='content'><h2>T</h2></div><!--";
  const suffix = "-->";
  const input = prefix + "x".repeat(1024 * 1024 - prefix.length - suffix.length) + suffix;
  assert.equal(parseSourceContent(page, input)[0]!.text, "T");
  assertInvalid(input + " ");
});

test("RSS accepts reviewed relative links, strips fragments and keeps query strings", () => {
  const result = parseSourceContent(rss, feed(entry({ link: "/tc/features/a?source=feed&view=full#part",
    title: "資料甲", description: "<p>第一段</p><p>第二段<br>第三段</p><nav>導航</nav><script>code</script>",
    date: "Mon, 28 Sep 2026 18:26:08 +0800" })));
  assert.deepEqual(result, [{ url: "https://source.example/tc/features/a?source=feed&view=full", title: "資料甲",
    text: "第一段 第二段 第三段", sourcePublishedAt: "2026-09-28T10:26:08.000Z", sourceUpdatedAt: null,
    sourceDateText: "Mon, 28 Sep 2026 18:26:08 +0800" }]);
});

test("RSS empty descriptions use the supplied title and missing dates remain unknown", () => {
  for (const description of ["", "  ", "<script>code</script><style>hidden</style>"]) {
    const result = parseSourceContent(rss, feed(entry({ title: "原有標題", description })))[0]!;
    assert.equal(result.text, "原有標題");
    assert.equal(result.sourcePublishedAt, null);
    assert.equal(result.sourceUpdatedAt, null);
    assert.equal(result.sourceDateText, null);
  }
});

test("RSS ignores unsafe, credentialed, port-bearing and unreviewed links", () => {
  const links = ["javascript:alert(1)", "data:text/plain,bad", "https://user:password@source.example/a",
    "https://@source.example/a", "https://source.example:444/a", "https://source.example:443/a",
    "http://source.example:80/a", "//source.example:443/a", "https://other.example/a",
    "https:///source.example:443/a", "https:////source.example:443/a", "///source.example:443/a",
    "https://source.example.evil/a", "https://source.example/a\nb", "https:\\source.example\\a"];
  const result = parseSourceContent(rss, feed(entry(), ...links.map(link => entry({ link })),
    entry({ title: "" }), entry({ link: "" })));
  assert.equal(result.length, 1);
  assert.equal(result[0]!.url, "https://source.example/items/a");
  assertInvalid(feed(...links.map(link => entry({ link }))), rss);
});

test("RSS accepts only exact optional item hosts and normalizes HTTP to HTTPS", () => {
  const body = feed(entry(), entry({ link: "http://news.example/items/b#part" }));
  assert.equal(parseSourceContent(rss, body).length, 1);
  assert.deepEqual(parseSourceContent({ ...rss, itemHosts: ["SOURCE.EXAMPLE", "news.example"] }, body)
    .map(item => item.url), ["https://news.example/items/b", "https://source.example/items/a"]);
  assertInvalid(body, { ...rss, itemHosts: [] });
});

test("RSS ordering and equal duplicates produce identical observations", () => {
  const a = entry({ link: "/items/a", description: "<p>原文</p>" });
  const b = entry({ link: "/items/b", title: "另一標題", description: "另一原文" });
  const duplicate = entry({ link: "http://source.example/items/a#part", description: " <p>原文</p> " });
  assert.deepEqual(parseSourceContent(rss, feed(b, duplicate, a)), parseSourceContent(rss, feed(a, b)));
});

test("RSS conflicting observations for one normalized URL fail", () => {
  for (const changes of [{ title: "另一標題" }, { description: "不同正文" }, { date: "2026-09-28T12:00:00Z" }]) {
    assertInvalid(feed(entry(), entry(changes)), rss);
  }
});

test("RSS dates require complete valid calendar and timezone information", () => {
  const cases: [string, string | null][] = [
    ["Thu, 29 Feb 2024 12:34:56 GMT", "2024-02-29T12:34:56.000Z"],
    ["28 Sep 2026 18:26 +0800", "2026-09-28T10:26:00.000Z"],
    ["Mon, 28 Sep 2026 12:34:56 EST", "2026-09-28T17:34:56.000Z"],
    ["2026-09-28T12:34:56+08:00", "2026-09-28T04:34:56.000Z"],
    ["2026-09-28T12:34+0800", "2026-09-28T04:34:00.000Z"],
    ["2026-09-28T12:34:56.123456Z", "2026-09-28T12:34:56.123456Z"],
    ["2030-01-01T00:00:00Z", "2030-01-01T00:00:00.000Z"],
    ["2026-09", null], ["09/2026", null], ["2026-09-28", null], ["2026-09-28T12:34:56", null],
    ["Wed, 29 Feb 2023 12:34:56 GMT", null], ["Wed, 29 Feb 2024 12:34:56 GMT", null],
    ["2026-02-30T12:34:56Z", null], ["2026-09-28T24:00:00Z", null],
    ["2026-09-28T12:60:00Z", null], ["2026-09-28T12:34:60Z", null],
    ["2026-09-28T12:34:56+24:00", null], ["28 Sep 26 12:34:56 GMT", null],
    ["28 Sep 2026 12:34:56 HKT", null], ["28 Sep 2026 12:34:56", null],
  ];
  for (const [date, expected] of cases) {
    const result = parseSourceContent(rss, feed(entry({ date })))[0]!;
    assert.equal(result.sourcePublishedAt, expected, date);
    assert.equal(result.sourceDateText, date, date);
    assert.equal(result.sourceUpdatedAt, null);
  }
});

test("RSS rejects DTDs, entities and wrong document roots or channels", () => {
  for (const body of ["<!DOCTYPE rss SYSTEM 'https://other.example/rss.dtd'>" + feed(),
    "<!DOCTYPE rss [<!ENTITY payload 'unsafe'>]>" + feed(), "<!ENTITY payload 'unsafe'>" + feed(),
    "<feed><channel></channel></feed>", "<rss><other><channel></channel></other></rss>",
    "<rss><channel></channel><channel></channel></rss>", "<rss><channel></channel></rss><rss></rss>"]) {
    assertInvalid(body, rss);
  }
  assert.deepEqual(parseSourceContent(rss, feed()), []);
});

test("RSS parses only the first fifty items and fails if all considered items are invalid", () => {
  const items = Array.from({ length: 50 }, (_, index) => entry({ link: `/items/${index}` }));
  const result = parseSourceContent(rss, feed(...items, entry({ link: "/items/overflow", description: "a".repeat(4001) })));
  assert.equal(result.length, 50);
  assert.ok(result.every(item => item.url !== "https://source.example/items/overflow"));
  assertInvalid(feed(...items.map(() => entry({ link: "javascript:bad" })), entry()), rss);
});

test("RSS title, description, date and input overflow fail without silent truncation", () => {
  assert.equal(parseSourceContent(rss, feed(entry({ description: "a".repeat(4000) })))[0]!.text.length, 4000);
  assertInvalid(feed(entry({ description: "a".repeat(4001) })), rss);
  assert.equal(parseSourceContent(rss, feed(entry({ title: "t".repeat(300) })))[0]!.title.length, 300);
  assertInvalid(feed(entry({ title: "t".repeat(301) })), rss);
  assert.equal(parseSourceContent(rss, feed(entry({ date: "d".repeat(200) })))[0]!.sourceDateText!.length, 200);
  assertInvalid(feed(entry({ date: "d".repeat(201) })), rss);
  assertInvalid(feed(entry()) + " ".repeat(1024 * 1024), rss);
});
