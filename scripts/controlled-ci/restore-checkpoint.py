#!/usr/bin/env python3
"""Restore one approved checkpoint without extracting an unchecked archive."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import zipfile

INITIAL_PATH = '.github/controlled-model/initial-live-ledger.json'
INITIAL_SHA = '362234b5ec21080e53220d35b00f1dc70f29098aa66e16ad43ae9944b0b95106'
MAX_ARCHIVE = 2 * 1024 * 1024
MAX_LEDGER = 1024 * 1024
MAX_EVIDENCE = 512 * 1024
ALLOWLIST = {'bootstrap.json': 16384, 'result.json': 65536, 'claim.json': 16384,
             'live-ledger.json': MAX_LEDGER, 'preflight.json': 65536,
             'synthetic-evidence.json': MAX_EVIDENCE}

class RestoreError(Exception):
    pass

def fail(category):
    raise RestoreError(category)

def regular_bytes(filename, maximum):
    metadata = filename.lstat()
    if filename.is_symlink() or not stat.S_ISREG(metadata.st_mode) or metadata.st_size > maximum:
        fail('checkpoint_file_unsafe')
    return filename.read_bytes()

def safe_json(data):
    try:
        return json.loads(data)
    except (UnicodeError, ValueError):
        fail('checkpoint_json_invalid')

def validate_safe_keys(value, depth=0):
    if depth > 40:
        fail('checkpoint_json_depth_exceeded')
    denied = {'thought', 'thoughts', 'thoughtSignature', 'signature', 'credentials',
              'credential', 'token', 'headers', 'environment', 'env', 'apiKey', 'password', 'secret'}
    if isinstance(value, dict):
        if any(key.lower() in {name.lower() for name in denied} for key in value):
            fail('checkpoint_sensitive_field_denied')
        for item in value.values():
            validate_safe_keys(item, depth + 1)
    elif isinstance(value, list):
        if len(value) > 4096:
            fail('checkpoint_json_size_exceeded')
        for item in value:
            validate_safe_keys(item, depth + 1)
    elif isinstance(value, str) and len(value) > 12000:
        fail('checkpoint_json_string_exceeded')

def restore(workspace, temp):
    workspace, temp = Path(workspace), Path(temp)
    if not workspace.is_absolute() or not temp.is_absolute() or workspace.resolve() != workspace or temp.resolve() != temp:
        fail('workspace_path_denied')
    trusted, product = workspace / 'trusted', workspace / 'product'
    for directory in (trusted, product):
        if directory.is_symlink() or directory.resolve() != directory or not directory.is_dir():
            fail('checkout_path_denied')
    control = temp / 'controlled-model-control'
    if control.is_symlink() or control.resolve() != control:
        fail('control_path_denied')
    plan = safe_json(regular_bytes(control / 'restore-plan.json', 16384))
    source = plan['checkpointSource']
    previous_evidence = None
    if source['type'] == 'initial':
        if source != {'type': 'initial', 'path': INITIAL_PATH, 'sha256': INITIAL_SHA} or plan['ledgerSha256'] != INITIAL_SHA:
            fail('initial_checkpoint_unapproved')
        filename = trusted / INITIAL_PATH
        if filename.resolve() != filename:
            fail('initial_checkpoint_path_denied')
        ledger = regular_bytes(filename, MAX_LEDGER)
    elif source['type'] == 'artifact':
        download = temp / 'controlled-model-download'
        if download.is_symlink() or download.resolve() != download:
            fail('archive_directory_denied')
        names = list(download.iterdir())
        if len(names) != 1:
            fail('archive_count_invalid')
        archive_bytes = regular_bytes(names[0], MAX_ARCHIVE)
        if 'sha256:' + hashlib.sha256(archive_bytes).hexdigest() != source['artifactDigest']:
            fail('archive_digest_mismatch')
        files = {}
        with zipfile.ZipFile(names[0]) as archive:
            if len(archive.infolist()) > len(ALLOWLIST):
                fail('archive_file_count_exceeded')
            for info in archive.infolist():
                mode = (info.external_attr >> 16) & 0o170000
                if info.filename not in ALLOWLIST or info.filename in files or info.is_dir() or mode not in (0, stat.S_IFREG):
                    fail('archive_filename_or_type_denied')
                if info.flag_bits & 1 or info.file_size > ALLOWLIST[info.filename] or info.compress_size > MAX_ARCHIVE:
                    fail('archive_size_or_encryption_denied')
                data = archive.read(info)
                if len(data) != info.file_size:
                    fail('archive_size_mismatch')
                validate_safe_keys(safe_json(data))
                files[info.filename] = data
        if 'live-ledger.json' not in files:
            fail('checkpoint_ledger_missing')
        ledger = files['live-ledger.json']
        previous_evidence = files.get('synthetic-evidence.json')
    else:
        fail('checkpoint_source_invalid')
    if hashlib.sha256(ledger).hexdigest() != plan['ledgerSha256']:
        fail('checkpoint_hash_mismatch')
    validate_safe_keys(safe_json(ledger))
    state = workspace / '.controlled-model-state'
    state.mkdir(mode=0o700)
    if state.is_symlink() or state.resolve() != state:
        fail('state_path_denied')
    descriptor = os.open(state / 'live-ledger.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(ledger)
        handle.flush()
        os.fsync(handle.fileno())
    directory_fd = os.open(state, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    if previous_evidence is not None:
        with (control / 'previous-b-evidence.json').open('xb') as handle:
            handle.write(previous_evidence)
        os.chmod(control / 'previous-b-evidence.json', 0o600)
    return {'schemaVersion': 1, 'mode': 'checkpoint-restore', 'status': 'restored_for_validation',
            'checkpointSha256': plan['ledgerSha256'], 'modelCalls': 0, 'checkpointConsumed': False}

if __name__ == '__main__':
    try:
        report = restore(os.environ.get('GITHUB_WORKSPACE', ''), os.environ.get('RUNNER_TEMP', ''))
        print(json.dumps(report, separators=(',', ':'), sort_keys=True))
    except RestoreError as error:
        print(json.dumps({'errorCategory': str(error)}))
        sys.exit(1)
    except Exception:
        print('{"errorCategory":"checkpoint_restore_error_redacted"}')
        sys.exit(1)
