#!/usr/bin/env python3
"""Check the REQ-005 roadmap's fixed evidence, not product behavior or live PR state."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import subprocess
import sys
from urllib.parse import unquote, urlparse

DOC = 'docs/REQ005_CONVERSATION_PROGRESSION_ROADMAP.md'
MASTER = '9ca338882ed21a3b01d534581d7a6e532c72da2a'
ORIGINAL = 'd1fca9f3da4e4b7bfea9cabca20ba0dd31f70869'
REPOSITORY = '/2NTTY/child-ai-caregiver/'
ALLOWED_PR409 = frozenset({DOC, 'WORKLOG.md', 'scripts/ci/verify-req005-roadmap.py',
                         'tests/ci/test_req005_roadmap_check.py', '.github/workflows/req005-roadmap-docs.yml'})


class VerificationError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def git(repo, *args):
    environment = {**os.environ, 'GIT_NO_LAZY_FETCH': '1', 'GIT_TERMINAL_PROMPT': '0'}
    result = subprocess.run(['git', '--no-pager', '-C', str(repo), *args], capture_output=True,
                            env=environment, check=False)
    require(result.returncode == 0, f'Git check failed: {" ".join(args)}')
    return result.stdout


def valid_sha(value):
    return bool(re.fullmatch(r'[0-9a-f]{40}', value))


def resolve_context(repo, base, head):
    for name, value in [('base', base), ('head', head)]:
        require(valid_sha(value), f'{name} must be a complete 40-hex commit SHA')
        git(repo, 'cat-file', '-e', value + '^{commit}')
    require(git(repo, 'rev-parse', 'HEAD').decode().strip() == head, 'Checkout HEAD differs from expected head')
    ancestors = git(repo, 'merge-base', '--all', base, head).decode().splitlines()
    require(len(ancestors) == 1 and valid_sha(ancestors[0]), 'Expected one unambiguous merge-base')
    return ancestors[0]


def repository_path(value, directory=''):
    require(not value.startswith('/') and '\\' not in value, f'Invalid repository path: {value}')
    path = posixpath.normpath(posixpath.join(directory, value))
    require(path not in ('.', '..') and not path.startswith('../'), f'Path escapes repository: {value}')
    return path


def read_file(repo, path):
    target = repo / path
    require(not target.is_symlink() and target.is_file(), f'Expected regular repository file: {path}')
    require(target.resolve().is_relative_to(repo.resolve()), f'Path escapes checkout: {path}')
    return target.read_bytes()


def check_text(text):
    require(text.endswith('\n'), 'Roadmap must end in a newline')
    require(not any(ord(char) < 32 and char not in '\n\t' for char in text), 'Unexpected control character')


def check_links(repo, text, head):
    file_links = pr_links = 0
    links = re.findall(r'\[[^\]]+\]\(([^)]+)\)', text)
    require(bool(links), 'No supported inline Markdown links found')
    for target in links:
        url = urlparse(target)
        require(not url.query, f'Unexpected query in source link: {target}')
        if url.scheme or url.netloc:
            require(url.scheme == 'https' and url.netloc == 'github.com', f'Unsupported source host: {target}')
            require(url.path.startswith(REPOSITORY), f'Source link is outside this repository: {target}')
            relative = url.path[len(REPOSITORY):]
            if relative in ('pull/408', 'pull/409'):
                require(not url.fragment, f'Unsupported PR fragment: {target}')
                pr_links += 1
                continue  # URL shape only; live PR status requires a separate read.
            parts = relative.split('/', 2)
            require(len(parts) == 3 and parts[0] == 'blob' and valid_sha(parts[1]), f'Source must pin a full commit SHA: {target}')
            revision, path = parts[1], repository_path(unquote(parts[2]))
        else:
            revision, path = head, repository_path(unquote(url.path), 'docs')
        content = git(repo, 'show', f'{revision}:{path}').decode('utf-8')
        if url.fragment:
            span = re.fullmatch(r'L(\d+)(?:-L(\d+))?', url.fragment)
            require(span is not None, f'Unsupported source fragment: {target}')
            start, end = int(span[1]), int(span[2] or span[1])
            require(1 <= start <= end <= len(content.splitlines()), f'Source line range is outside the file: {target}')
        file_links += 1
    return file_links, pr_links


def check_claims(text):
    # These assertions protect reviewed statements; they are not a semantic proof.
    for phrase in ['方案草案', '不代表整個 REQ-005 完成', '仍 open、未合併', '當次產品預算',
                   '兩道容量限制', '工具餘額充裕但 9,000 ASCII', 'scripted provider',
                   '無缺口／無重複', '原子替換', 'metadata-only', '6k 摘要', '3k 整批投影',
                   '未採納、未實作', '待定案', '32,000–64,000', 'fallback 至 8,000']:
        require(phrase in text, f'Missing reviewed scope/evidence statement: {phrase}')
    for phrase in ['Phase 1 (已完成 PR #408)', 'PR #408 已落地',
                   '所有團隊成員在進行 Phase 2 或後續模組開發時，應嚴格遵循']:
        require(phrase not in text, f'Obsolete completion/authority claim: {phrase}')
    rows = [line for line in text.splitlines() if '原 test 6' in line]
    require(len(rows) == 1 and all(phrase in rows[0] for phrase in ['repairOf／message ID',
            'prepareMaintenance(...) === null', '未直接驗證投影隱藏、provider 請求或超額接續']),
            'Test 6 must describe its actual assertion and unverified projection/provider/continuation')


def check_source_facts(repo):
    facts = {
        (MASTER, 'server/agent-budget.ts'): ['inputCharacters: 32000', 'default: 64000, min: 32000, max: 64000',
                                            'return this.responseCharacters ?? 8000;'],
        (MASTER, 'server/agent-model-gateway.ts'): ['requestCharacters > budget.limits.inputCharacters'],
        (MASTER, 'server/product-agent-tools.ts'): ['if (characters + size > 8000) break;',
                                                  'uncoveredConversation(sourceContext)',
                                                  'Math.max(0, budget.toolResponseCharacters - 512)'],
        (MASTER, 'server/firestore-memory.ts'): ['.max(6000)', ').length > 3000)'],
        (ORIGINAL, 'server/summary-window-helper.ts'): ['SUMMARY_BATCH_TARGET_CHARS = 12000',
                                                       'SUMMARY_GATEWAY_RESERVE_CHARS = 10500'],
        (ORIGINAL, 'tests/summary-progress.test.ts'): ['const skipped = await h.memory.prepareMaintenance',
                                                      'assert.equal(skipped, null,'],
    }
    for (revision, path), snippets in facts.items():
        source = git(repo, 'show', f'{revision}:{path}').decode('utf-8')
        for snippet in snippets:
            require(snippet in source, f'Historical source fact mismatch: {revision}:{path}: {snippet}')


def check_worklog(repo, merge_base):
    original = git(repo, 'show', f'{merge_base}:WORKLOG.md')
    require(read_file(repo, 'WORKLOG.md').startswith(original), 'WORKLOG must remain append-only relative to the merge-base')


def check_scope(repo, merge_base, head, pull_request):
    if pull_request != 409:
        return False  # This package's delivery allowlist is not a general product-PR gate.
    changed = set(git(repo, 'diff', '--name-only', '-z', merge_base, head).decode().rstrip('\0').split('\0')) - {''}
    require(changed <= ALLOWED_PR409, f'PR #409 contains out-of-scope files: {sorted(changed - ALLOWED_PR409)}')
    return True


def verify(repo, base, head, pull_request):
    merge_base = resolve_context(repo, base, head)
    require(not git(repo, 'status', '--porcelain', '--untracked-files=all'),
            'Checkout has uncommitted or untracked files; commit the reviewed candidate before exact-head verification')
    raw = read_file(repo, DOC)
    text = raw.decode('utf-8')
    check_text(text)
    file_links, pr_links = check_links(repo, text, head)
    check_claims(text)
    check_source_facts(repo)
    check_worklog(repo, merge_base)
    scoped = check_scope(repo, merge_base, head, pull_request)
    git(repo, 'diff', '--check', merge_base, head)
    git(repo, 'diff', '--check')
    return {'result': 'passed', 'base': base, 'head': head, 'merge_base': merge_base,
            'file_links_checked': file_links, 'pr_urls_syntax_only': pr_links,
            'pr409_scope_guard': scoped, 'roadmap_sha256': hashlib.sha256(raw).hexdigest(),
            'limits': 'Static documentation checks only. No live PR status, merge candidate, product tests, model, deployment, or complete semantic verification.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    parser.add_argument('--head', required=True)
    parser.add_argument('--pull-request', type=int, required=True)
    args = parser.parse_args()
    try:
        require(args.pull_request > 0, 'Pull request number must be positive')
        print(json.dumps(verify(Path.cwd(), args.base, args.head, args.pull_request), ensure_ascii=False, indent=2))
    except (VerificationError, UnicodeError, OSError) as error:
        print(f'FAIL: {error}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
