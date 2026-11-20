#!/usr/bin/env python3
"""Deterministic one-HTML ZIP, with exact read-back and no overwrite.

The name, SHA-256, byte count and destination are trusted inputs from a
verified receipt. This intentionally is not a general ZIP extractor.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
from zipfile import BadZipFile, ZipFile, ZipInfo, ZIP_DEFLATED
import zlib


def requirements(name, digest, size):
    if not name.endswith(".html") or any(c in name for c in "/\\:\0") or any(ord(c) < 32 for c in name):
        raise ValueError("expected a single HTML basename")
    if not re.fullmatch("[a-f0-9]{64}", digest) or size <= 0:
        raise ValueError("expected a lowercase SHA-256 and positive byte count")


def measure(path):
    with path.open("rb") as handle:
        return {"bytes": os.fstat(handle.fileno()).st_size, "sha256": hashlib.file_digest(handle, "sha256").hexdigest()}


def check(archive, name, digest, size, staged=None):
    requirements(name, digest, size)
    with ZipFile(archive, "r") as packed:
        rows = packed.infolist()
        if len(rows) != 1:
            raise ValueError("expected exactly one ZIP entry (no duplicates or extras)")
        entry, = rows
        kind = stat.S_IFMT(entry.external_attr >> 16) if entry.create_system == 3 else 0
        if entry.orig_filename != name or entry.filename != name or entry.is_dir() or kind not in (0, stat.S_IFREG):
            raise ValueError("ZIP entry must be the exact expected regular HTML basename")
        if entry.compress_type != ZIP_DEFLATED or (entry.flag_bits & 1):
            raise ValueError("expected plain, unencrypted DEFLATE")
        if entry.file_size != size:
            raise ValueError("ZIP entry size does not match the receipt")
        seen, hashed = 0, hashlib.sha256()
        with packed.open(entry) as payload:
            while block := payload.read(2**20):
                seen += len(block)
                if seen > size:
                    raise ValueError("read exceeded expected byte count")
                hashed.update(block)
                if staged is not None:
                    staged.write(block)
        if seen != size or hashed.hexdigest() != digest:
            raise ValueError("HTML byte count or SHA-256 does not match the receipt")
    return {"entry": name, "html_bytes": seen, "html_sha256": digest}


def pack(source, target, digest, size):
    requirements(source.name, digest, size)
    with source.open("rb") as handle:
        if os.fstat(handle.fileno()).st_size != size:
            raise ValueError("source byte count does not match the receipt")
        payload = handle.read(size + 1)
    if len(payload) != size or hashlib.sha256(payload).hexdigest() != digest:
        raise ValueError("source byte count or SHA-256 does not match the receipt")
    entry = ZipInfo(source.name, (1980, 1, 1, 0, 0, 0))
    entry.create_system = 3
    entry.external_attr = (stat.S_IFREG | 0o644) << 16
    entry.compress_type = ZIP_DEFLATED
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".wb-zip-", suffix=".zip") as tmp:
        staged = Path(tmp.name)
        with ZipFile(tmp, "w", allowZip64=False) as out:
            out.writestr(entry, payload, compresslevel=9)
        tmp.flush()
        result = check(staged, source.name, digest, size)
        outer = measure(staged)
        os.link(staged, target)  # Commit atomically; existing file or symlink is an error.
    return {**result, "zip_bytes": outer["bytes"], "zip_sha256": outer["sha256"]}


def restore(archive, name, digest, size, target):
    # Entry name is checked, never interpreted as a disk path. The caller
    # chooses the output; only a fully checked tempfile is linked into place.
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix=".wb-restore-") as tmp:
        result = check(archive, name, digest, size, tmp)
        tmp.flush()
        os.link(tmp.name, target)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="operation", required=True)
    make = sub.add_parser("pack")
    make.add_argument("source", type=Path)
    make.add_argument("target", type=Path)
    make.add_argument("sha256")
    make.add_argument("bytes", type=int)
    for action in ("verify", "restore"):
        read = sub.add_parser(action)
        read.add_argument("archive", type=Path)
        read.add_argument("name")
        read.add_argument("sha256")
        read.add_argument("bytes", type=int)
        if action == "restore":
            read.add_argument("target", type=Path)
    args = parser.parse_args()
    try:
        if args.operation == "pack":
            result = pack(args.source, args.target, args.sha256, args.bytes)
        elif args.operation == "restore":
            result = restore(args.archive, args.name, args.sha256, args.bytes, args.target)
        else:
            result = check(args.archive, args.name, args.sha256, args.bytes)
    except (BadZipFile, OSError, RuntimeError, ValueError, zlib.error) as error:
        print(f"Rejected: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
