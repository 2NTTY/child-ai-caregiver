"""Render exact upstream templates with a fixed synthetic context and no server."""
from datetime import date
import hashlib
import json
from pathlib import Path
import re
from types import SimpleNamespace

from django.conf import settings
from django.template import Context, Engine
import fixture_tags

ROOT = Path(__file__).resolve().parents[1]
UP = ROOT / 'upstream'
PUBLIC = ROOT / 'public'

class Named(SimpleNamespace):
    def __str__(self):
        return self.name

def render():
    settings.configure(USE_I18N=False, USE_TZ=True, TIME_ZONE='UTC', LANGUAGE_CODE='en-us')
    fixture_tags.FIXTURE = f = json.loads((PUBLIC / 'fixture.json').read_text())
    templates = {}
    for group in ['babybuddy', 'core']:
        for p in (UP / group / 'templates').rglob('*.html'):
            key = str(p.relative_to(UP / group / 'templates'))
            text = p.read_text()
            # Keep route identity for review, never a navigable href or live path.
            text = re.sub(r"{% url '([^']+)'[^%]*%}", lambda m: '#preview-route/' + m[1], text)
            text = text.replace('{% load static %}', '').replace('{% load static timers %}', '{% load timers %}')
            if key == 'babybuddy/base.html':
                text = re.sub(r'    <link rel="(?:apple-touch-icon|icon|manifest|mask-icon)"[^\n]+\n', '', text)
                text = re.sub(r'    <meta name="theme-color"[^\n]+\n', '', text)
                text = text.replace('{% static "babybuddy/css/app.css" %}', 'assets/css/app.css')
                text = re.sub(r'    <link rel="stylesheet" href="{% static "babybuddy/css/vendor.css" %}" />\n', '', text)
                text = text.replace('<script src="{% static "babybuddy/js/vendor.js" %}"></script>', '<script src="assets/jquery.min.js"></script>\n    <script src="assets/popper.min.js"></script>\n    <script src="assets/bootstrap.min.js"></script>')
                text = text.replace('{% static "babybuddy/js/app.js" %}', 'assets/readonly.js')
                csp = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-src 'none'"
                text = text.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n    <meta http-equiv="Content-Security-Policy" content="' + csp + '">')
            templates[key] = text
    engine = Engine(loaders=[('django.template.loaders.locmem.Loader', templates)], libraries={'timers': 'fixture_tags'}, builtins=['fixture_tags'])
    context = Context({
        'object': Named(name=f['child']['name'], slug=f['child']['slug'], birth_date=date.fromisoformat(f['child']['birth_date'])),
        'perms': {'core': f['permissions']},
        'request': SimpleNamespace(path='/children/first-last/', user=Named(**f['user']), resolver_match=SimpleNamespace(view_name='child-detail')),
    })
    html = engine.get_template('core/child_detail.html').render(context)
    html = html.replace('href="/"', 'href="#preview-route/home"')
    html = re.sub(r'href="#preview-route/([^\"]+)"', lambda m: 'data-preview-route="' + m[1] + '" aria-disabled="true" tabindex="0" title="Static reference only; destination is disabled"', html)
    # Original dropdown links remain local toggles; no hash navigation when JS is unavailable.
    html = html.replace('href="#"', 'tabindex="0"')
    (PUBLIC / 'child-detail.html').write_text(html)
    (PUBLIC / 'index.html').write_text(html)
    print('Rendered exact child_detail template hierarchy with fixed synthetic fixture.')
    print('child-detail.html SHA-256:', hashlib.sha256(html.encode()).hexdigest())

if __name__ == '__main__':
    render()
