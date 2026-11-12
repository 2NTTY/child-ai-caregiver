#!/usr/bin/env python3
"""Small, bounded JSON transport for the isolated site release bucket.

Authentication uses SITE_ACCESS_TOKEN or the attached VM service account. No
credentials, HTTP error bodies, request headers, or private object contents are
included in errors. Writes are attempted once; an uncertain result must be read
back by the caller before deciding what to do next.
"""

import argparse
import http.client
import json
import os
from pathlib import Path
import re
import ssl
import sys
import time
from urllib.parse import quote, urlencode


BUCKET = "ai-caregivers-for-children-site-release"
MAX_BYTES = 1024 * 1024
DEADLINE_SECONDS = 20
RECEIPT = re.compile(r"receipts/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\.json\Z")
GENERATION = re.compile(r"(?:0|[1-9][0-9]{0,19})\Z")


class StoreError(Exception):
    def __init__(self, message, code=1):
        super().__init__(message)
        self.code = code


def json_object(raw):
    try:
        value = json.loads(raw.decode("utf-8"), parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError, RecursionError):
        raise StoreError("Invalid JSON object") from None
    if not isinstance(value, dict):
        raise StoreError("Expected a JSON object")
    return value


def generation(value, allow_zero=False):
    if not isinstance(value, str) or not GENERATION.fullmatch(value) or (value == "0" and not allow_zero):
        raise StoreError("Invalid object generation")
    return value


class Client:
    def __init__(self, bucket):
        if bucket != BUCKET:
            raise StoreError("Bucket is not allowed")
        self.deadline = time.monotonic() + DEADLINE_SECONDS
        self.token = None

    def remaining(self):
        seconds = self.deadline - time.monotonic()
        if seconds <= 0:
            raise StoreError("Storage operation deadline exceeded")
        return seconds

    def object_path(self, name):
        if name not in {"commands/current.json", "control/mode.json", "status/live.json"} and not RECEIPT.fullmatch(name):
            raise StoreError("Object path is not allowed")
        return "/storage/v1/b/" + BUCKET + "/o/" + quote(name, safe="")

    def exchange(self, method, path, body=None, metadata=False):
        connection = None
        try:
            if metadata:
                connection = http.client.HTTPConnection("169.254.169.254", timeout=self.remaining())
                headers = {"Metadata-Flavor": "Google"}
            else:
                token = self.access_token()
                connection = http.client.HTTPSConnection("storage.googleapis.com", timeout=self.remaining(), context=ssl.create_default_context())
                headers = {"Authorization": "Bearer " + token, "Accept": "application/json"}
                if body is not None:
                    headers["Content-Type"] = "application/json; charset=utf-8"
            connection.request(method, path, body=body, headers=headers)
            if connection.sock:
                connection.sock.settimeout(self.remaining())
            response = connection.getresponse()
            if metadata and response.getheader("Metadata-Flavor") != "Google":
                raise StoreError("Metadata server identity check failed")
            chunks = []
            size = 0
            while True:
                remaining = self.remaining()
                if connection.sock:
                    connection.sock.settimeout(remaining)
                chunk = response.read1(min(65536, MAX_BYTES + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_BYTES:
                    raise StoreError("Storage response exceeds size limit")
                chunks.append(chunk)
            self.remaining()
            return response.status, b"".join(chunks)
        except (OSError, http.client.HTTPException, ValueError):
            raise StoreError("Storage transport failed; inspect the current object before retrying a write") from None
        finally:
            if connection:
                connection.close()

    def access_token(self):
        if self.token is None:
            if "SITE_ACCESS_TOKEN" in os.environ:
                token = os.environ["SITE_ACCESS_TOKEN"]
            else:
                status, data = self.exchange("GET", "/computeMetadata/v1/instance/service-accounts/default/token", metadata=True)
                if status != 200:
                    raise StoreError("VM access token is unavailable")
                token = json_object(data).get("access_token")
            if not isinstance(token, str) or not re.fullmatch(r"[A-Za-z0-9._~+/=-]{1,16384}", token):
                raise StoreError("Access token is missing or invalid")
            self.token = token
        return self.token

    @staticmethod
    def check(status, missing_code=44):
        if status == 404:
            raise StoreError("Object is missing", missing_code)
        if status in (409, 412):
            raise StoreError("Object generation conflict", 41)
        if not 200 <= status < 300:
            raise StoreError("Storage request rejected (HTTP " + str(status) + ")")

    def get(self, name):
        status, data = self.exchange("GET", self.object_path(name) + "?alt=media")
        self.check(status)
        json_object(data)
        return data

    def read_version(self, name):
        path = self.object_path(name)
        status, data = self.exchange("GET", path + "?fields=generation")
        if status == 404:
            return {"generation": "0", "value": None}
        self.check(status)
        revision = generation(json_object(data).get("generation"))
        status, data = self.exchange("GET", path + "?" + urlencode({"alt": "media", "generation": revision}))
        self.check(status, missing_code=41)
        return {"generation": revision, "value": json_object(data)}

    def put(self, name, source, expected):
        self.object_path(name)
        generation(expected, allow_zero=True)
        try:
            with Path(source).open("rb") as stream:
                data = stream.read(MAX_BYTES + 1)
        except OSError:
            raise StoreError("Cannot read JSON input file") from None
        if len(data) > MAX_BYTES:
            raise StoreError("JSON input exceeds size limit")
        json_object(data)
        query = urlencode({"uploadType": "media", "name": name, "ifGenerationMatch": expected, "fields": "generation"}, quote_via=quote)
        status, result = self.exchange("POST", "/upload/storage/v1/b/" + BUCKET + "/o?" + query, body=data)
        self.check(status)
        return generation(json_object(result).get("generation"))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    for verb in ("get", "read-version", "put"):
        command = commands.add_parser(verb)
        command.add_argument("bucket")
        command.add_argument("object")
        if verb == "put":
            command.add_argument("file")
            command.add_argument("expected_generation")
    args = parser.parse_args(argv)
    try:
        client = Client(args.bucket)
        if args.command == "get":
            sys.stdout.buffer.write(client.get(args.object))
        elif args.command == "read-version":
            print(json.dumps(client.read_version(args.object), separators=(",", ":"), ensure_ascii=True))
        else:
            print(client.put(args.object, args.file, args.expected_generation))
    except StoreError as error:
        print("site-release store: " + str(error), file=sys.stderr)
        return error.code
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
