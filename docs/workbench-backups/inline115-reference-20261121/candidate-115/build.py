"""Build a local, append-only workbench candidate from the exact v116 static artifact."""
import argparse
import base64
import hashlib
import html
import io
import json
from pathlib import Path
import re
import struct
import tempfile
from urllib.parse import urlsplit

from PIL import Image

HERE = Path(__file__).resolve().parent
COVERAGE = HERE.parent
BASE = COVERAGE.parent / "workbench-inline-pilot-20261121" / "candidate-109" / "out"
BASE_HTML = "9a31627236474209fabdaf9008305eeafe7a25e776610abfa00db1ed83c8de88"
MANIFEST = HERE / "manifest.json"
SCRIPT_RE = re.compile(r"<script>(.*?)</script>", re.S)
STYLE_RE = re.compile(r"<style>(.*?)</style>", re.S)
RECORDS_RE = re.compile(r'<script id="records" type="application/json">(.*?)</script>', re.S)
ART_RE = re.compile(r"^const artwork=(\{[^\r\n]+\});$", re.M)
CSP_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">')
IMAGE_PATH = re.compile(r"\./visuals/([a-f0-9]{64})\.(png|webp)")
SAFE_NEW_GIT = re.compile(r"/(?:classroomio/classroomio|frappe/lms|immich-app/immich|nextcloud/(?:server|documentation)|inveniosoftware/invenio-app-rdm)/blob/[0-9a-f]{40}/[^\s]+")
SAFE_NOTICE = re.compile(r"[ \t]+(?=\r?$)", re.M)
ASSET_ROOTS = ("draft-teachers", "draft-attachments", "draft-archive")
EXPECTED = (56, 115, 115)
BASE_COUNTS = (53,109,109)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical(data):
    return json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", r"\u003c")


def plain_json(data):
    return (json.dumps(data, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def object_once(pairs):
    value = {}
    for key, item in pairs:
        require(key not in value, "ambiguous duplicate JSON field: " + key)
        value[key] = item
    return value


def read_json(text):
    return json.loads(text, object_pairs_hook=object_once)


def match_one(regex, text):
    result = list(regex.finditer(text))
    require(len(result) == 1, "expected one match for " + regex.pattern)
    return result[0]


def replace_one(text, old, new):
    require(text.count(old) == 1, "expected one unique append token")
    return text.replace(old, new, 1)


def amend_span(text, match, body):
    return text[:match.start(1)] + body + text[match.end(1):]


def policy(script, style):
    def tag(s):
        return "'sha256-" + base64.b64encode(hashlib.sha256(s.encode("utf-8")).digest()).decode("ascii") + "'"
    return html.escape(
        f"default-src 'none'; script-src {tag(script)}; style-src {tag(style)}; "
        "img-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; "
        "frame-src 'none'; base-uri 'none'; form-action 'none'", quote=True
    )


def safe_asset_origin(value):
    item = Path(value)
    require(len(item.parts) == 2 and not item.is_absolute() and item.parts[0] in ASSET_ROOTS, "invalid local draft path")
    origin = COVERAGE / item
    require(not origin.is_symlink() and not origin.parent.is_symlink() and origin.resolve(strict=True) == origin,
            f"symlink or non-normalized path: {item}")
    require(origin.is_file(), f"missing authorized input: {item}")
    return origin.read_bytes()


def old_assets(old_map):
    found = {}
    paths = []
    for name, item in old_map.items():
        loc = IMAGE_PATH.fullmatch(item["src"])
        require(loc is not None, "unexpected v116 image path for " + name)
        filename = item["src"].split("/")[-1]
        b = BASE / "visuals" / filename
        require(filename not in found and not b.is_symlink() and b.is_file(), "duplicate or missing v116 asset " + filename)
        data = b.read_bytes()
        require(sha(data) == loc[1], "v116 content address mismatch: " + filename)
        found[filename] = data
        paths.append(filename)
    require(set(paths) == {v.name for v in (BASE/"visuals").iterdir()}, "v116 physical image inventory differs from artwork")
    return found


def new_png(asset):
    require(set(asset) == {"input","sha256","dimensions","alt","previewLabel","credit"}, "unexpected new asset schema")
    origin = Path(asset["input"])
    require(origin.suffix == ".png", "only approved new static PNG")
    b = safe_asset_origin(asset["input"])
    require(0 < len(b) < 2_000_000 and sha(b) == asset["sha256"], f"bad draft digest: {origin}")
    require(b[:8] == b"\x89PNG\r\n\x1a\n", f"bad PNG signature: {origin}")
    pos = 8
    chunks = []
    while pos < len(b):
        require(pos+12 <= len(b), f"bad PNG chunk envelope: {origin}")
        length, chunk = struct.unpack_from(">I4s", b, pos)
        require(pos+length+12 <= len(b), f"bad PNG chunk length: {origin}")
        chunks.append(chunk)
        pos += length + 12
    require(chunks == [b"IHDR"] + [b"IDAT"]*(len(chunks)-2) + [b"IEND"] and len(chunks) >= 3,
            f"new PNG includes non-image metadata or trailing data: {origin}")
    require(isinstance(asset["alt"],str) and asset["alt"] and "非官方" in asset["credit"] and "非官方" in asset["previewLabel"],
            "new asset missing alternative text or nonofficial notice")
    with Image.open(io.BytesIO(b), formats=["PNG"]) as raster:
        require(raster.mode == "RGB" and tuple(asset["dimensions"]) == raster.size and not raster.info
                and getattr(raster, "n_frames", 1) == 1, f"unexpected raster shape: {origin}")
        raster.verify()
    with Image.open(io.BytesIO(b), formats=["PNG"]) as raster:
        raster.load()
    return b


def check_new_link(link):
    require(set(link) == {"label","url"} and isinstance(link["label"],str) and link["label"], "unexpected link schema")
    s = urlsplit(link["url"])
    require(s.scheme == "https" and not s.username and not s.password and s.port is None, "unsafe new source URL")
    require(not re.search(r"[<>'\"\\\s]",link["url"]), "unsafe characters in new source URL")
    ok = (s.netloc == "github.com" and bool(SAFE_NEW_GIT.fullmatch(s.path))
          and not s.query and (not s.fragment or bool(re.fullmatch(r"L\d+(?:-L\d+)?",s.fragment))))
    ok |= (s.netloc == "www.bea.gov" and not s.fragment
           and (link["url"] == "https://www.bea.gov/news/archive?created_1=All&field_related_product_target_id=456&title="
                or bool(re.fullmatch(r"https://www\.bea\.gov/sites/default/files/2025-(?:07/gdp2q25-adv|08/gdp2q25-2nd|09/gdp2q25-3rd)\.pdf",link["url"]))))
    require(ok, "new source link outside committed references: " + link["url"])


def binding(record):
    return record["name"] + "\n" + record["links"][0]["url"]


def escape_notice(s):
    return SAFE_NOTICE.sub(lambda m: "".join("&#32;" if c==" " else "&#9;" for c in m[0]), html.escape(s))


def assemble():
    b = (BASE / "index.html").read_bytes()
    manifest_raw = MANIFEST.read_bytes()
    m = read_json(manifest_raw)
    base = m["base"]
    require(m["schema"] == 1 and m["candidate"] == "local-candidate-115-image-count", "unexpected manifest schema/identity")
    require(base["siteVersion"] == 116 and base["htmlSha256"] == BASE_HTML == sha(b), "exact v116 HTML mismatch")
    page = b.decode("utf-8")
    record_match = match_one(RECORDS_RE,page)
    script_match = match_one(SCRIPT_RE,page)
    style_match = match_one(STYLE_RE,page)
    csp_match = match_one(CSP_RE,page)
    old_script,style = script_match[1],style_match[1]
    require(csp_match[1] == policy(old_script,style), "v116 CSP does not match scoped hashes")
    art_match = match_one(ART_RE,old_script)
    olds = (record_match[1],art_match[1])
    require(sha(olds[0].encode()) == base["rawRecordsSha256"] and sha(olds[1].encode()) == base["rawArtworkSha256"],
            "v116 exact records or binding payload mismatch")
    old_records,old_map = map(read_json,olds)
    counts = (len(old_records),sum(len(x["choices"]) for x in old_records),len(old_map))
    require(counts == BASE_COUNTS == (base["topics"],base["choices"],base["images"]), "v116 entry counts changed")
    old_keys = [binding(c) for x in old_records for c in x["choices"]]
    require(set(old_keys) == set(old_map) and len(set(old_keys)) == len(old_keys), "v116 card/image bindings mismatch")
    assets = old_assets(old_map)
    old_receipt = {name:sha(data) for name,data in sorted(assets.items())}
    new_records,new_map = [],{}
    require([x["number"] for x in m["topics"]] == [54,55,56], "append order wrong")
    for i,t in enumerate(m["topics"]):
        require(len(t["choices"]) == 2 and isinstance(t["title"],str) and t["title"], "invalid new topic")
        choices = []
        for e in t["choices"]:
            require(set(e) == {"name","note","links","asset"} and e["name"] and e["note"] and e["links"], "invalid new card")
            require(len({l["url"] for l in e["links"]}) == len(e["links"]), "repeated source link within card")
            for link in e["links"]:
                check_new_link(link)
            choices.append({k:e[k] for k in ("name","note","links")})
            asset = e["asset"]
            require(Path(asset["input"]).parts[0] == ASSET_ROOTS[i], "topic refers to the wrong independently reviewed pair")
            data = new_png(asset)
            filename = asset["sha256"]+".png"
            key = binding(e)
            require(filename not in assets and key not in old_map and key not in new_map, "duplicated asset or record")
            new_map[key] = dict(src="./visuals/"+filename,alt=asset["alt"],credit=asset["credit"],
                                original=None,replacement=None,previewLabel=asset["previewLabel"])
            assets[filename] = data
        new_records.append({"title":t["title"],"choices":choices})

    counts = (len(old_records)+len(new_records),len(old_keys)+len(new_map),len(assets))
    require(counts==EXPECTED, "local candidate counts wrong")
    require(olds[0].endswith("]") and olds[1].endswith("}"), "expected compact append format")
    records = olds[0][:-1]+","+canonical(new_records)[1:]
    art = olds[1][:-1]+","+canonical(new_map)[1:]
    require(read_json(records)[:53] == old_records and list(read_json(art).items())[:109] == list(old_map.items()),
            "v116 records or bindings unexpectedly modified")
    script = amend_span(old_script,art_match,art)
    # The old handler is already dynamically bound to data.length. Do not change
    # its code, the selector IDs, keyboard/focus handlers, or any old UI runtime.
    require('by(\'latest\').addEventListener(\'click\',()=>detail(data.length-1))' in old_script,
            "unexpected base shortcut implementation")
    require(amend_span(script,match_one(ART_RE,script),olds[1]) == old_script, "base executable behavior changed")

    result = replace_one(page,"<script>"+old_script+"</script>","<script>"+script+"</script>")
    result = replace_one(result,record_match[0],'<script id="records" type="application/json">'+records+'</script>')
    result = replace_one(result,csp_match[0],'<meta http-equiv="Content-Security-Policy" content="'+policy(script,style)+'">')
    result = replace_one(result,'aria-label="共 53 個主題，109 個方案"><div><b>53</b>主題</div><div><b>109</b>方案</div>',
                         'aria-label="共 56 個主題，115 個方案"><div><b>56</b>主題</div><div><b>115</b>方案</div>')
    result = replace_one(result,'<button id="latest" type="button">直達第 53 題</button>',
                         '<button id="latest" type="button">直達第 56 題</button>')
    notices=[]
    for i,notice in enumerate(m["notices"],54):
        require(notice["heading"].startswith(f"第 {i} 題"), "append notices do not match the order of topics")
        if "input" in notice:
            raw=safe_asset_origin(notice["input"])
            require(sha(raw)==notice["sha256"],"approved draft declaration changed")
            content=raw.decode("utf-8")
        else:
            content=notice["text"]
        require(content.strip() and "非官方" in content, "nonofficial asset notice missing")
        notices.append(f'<h3>{html.escape(notice["heading"])}</h3><pre>{escape_notice(content)}</pre>')
    require(len(notices)==3,"expected three notices")
    result = replace_one(result,"</pre></details></footer>","</pre>"+"".join(notices)+"</details></footer>")
    require(match_one(STYLE_RE,result)[1] == style, "base style changed")
    require(match_one(CSP_RE,result)[1] == policy(match_one(SCRIPT_RE,result)[1],style), "new CSP hash mismatch")
    require(not re.search(r"data:image/|<script\s+src|<img[^>]+src=",result,re.I), "unexpected injected asset shape")
    receipt = {
        "state":"LOCAL_NOT_RELEASED",
        "candidate":m["candidate"],
        "baseHtmlSha256":sha(b),
        "manifestSha256":sha(manifest_raw),
        "topicCount":counts[0],"choiceCount":counts[1],"imageCount":counts[2],
        "oldTopicsUnchanged":len(old_records),"oldBindingsUnchanged":len(old_map),"oldImagesUnchanged":len(old_receipt),
        "preservedCspStyleHashSourceSha256":sha(style.encode()),
        "newScriptSha256":sha(script.encode()),
        "htmlSha256":sha(result.encode("utf-8")),
        "newAssetKeys":[{"key":k,"src":v["src"]} for k,v in new_map.items()],
        "files":{name:{"sha256":sha(data),"bytes":len(data)} for name,data in sorted(assets.items())},
    }
    return result.encode("utf-8"),assets,plain_json(receipt)


def verify(output, page, assets):
    require(output.is_dir() and not output.is_symlink(), "output directory missing or redirected")
    require({v.name for v in output.iterdir()} == {"index.html","visuals"}, "extra public output files")
    require(not (output/"index.html").is_symlink() and (output/"index.html").read_bytes() == page,"candidate HTML differs from rebuild")
    v = output/"visuals"
    require(not v.is_symlink() and {f.name for f in v.iterdir()} == set(assets),"unexpected output image inventory")
    for f in v.iterdir():
        require(not f.is_symlink() and f.is_file() and f.read_bytes() == assets[f.name],"output asset differs: "+f.name)


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--check",action="store_true",help="verify existing output by read-only deterministic regeneration")
    p.add_argument("--output-dir",default="out",help="simple sibling directory name inside this candidate")
    args=p.parse_args()
    require(bool(re.fullmatch(r"(?:out|verify-[a-z0-9-]+)",args.output_dir)),"output must be out or verify-*")
    target=HERE/args.output_dir
    receipt_path=HERE/("build-receipt.json" if args.output_dir=="out" else args.output_dir+"-receipt.json")
    page,assets,receipt=assemble()
    if args.check:
        verify(target,page,assets)
        require(not receipt_path.is_symlink() and receipt_path.read_bytes()==receipt,"receipt differs from rebuild")
    else:
        require(not target.exists() and not target.is_symlink() and not receipt_path.exists() and not receipt_path.is_symlink(),
                "refusing to replace existing candidate; use --check")
        with tempfile.TemporaryDirectory(dir=HERE,prefix=".stage-") as d:
            stage=Path(d)/"out"
            (stage/"visuals").mkdir(parents=True)
            (stage/"index.html").write_bytes(page)
            for name,content in assets.items():
                (stage/"visuals"/name).write_bytes(content)
            verify(stage,page,assets)
            stage.rename(target)
            with receipt_path.open("xb") as f:
                f.write(receipt)
    print(f"{'verified' if args.check else 'built'} {target.name}: 56 topics / 115 choices / 115 hash-named images; HTML SHA-256 {sha(page)}")


if __name__=="__main__":
    main()
