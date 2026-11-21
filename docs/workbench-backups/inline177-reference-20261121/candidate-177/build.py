"""Build a local, append-only workbench candidate from the frozen 175-image artifact."""
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
BASE = COVERAGE / "candidate-175" / "out"
BASE_HTML = "9399efb18637dde5c79489d7727a5f452be6f1e2104c7a99ecbb2f7b91025e76"
MANIFEST = HERE / "manifest.json"
SCRIPT_RE = re.compile(r"<script>(.*?)</script>", re.S)
STYLE_RE = re.compile(r"<style>(.*?)</style>", re.S)
RECORDS_RE = re.compile(r'<script id="records" type="application/json">(.*?)</script>', re.S)
ART_RE = re.compile(r"^const artwork=(\{[^\r\n]+\});$", re.M)
CSP_RE = re.compile(r'<meta http-equiv="Content-Security-Policy" content="([^"]+)">')
IMAGE_PATH = re.compile(r"\./visuals/([a-f0-9]{64})\.(png|webp)")
SAFE_NEW_GIT = re.compile('(?:/Goooler/Launcher3/blob/2f5b9b869d86620fdb899bc2df53d523dc9dc6ea|/mozilla\\-firefox/firefox/blob/032a9fc1ac0cc3209f7c142744ba2e40847c8086)/[^\\s]+')
SAFE_NOTICE = re.compile(r"[ \t]+(?=\r?$)", re.M)
ASSET_ROOTS = ("draft-mobile-nav",)
REVIEWED_SHA = {'mobile-nav-a.png': '7d887a2aba998177003850f0c76d7e7ada760ef447b0224033076b49b8aa3157', 'mobile-nav-b.png': '4231c46fe052f22b483f0e4a793eb7805068a111922c3fbf8442d817aa8cfcda', 'assets.json': '8a44f8f9389f95927ec1f9cc48ed220ed993d1525e530e1056b78b03330ef2fc', 'DECLARATION.txt': '32689c536bfa0a6c3074179a6212c0aa30a96cc65852d6e3ce9a540ab42a7854', 'PROVENANCE.md': 'ccf58252f931a3c90ce3cfe9bbbfb2d5c745010807ffe9c8bca38dfef5fb281a'}
EXPECTED = (87, 177, 177)
BASE_COUNTS = (86,175,175)


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
    require(len(item.parts) == 2 and not item.is_absolute() and item.parts[0] in ASSET_ROOTS
            and item.name in REVIEWED_SHA, "invalid local draft path")
    origin = COVERAGE / item
    require(not origin.is_symlink() and not origin.parent.is_symlink() and origin.resolve(strict=True) == origin,
            f"symlink or non-normalized path: {item}")
    require(origin.is_file(), f"missing authorized input: {item}")
    data = origin.read_bytes()
    require(sha(data) == REVIEWED_SHA[item.name], "independent reviewed input changed: " + item.name)
    return data


def old_assets(old_map):
    found = {}
    paths = []
    for name, item in old_map.items():
        loc = IMAGE_PATH.fullmatch(item["src"])
        require(loc is not None, "unexpected frozen-base image path for " + name)
        filename = item["src"].split("/")[-1]
        b = BASE / "visuals" / filename
        require(filename not in found and not b.is_symlink() and b.is_file(), "duplicate or missing frozen-base asset " + filename)
        data = b.read_bytes()
        require(sha(data) == loc[1], "frozen-base content address mismatch: " + filename)
        found[filename] = data
        paths.append(filename)
    require(set(paths) == {v.name for v in (BASE/"visuals").iterdir()}, "frozen-base physical image inventory differs from artwork")
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
    require(m["schema"] == 1 and m["candidate"] == "local-candidate-177-image-count", "unexpected manifest schema/identity")
    require(base["artifact"] == "candidate-175/out" and base["htmlSha256"] == BASE_HTML == sha(b), "exact frozen-base HTML mismatch")
    page = b.decode("utf-8")
    record_match = match_one(RECORDS_RE,page)
    script_match = match_one(SCRIPT_RE,page)
    style_match = match_one(STYLE_RE,page)
    csp_match = match_one(CSP_RE,page)
    old_script,style = script_match[1],style_match[1]
    require(csp_match[1] == policy(old_script,style), "frozen-base CSP does not match scoped hashes")
    art_match = match_one(ART_RE,old_script)
    olds = (record_match[1],art_match[1])
    require(sha(olds[0].encode()) == base["rawRecordsSha256"] and sha(olds[1].encode()) == base["rawArtworkSha256"],
            "frozen-base exact records or binding payload mismatch")
    old_records,old_map = map(read_json,olds)
    counts = (len(old_records),sum(len(x["choices"]) for x in old_records),len(old_map))
    require(counts == BASE_COUNTS == (base["topics"],base["choices"],base["images"]), "frozen-base entry counts changed")
    old_keys = [binding(c) for x in old_records for c in x["choices"]]
    require(set(old_keys) == set(old_map) and len(set(old_keys)) == len(old_keys), "frozen-base card/image bindings mismatch")
    assets = old_assets(old_map)
    old_receipt = {name:sha(data) for name,data in sorted(assets.items())}
    new_records,new_map = [],{}
    require([x["number"] for x in m["topics"]] == [87], "append order wrong")
    require(len(m["draftLedgers"]) == 1, "missing reviewed draft ledgers")
    for i,ledger in enumerate(m["draftLedgers"]):
        require(Path(ledger["input"]).parts == (ASSET_ROOTS[i], "assets.json")
                and sha(safe_asset_origin(ledger["input"])) == ledger["sha256"], "reviewed draft ledger changed")
    drafts = [read_json(safe_asset_origin(l["input"])) for l in m["draftLedgers"]]
    require([r["variant"] for r in drafts[0]] == ["A","B"], "unexpected reviewed option order")
    require(set(m["sourceDeclarations"])=={"DECLARATION.txt","PROVENANCE.md"}, "unexpected draft provenance inputs")
    for filename, digest in m["sourceDeclarations"].items():
        require(sha(safe_asset_origin(ASSET_ROOTS[0]+"/"+filename)) == digest,
                "reviewed declaration/provenance changed")
    for i,t in enumerate(m["topics"]):
        require(len(t["choices"]) == 2 and isinstance(t["title"],str) and t["title"], "invalid new topic")
        choices = []
        for j,e in enumerate(t["choices"]):
            require(set(e) == {"name","note","links","asset"} and e["name"] and e["note"] and e["links"], "invalid new card")
            require(len({l["url"] for l in e["links"]}) == len(e["links"]), "repeated source link within card")
            for link in e["links"]:
                check_new_link(link)
            choices.append({k:e[k] for k in ("name","note","links")})
            asset = e["asset"]
            reviewed = drafts[i][j]
            reviewed_name = reviewed["choice"]
            primary = reviewed["link"]
            gather = [link["url"] for link in e["links"]]
            require(e["name"] == reviewed_name and gather == [primary] + reviewed["sourceLinks"],
                    "draft card/source order or fixed source license changed")
            require(all("/"+reviewed["sourceRepository"]+"/blob/"+reviewed["sourceCommit"]+"/" in url for url in gather)
                    and reviewed["sourceLicense"] in e["links"][-1]["label"] and reviewed["sourceVersion"] in e["links"][0]["label"],
                    "draft version, license, or provenance does not match card")
            require(reviewed["notice"] in m["sourceDeclarations"], "missing reviewed attribution declaration")
            reviewed_label = reviewed["previewLabel"]
            reviewed_credit = reviewed["credit"]
            require(asset["sha256"] == reviewed["sha256"] and asset["dimensions"] == reviewed["dimensions"]
                    and asset["alt"] == reviewed["alt"]
                    and asset["previewLabel"] == reviewed_label and asset["credit"] == reviewed_credit
                    and Path(asset["input"]).name == reviewed["file"],
                    "draft labels, provenance or reviewed image changed")
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
    require(read_json(records)[:86] == old_records and list(read_json(art).items())[:175] == list(old_map.items()),
            "frozen-base records or bindings unexpectedly modified")
    script = amend_span(old_script,art_match,art)
    # The old handler is already dynamically bound to data.length. Do not change
    # its code, the selector IDs, keyboard/focus handlers, or any old UI runtime.
    require('by(\'latest\').addEventListener(\'click\',()=>detail(data.length-1))' in old_script,
            "unexpected base shortcut implementation")
    require(amend_span(script,match_one(ART_RE,script),olds[1]) == old_script, "base executable behavior changed")

    result = replace_one(page,"<script>"+old_script+"</script>","<script>"+script+"</script>")
    result = replace_one(result,record_match[0],'<script id="records" type="application/json">'+records+'</script>')
    result = replace_one(result,csp_match[0],'<meta http-equiv="Content-Security-Policy" content="'+policy(script,style)+'">')
    original_counts = 'aria-label="共 86 個主題，175 個方案"><div><b>86</b>主題</div><div><b>175</b>方案</div>'
    updated_counts = 'aria-label="共 87 個主題，177 個方案"><div><b>87</b>主題</div><div><b>177</b>方案</div>'
    original_last = '<button id="latest" type="button">直達第 86 題</button>'
    updated_last = '<button id="latest" type="button">直達第 87 題</button>'
    require(page.count('<title>育伴港選配工作台</title>') == 1, "frozen-base tab title unexpectedly changed")
    result = replace_one(result, original_counts, updated_counts)
    result = replace_one(result, original_last, updated_last)
    notices=[]
    for i,notice in enumerate(m["notices"],87):
        require(notice["heading"].startswith(f"第 {i} 題"), "append notices do not match the order of topics")
        require(set(notice) == {"heading", "input", "sha256"}
                and Path(notice["input"]).parts == (ASSET_ROOTS[0], "DECLARATION.txt"), "invalid declaration input")
        raw=safe_asset_origin(notice["input"])
        require(sha(raw)==notice["sha256"],"approved draft declaration changed")
        content=raw.decode("utf-8")
        require(content.strip() and "非官方" in content, "nonofficial asset notice missing")
        notices.append(f'<h3>{html.escape(notice["heading"])}</h3><pre>{escape_notice(content)}</pre>')
    require(len(notices)==1,"expected one notice")
    result = replace_one(result,"</pre></details></footer>","</pre>"+"".join(notices)+"</details></footer>")
    # Reversing only our allowlisted changes must restore the exact frozen page.
    unchanged = replace_one(result,"</pre>"+"".join(notices)+"</details></footer>","</pre></details></footer>")
    unchanged = replace_one(unchanged,updated_counts,original_counts)
    unchanged = replace_one(unchanged,updated_last,original_last)
    unchanged = amend_span(unchanged,match_one(SCRIPT_RE,unchanged),old_script)
    unchanged = amend_span(unchanged,match_one(RECORDS_RE,unchanged),olds[0])
    unchanged = amend_span(unchanged,match_one(CSP_RE,unchanged),csp_match[1])
    require(unchanged==page, "non-append-only difference outside the approved change set")
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
    print(f"{'verified' if args.check else 'built'} {target.name}: 87 topics / 177 choices / 177 hash-named images; HTML SHA-256 {sha(page)}")


if __name__=="__main__":
    main()
