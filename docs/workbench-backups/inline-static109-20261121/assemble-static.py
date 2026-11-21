"""Separate verified inline109 base presentation rasters into content-addressed static files."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import struct
import tempfile

from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REFERENCE = ROOT.parent / "workbench-page-reference12-20261111/public/candidates"
HTML = HERE / "embedded-109.html"
RECEIPT = HERE / "embedded-receipt.json"
MANIFEST = HERE / "batch-109.json"

SCRIPT_RE = re.compile(r"<script>(.*?)</script>", re.S)
ARTWORK_RE = re.compile(r"^const artwork=(\{[^\r\n]+\});$", re.M)
RECORDS_RE = re.compile(r'<script id="records" type="application/json">(.*?)</script>', re.S)
HASH_RE = re.compile(r"[a-f0-9]{64}")
FORMATS = {"image/png": ("png", "PNG"), "image/webp": ("webp", "WEBP")}
OLD_GUARD = """ if(!row||typeof row.src!=='string'||row.src.length>2700000)return null;
 const accepted=/^data:image\\/(png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(row.src);
 if(!accepted||accepted[2].length%4!==0)return null;
 const signature=atob(accepted[2].slice(0,16));
 if(accepted[1]==='png'?!accepted[2].startsWith('iVBORw0KGgoAAAANSUhEUg'):!(signature.startsWith('RIFF')&&signature.slice(8,12)==='WEBP'))return null;"""
NEW_GUARD = r" if(!row||typeof row.src!=='string'||!/^\.\/visuals\/[a-f0-9]{64}\.(?:png|webp)$/.test(row.src))return null;"


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def csp_hash(script):
    return base64.b64encode(hashlib.sha256(script.encode("utf-8")).digest()).decode("ascii")


def single_match(pattern, value):
    hits = list(pattern.finditer(value))
    require(len(hits) == 1, f"expected one match: {pattern.pattern}")
    return hits[0]


def single_replace(value, old, new):
    require(value.count(old) == 1, "expected a single versioned HTML token")
    return value.replace(old, new, 1)


def key_for(e, records):
    choices = [
        c for g in records for c in g["choices"]
        if c["links"][0]["url"] == e["link"] and ("choice" not in e or c["name"] == e["choice"])
    ]
    require(len(choices) == 1, f"ambiguous or missing approved record: {e['link']}")
    return choices[0]["name"] + "\n" + e["link"]


def approved_raster(e, row):
    expected = e["sha256"]
    require(HASH_RE.fullmatch(expected), "invalid manifest digest")
    mime = e.get("mime", "image/png")
    require(mime in FORMATS, "unsupported raster format")
    extension, fmt = FORMATS[mime]
    path = (ROOT / e["file"]).resolve(strict=True)
    require(path.is_relative_to(ROOT) or path.is_relative_to(REFERENCE), "outside approved local asset roots")
    require(path.is_file() and path.suffix.lower() == "." + extension and 0 < path.stat().st_size < 2_000_000,
            f"invalid approved raster file: {path}")
    raw = path.read_bytes()
    require(sha(raw) == expected, f"manifest digest mismatch: {path}")
    prefix = f"data:{mime};base64,"
    require(row["src"].startswith(prefix), f"inline109 base format mismatch: {path}")
    require(base64.b64decode(row["src"][len(prefix):], validate=True) == raw,
            f"approved raster differs from inline109 base: {path}")
    if fmt == "WEBP":
        require(raw[:4] == b"RIFF" and raw[8:12] == b"WEBP" and struct.unpack("<I", raw[4:8])[0] + 8 == len(raw),
                f"invalid RIFF size or signature: {path}")
    with Image.open(io.BytesIO(raw), formats=[fmt]) as image:
        require(image.format == fmt and 0 < image.width <= 4096 and 0 < image.height <= 4096
                and getattr(image, "n_frames", 1) == 1, f"invalid raster shape: {path}")
        image.verify()
    with Image.open(io.BytesIO(raw), formats=[fmt]) as image:
        image.load()
    return f"{expected}.{extension}", raw


def assemble():
    source = HTML.read_bytes()
    receipt = json.loads(RECEIPT.read_text(encoding="utf-8"))
    require(receipt["candidate"] == "inline109" and sha(source) == receipt["htmlSha"], "inline109 base source failed receipt SHA verification")
    html = source.decode("utf-8")
    script = single_match(SCRIPT_RE, html)[1]
    artwork_match = single_match(ARTWORK_RE, script)
    artwork = json.loads(artwork_match[1])
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    records = json.loads(single_match(RECORDS_RE, html)[1])
    require((len(records), sum(len(g["choices"]) for g in records), len(artwork), len(manifest))
            == (receipt["topics"], receipt["options"], receipt["inline"], receipt["inline"]),
            "inline109 base topic, option or approved raster count mismatch")
    assets, visited = {}, set()
    for row in manifest:
        key = key_for(row, records)
        require(key in artwork and key not in visited, f"missing or duplicate inline109 base artwork: {key}")
        visited.add(key)
        filename, raw = approved_raster(row, artwork[key])
        require(filename not in assets, "duplicate raster digest in approved release")
        assets[filename] = raw
        artwork[key]["src"] = "./visuals/" + filename
    require(visited == set(artwork), "incomplete approved manifest")
    artwork_json = json.dumps(artwork, ensure_ascii=False, separators=(",", ":")).replace("<", r"\u003c")
    new_script = script[:artwork_match.start(1)] + artwork_json + script[artwork_match.end(1):]
    new_script = single_replace(new_script, OLD_GUARD, NEW_GUARD)
    html = single_replace(html, "<script>" + script + "</script>", "<script>" + new_script + "</script>")
    html = single_replace(html, "sha256-" + csp_hash(script), "sha256-" + csp_hash(new_script))
    html = single_replace(html, "img-src data:;", "img-src &#x27;self&#x27;;")
    require(re.search(r"data:image/", html, re.I) is None, "embedded raster remains")
    return html.encode("utf-8"), assets


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="out", type=str, help="new directory beneath this spike")
    args = parser.parse_args()
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]*", args.output_dir), "expected a fresh, simple output directory name")
    target = HERE / args.output_dir
    require(not (target.exists() or target.is_symlink()), "refusing to overwrite existing output")
    html, assets = assemble()
    with tempfile.TemporaryDirectory(prefix=".stage-", dir=HERE) as staging:
        stage = Path(staging) / "dist"
        (stage / "visuals").mkdir(parents=True)
        (stage / "index.html").write_bytes(html)
        for filename, raw in assets.items():
            (stage / "visuals" / filename).write_bytes(raw)
        stage.rename(target)
    print(f"{target}: HTML {len(html)} bytes, {len(assets)} verified assets / {sum(map(len,assets.values()))} bytes")


if __name__ == "__main__":
    main()
