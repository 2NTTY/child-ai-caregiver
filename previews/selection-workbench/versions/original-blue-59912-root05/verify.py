#!/usr/bin/env python3
"""Read-only payload integrity and HTTP-root checks. No server or network."""
import hashlib
import io
import json
import re
import sys
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlsplit

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent


def require(condition, message):
    if not condition:
        raise ValueError(message)


def record(path):
    data = path.read_bytes()
    return {
        "bytes": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "gitBlobSha1": hashlib.sha1(
            b"blob " + str(len(data)).encode("ascii") + b"\0" + data
        ).hexdigest(),
    }


class AssetLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and "src" in attrs:
            self.paths.append(attrs["src"])
        if tag == "link" and "href" in attrs:
            self.paths.append(attrs["href"])


class FileResponse(SimpleHTTPRequestHandler):
    """Exercise Python's actual file handler without a socket or server."""

    def __init__(self, directory, path):
        self.directory = str(directory)
        self.path = path
        self.headers = {}
        self.response_headers = {}
        self.status = None
        self.wfile = io.BytesIO()
        self.command = "GET"

    def send_response(self, code, message=None):
        self.status = code

    def send_header(self, keyword, value):
        self.response_headers[keyword.lower()] = value

    def end_headers(self):
        pass

    def send_error(self, code, message=None, explain=None):
        raise ValueError("HTTP file check failed: %s %s" % (code, self.path))


def main():
    manifest = json.loads((ROOT / "files.json").read_text(encoding="utf-8"))
    allowed = manifest["allowedPaths"]
    require(len(allowed) == len(set(allowed)), "Duplicate allowlist paths")
    for name in allowed:
        p = PurePosixPath(name)
        require(not p.is_absolute() and ".." not in p.parts and "\\" not in name,
                "Unsafe path: " + name)
    actual = []
    for path in ROOT.rglob("*"):
        require(not path.is_symlink(), "Symlinks are not permitted: " + str(path))
        if path.is_file():
            actual.append(path.relative_to(ROOT).as_posix())
    require(sorted(actual) == sorted(allowed), "Publication file set differs from allowlist")
    entries = manifest["files"]
    require({e["path"] for e in entries} == set(allowed) - {"files.json"},
            "Manifest coverage differs from allowlist")
    groups = {}
    for entry in entries:
        require(record(ROOT / entry["path"]) == {k: entry[k] for k in
                ("bytes", "sha256", "gitBlobSha1")}, "Hash mismatch: " + entry["path"])
        groups.setdefault(entry["gitBlobSha1"], []).append(entry["path"])
    expected_groups = [dict(gitBlobSha1=k, paths=sorted(v)) for k, v in sorted(groups.items())]
    require(manifest["gitBlobGroups"] == expected_groups, "Git blob deduplication differs")
    provenance = json.loads((ROOT / "provenance.json").read_text())
    prefix = provenance["artifact"]["baseUrl"]
    static = [e for e in entries if e["path"].startswith("static/")]
    summary = manifest["summary"]
    require(len(static) == 44 and sum(e["bytes"] for e in static) == provenance["artifact"]["staticBytes"],
            "Reviewed static payload count or size changed")
    require(summary["fileCount"] == len(allowed), "File count differs")
    require(summary["totalBytes"] == sum((ROOT / p).stat().st_size for p in allowed),
            "Total byte count differs")
    require(summary["manifestBytes"] == (ROOT / "files.json").stat().st_size,
            "Manifest byte count differs")
    require(summary["distinctHashedGitBlobs"] == len(groups), "Unique blob count differs")
    require(summary["hashedFilesBytes"] == sum(e["bytes"] for e in entries),
            "Hashed byte count differs")

    static_root = ROOT / "static"
    for entry in static:
        route = "/" + entry["path"][len("static/"):]
        handler = FileResponse(static_root, route)
        result = handler.send_head()
        require(handler.status == 200 and result is not None, "File not served: " + route)
        with result:
            require(hashlib.sha256(result.read()).hexdigest() == entry["sha256"],
                    "HTTP-root bytes differ: " + route)
        if route.endswith(".js"):
            require("javascript" in handler.response_headers.get("content-type", ""),
                    "JavaScript MIME type is unavailable")
        if route.endswith(".css"):
            require(handler.response_headers.get("content-type") == "text/css", "CSS MIME differs")
    for route in (prefix + "/", prefix + "/tasks/", prefix + "/profile/"):
        handler = FileResponse(static_root, route)
        result = handler.send_head()
        require(handler.status == 200 and result is not None, "Route shell unavailable: " + route)
        result.close()
    for route in (prefix + "/tasks", prefix + "/profile"):
        handler = FileResponse(static_root, route)
        result = handler.send_head()
        require(result is None and handler.status == 301 and
                handler.response_headers.get("location") == route + "/", "Route redirect differs")

    def require_asset(url):
        require(url.startswith("/") and not url.startswith("//"), "Asset is not root-relative")
        require((static_root / unquote(urlsplit(url).path).lstrip("/")).is_file(),
                "Missing root-relative asset: " + url)

    for path in static_root.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        require("connect-src 'none'" in html and "form-action 'none'" in html,
                "Static boundary policy missing")
        parser = AssetLinks()
        parser.feed(html)
        for url in parser.paths:
            require_asset(url)
    bundles = list(static_root.rglob("*.js"))
    require(len(bundles) == 1, "Unexpected JavaScript bundle count")
    js = bundles[0].read_text(encoding="utf-8")
    require("sourceMappingURL" not in js and not list(static_root.rglob("*.map")),
            "Source map exposed")
    for url in re.findall(r'"(/[^"\\]*assets/[^"\\]+)"', js):
        require_asset(url)
    for path in static_root.rglob("*.css"):
        for url in re.findall(r"url\(['\"]?([^)'\"]+)", path.read_text(encoding="utf-8")):
            if url.startswith("data:"):
                continue
            if url.startswith("/"):
                require_asset(url)
            else:
                require(not urlsplit(url).scheme and (path.parent / url).is_file(),
                        "Missing CSS asset: " + url)

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    for url in re.findall(r"\]\(([^)]+)\)", readme):
        parsed = urlsplit(url)
        if not parsed.scheme and not parsed.netloc:
            require((ROOT / unquote(parsed.path)).is_file(), "Broken README link: " + url)
    for path in ROOT.rglob("*"):
        if path.is_file() and path.suffix in (".html", ".js", ".css", ".json", ".md", ".py"):
            data = path.read_bytes()
            forbidden = [b"/work" + b"space/", b"/home/" + b"agent/",
                         b"browser-" + b"evidence/", b"BEGIN " + b"PRIVATE KEY"]
            require(not any(token in data for token in forbidden),
                    "Private path or secret marker in " + path.relative_to(ROOT).as_posix())
    print(json.dumps({"status": "PASS", "files": len(allowed),
                      "staticFiles": len(static), "totalBytes": summary["totalBytes"],
                      "distinctHashedGitBlobs": len(groups),
                      "manifestSha256": record(ROOT / "files.json")["sha256"],
                      "httpCheck": "in-process standard-library handler; no server started",
                      "browserQaRepeated": False}, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print("FAIL: " + str(error), file=sys.stderr)
        sys.exit(1)
