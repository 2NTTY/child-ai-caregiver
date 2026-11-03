"""Focused positive and negative controls for the roadmap-only verifier."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
CHECKER = ROOT / 'scripts/ci/verify-req005-roadmap.py'
DOC = 'docs/REQ005_CONVERSATION_PROGRESSION_ROADMAP.md'


class RoadmapChecks(unittest.TestCase):
    def setUp(self):
        self.assertTrue(CHECKER.is_file(), 'The committed roadmap verifier is missing')
        spec = importlib.util.spec_from_file_location('roadmap_check', CHECKER)
        self.checker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.checker)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'CI fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.write('WORKLOG.md', 'Original history.\n')
        self.write('PLAN.md', 'Plan.\n')
        self.write('docs/source.md', 'First line.\nSecond line.\n')
        self.write(DOC, 'Initial roadmap.\n')
        self.base = self.commit('Initial synthetic fixture')
        self.write('WORKLOG.md', 'Original history.\nNew evidence.\n')
        self.write(DOC, 'Updated roadmap.\n')
        self.head = self.commit('Synthetic documentation change')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True).strip()

    def write(self, name, value):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding='utf-8')

    def commit(self, message):
        self.git('add', '.')
        self.git('commit', '-qm', message)
        return self.git('rev-parse', 'HEAD')

    def test_resolves_exact_head_and_unique_merge_base(self):
        self.assertEqual(self.checker.resolve_context(self.repo, self.base, self.head), self.base)

    def test_rejects_non_hex_and_missing_revisions(self):
        for revision in ['HEAD', 'a' * 39, 'g' * 40, 'f' * 40]:
            for position in ['base', 'head']:
                with self.subTest(revision=revision, position=position):
                    with self.assertRaises(self.checker.VerificationError):
                        self.checker.resolve_context(self.repo, revision if position == 'base' else self.base,
                                                     revision if position == 'head' else self.head)

    def test_rejects_checkout_head_mismatch(self):
        with self.assertRaisesRegex(self.checker.VerificationError, 'HEAD'):
            self.checker.resolve_context(self.repo, self.base, self.base)

    def test_uses_merge_base_when_target_has_unrelated_new_log(self):
        self.git('checkout', '-qb', 'target', self.base)
        self.write('WORKLOG.md', 'Original history.\nOther target evidence.\n')
        target = self.commit('Unrelated target update')
        self.git('checkout', '--detach', '-q', self.head)
        common = self.checker.resolve_context(self.repo, target, self.head)
        self.assertEqual(common, self.base)
        self.checker.check_worklog(self.repo, common)

    def test_accepts_appended_worklog_and_rejects_rewrite(self):
        self.checker.check_worklog(self.repo, self.base)
        self.write('WORKLOG.md', 'Changed original history.\nNew evidence.\n')
        with self.assertRaisesRegex(self.checker.VerificationError, 'append-only'):
            self.checker.check_worklog(self.repo, self.base)

    def test_checks_source_links_and_line_ranges(self):
        text = f'[Source](https://github.com/2NTTY/child-ai-caregiver/blob/{self.base}/docs/source.md#L1-L2)\n[Plan](../PLAN.md)\n[PR](https://github.com/2NTTY/child-ai-caregiver/pull/409)\n'
        self.assertEqual(self.checker.check_links(self.repo, text, self.head), (2, 1))
        for target in [f'{self.base}/docs/missing.md#L1', f'{self.base}/docs/source.md#L1-L3', f'{self.base}/docs/source.md#L0', 'master/docs/source.md#L1']:
            with self.subTest(target=target):
                with self.assertRaises(self.checker.VerificationError):
                    self.checker.check_links(self.repo, f'[Bad](https://github.com/2NTTY/child-ai-caregiver/blob/{target})', self.head)

    def test_rejects_paths_outside_repository(self):
        for link in ['../../outside.md', '/etc/passwd', f'https://github.com/2NTTY/child-ai-caregiver/blob/{self.base}/../../outside.md']:
            with self.subTest(link=link):
                with self.assertRaises(self.checker.VerificationError):
                    self.checker.check_links(self.repo, f'[Bad]({link})', self.head)

    def test_scope_guard_rejects_product_file_only_for_pr409(self):
        self.assertTrue(self.checker.check_scope(self.repo, self.base, self.head, 409))
        self.write('server/unrelated.ts', 'export const unrelated = true;\n')
        candidate = self.commit('Unexpected product change')
        with self.assertRaisesRegex(self.checker.VerificationError, 'server/unrelated.ts'):
            self.checker.check_scope(self.repo, self.base, candidate, 409)
        self.assertFalse(self.checker.check_scope(self.repo, self.base, candidate, 410))

    def test_verifier_rejects_uncommitted_worktree(self):
        self.write(DOC, 'Uncommitted change.\n')
        with self.assertRaisesRegex(self.checker.VerificationError, 'uncommitted'):
            self.checker.verify(self.repo, self.base, self.head, 409)

    def test_cli_exits_nonzero_on_invalid_input(self):
        result = subprocess.run(['python3', str(CHECKER), '--base', 'HEAD', '--head', self.head,
                                 '--pull-request', '409'], cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertIn('FAIL:', result.stderr)
        self.assertNotIn('"result": "passed"', result.stdout)

    def test_rejects_control_characters(self):
        self.checker.check_text('Readable text.\n')
        with self.assertRaises(self.checker.VerificationError):
            self.checker.check_text('Hidden\x07control\n')

    def test_rejects_original_test6_overclaim(self):
        good = (ROOT / DOC).read_text(encoding='utf-8')
        self.checker.check_claims(good)
        line = next(line for line in good.splitlines() if '原 test 6' in line)
        bad = good.replace(line, '| 失效批次修復 | 原 test 6 定義 14k 修復及超額時隱藏；未證明超額 repair 可接續 |')
        self.assertNotEqual(good, bad)
        with self.assertRaisesRegex(self.checker.VerificationError, 'Test 6'):
            self.checker.check_claims(bad)


if __name__ == '__main__':
    unittest.main()
