"""Bounded draft checks. Missing output, altered source, live routes or extra fields must fail."""
import hashlib
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
COMMIT = 'f02f28b7f96f8bb1b9a0212a377c327ce33e7699'

def git_blob(data):
    return hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()

class Elements(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.elements = []
        self.feed(text)
    def handle_starttag(self, tag, attrs):
        self.elements.append((tag, dict(attrs)))

class ChildDetailChecks(unittest.TestCase):
    def page(self):
        self.assertTrue((PUBLIC / 'child-detail.html').is_file(), 'Child Detail draft not generated')
        return (PUBLIC / 'child-detail.html').read_text()

    def test_exact_source_and_fixture_provenance(self):
        self.page()
        manifest = json.loads((ROOT / 'evidence/source-manifest.json').read_text())
        self.assertEqual(manifest['commit'], COMMIT)
        for item in manifest['files']:
            self.assertEqual(git_blob((ROOT / 'upstream' / item['path']).read_bytes()), item['git_blob'], item['path'])
        for path, blob in [('core/templates/core/child_detail.html', '58e31585e1627a0cb83c7dc5a2b8828605328eb4'), ('core/tests/tests_models.py', '489578405b9180b9404c01ee9cd46bc618cbf31a'), ('LICENSE', '352afb93dd4c8e6627b162c341ca590ce7c4773b')]:
            evidence = json.loads((ROOT / 'evidence' / ('fetch-' + path.replace('/', '-') + '.json')).read_text())
            self.assertEqual(evidence['sha'], blob)
            self.assertEqual(git_blob((ROOT / 'upstream' / path).read_bytes()), blob)
            self.assertEqual(evidence['content'], (ROOT / 'upstream' / path).read_text())

    def test_whole_original_page_and_actions(self):
        h = self.page()
        self.assertIn('navbar navbar-expand-md navbar-dark bg-dark fixed-top', h)
        self.assertIn('class="breadcrumb"', h)
        self.assertIn('id="view-child-detail" class="container-fluid"', h)
        main = h.split('id="view-child-detail"', 1)[1].split('<script', 1)[0]
        self.assertEqual(main.count('jumbotron text-center'), 1)
        self.assertIn('class="display-3">First Last</div>', main)
        self.assertIn('Born <span class="text-secondary">Oct. 28, 2017</span>', main)
        self.assertIn('Age <span class="text-secondary">0\xa0minutes</span>', main)
        parts = ['icon-dashboard', 'id="reports-dropdown"', 'Diaper Change Types', 'Diaper Lifetimes', 'Sleep Pattern', 'Sleep Totals', 'Timeline', 'icon-update', 'icon-delete']
        positions = [main.index(p) for p in parts]
        self.assertEqual(positions, sorted(positions))
        self.assertEqual(main.count('class="dropdown-item"'), 5)
        self.assertEqual(main.count('btn btn-success'), 1)
        self.assertEqual(main.count('btn btn-warning'), 1)
        self.assertEqual(main.count('btn btn-danger'), 1)
        for extra in ['health', 'Weight', 'Height', 'Allerg', 'Immuniz', '<input', '<textarea', '<form']:
            self.assertNotIn(extra, main)

    def test_fixed_clock_and_synthetic_only(self):
        h = self.page()
        f = json.loads((PUBLIC / 'fixture.json').read_text())
        self.assertEqual(f['as_of'], '2017-10-28T00:00:00+00:00')
        self.assertEqual(f['child']['birth_date'], '2017-10-28')
        self.assertEqual(f['child']['name'], 'First Last')
        self.assertEqual(f['timers'], [])
        self.assertIn('caregiver', h)
        for other in ['Jamie Chen', 'Patricia Ochoa', 'health-record', 'Dashboard source-faithful']:
            self.assertNotIn(other, h)

    def test_no_navigation_or_data_connections(self):
        h = self.page()
        self.assertIn("connect-src 'none'", h)
        self.assertIn("form-action 'none'", h)
        self.assertIn("script-src 'self'", h)
        self.assertIn("frame-src 'none'", h)
        for tag, a in Elements(h).elements:
            self.assertNotIn(tag, ['form', 'iframe', 'input', 'textarea'])
            for key in ['src', 'href', 'action']:
                self.assertFalse(a.get(key, '').startswith(('http:', 'https:', '//', 'javascript:')), (tag, a))
            if tag == 'a':
                self.assertNotIn('href', a, 'No route anchor may navigate even when JavaScript is unavailable')
                if 'data-preview-route' in a:
                    self.assertEqual(a.get('aria-disabled'), 'true')
                    self.assertEqual(a.get('tabindex'), '0')
                else:
                    self.assertEqual(a.get('data-toggle'), 'dropdown')
        custom_js = (PUBLIC / 'assets/readonly.js').read_text()
        self.assertNotRegex(custom_js, r'fetch\(|XMLHttpRequest|localStorage|sessionStorage|WebSocket|sendBeacon|location\s*=')

    def test_assets_local_and_reused_without_changes(self):
        h = self.page()
        for tag, a in Elements(h).elements:
            for attr in ['src', 'href']:
                path = a.get(attr, '')
                if path and not path.startswith('#'):
                    self.assertTrue((PUBLIC / path).is_file(), path)
        css = PUBLIC / 'assets/css/app.css'
        for url in re.findall(r'url\([\'"]?([^\)\'\"]+)', css.read_text()):
            if url.startswith('data:'): continue
            self.assertFalse(url.startswith(('http:', 'https:', '//')), url)
            self.assertTrue((css.parent / url.split('?')[0].split('#')[0]).is_file(), url)
        for item in json.loads((ROOT / 'evidence/reused-assets.json').read_text()):
            self.assertEqual(hashlib.sha256((PUBLIC / item['path']).read_bytes()).hexdigest(), item['sha256'])

    def test_source_license_and_honest_status(self):
        self.page()
        m = json.loads((PUBLIC / 'manifest.json').read_text())
        self.assertEqual(m['source_commit'], COMMIT)
        self.assertEqual(m['source_app_version'], '0.1.0')
        self.assertEqual(m['source_template'], 'core/templates/core/child_detail.html')
        self.assertEqual(m['source_license'], 'BSD-2-Clause')
        for key in ['browser_verified', 'published', 'selected', 'implemented_frontend']:
            self.assertFalse(m[key])
        self.assertEqual((PUBLIC / 'licenses/BabyBuddy-BSD-2-Clause.txt').read_bytes(), (ROOT / 'upstream/LICENSE').read_bytes())
        for p in PUBLIC.rglob('*'):
            self.assertNotIn(p.suffix.lower(), ['.png', '.jpg', '.jpeg', '.sqlite3'])
        self.assertEqual((PUBLIC / 'index.html').read_bytes(), (PUBLIC / 'child-detail.html').read_bytes())

if __name__ == '__main__':
    unittest.main(verbosity=2)
