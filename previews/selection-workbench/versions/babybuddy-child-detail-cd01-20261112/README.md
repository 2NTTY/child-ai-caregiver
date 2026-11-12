# CD01: Baby Buddy Child Detail reference backup

This independent source backup preserves a complete, local-only UX/UI reference candidate. It is not a product selection, integrated workbench release, production feature, or hosted publication. No PR or merge is part of this backup.

## Exact source and scope

- Baby Buddy commit: `f02f28b7f96f8bb1b9a0212a377c327ce33e7699`, 2017-10-28 03:20:52 UTC, package version 0.1.0.
- Page: `core/templates/core/child_detail.html`, blob `58e31585e1627a0cb83c7dc5a2b8828605328eb4`.
- Synthetic fixture: `core/tests/tests_models.py`, ChildTestCase.test_child_create, blob `489578405b9180b9404c01ee9cd46bc618cbf31a`.
- Original source license: BSD-2-Clause, Copyright (c) 2017, Baby Buddy's Contributors. Full conditions/disclaimer in `upstream/LICENSE` and `public/licenses/BabyBuddy-BSD-2-Clause.txt`. Vendor notices also retained.
- Candidate entry: `public/child-detail.html`; `public/index.html` is byte-identical. HTML SHA-256 `11c4357acaef427c590ccc63c2a33682b7ed1ef01a8a7f8f390759b4af7c59a0`.
- Public freeze: 24 files, 1,476,128 bytes; 23 content entries plus SHA256SUMS. Seal file SHA-256 `63460e4aed3c64a9c13aefdb9db6365d21b262b372f27d683e66dc0f7446431f`.

The page is the original nav, breadcrumb, jumbotron, name/birth-date/age and Dashboard/Reports/Edit/Delete icon entrances. Reports retains its five source items. No health record, extra fields or redesigned destination is added. It is distinct from the earlier C-03 Dashboard.

First Last, first-last and same-day birth_date come from the upstream synthetic test. Fixed clock: 2017-10-28 UTC midnight, yielding the original timesince display 0 minutes. Caregiver is a synthetic non-staff user, timers are empty, and ordinary permissions are presentation flags only. Routes have no href and are disabled. There is no backend, model call, real family data, persistence or external resource binding. Static CSP/resource closure is not measured zero-egress evidence.

## Verification and limits

Independent source/static review accepted this exact draft scope: 21/21 upstream identities, 23/23 public seal entries, 6/6 static checks, 8/8 custom-adapter VM branches and JS syntax. A separate bounded browser review observed desktop 1180 x 757, source page display, four visible icon glyphs, Reports five-item click/Enter/Escape, and representative disabled routes without navigation. Three unchanged synthetic page-only screenshots are included. See `review/` for the two bounded review records.

The immutable product manifest still says browser_verified=false because it predates the independent browser review. Do not silently update that file or interpret the later report as full frontend acceptance.

No mobile, breakpoint/collapse matrix, other nav dropdowns, complete focus/screen-reader, cross-browser, full vendor security or measured request trace acceptance. Edit/Delete keyboard behavior remains unverified. Source-native Timer actions label and unnamed icon controls are known preserved accessibility defects. Font status inspection was unavailable, and a disabled Edit locator timed out; the report retains these limits. No original Child Detail screenshot was reviewed, so there is no pixel-equivalence claim.

Rendering uses Django 5.2.8/Python 3.12.14, not original Django 1.11.6; the reused source-theme CSS was compiled with libsass 0.23.0 rather than original gulp/node-sass. Historical dependencies are retained solely for isolated reference, not recommended production dependencies. No original application server/models/database ran.

## Restore and verify

Restore this version into a separate directory; do not overwrite a newer checkout. `FILES.json` records the backup files. `public/SHA256SUMS` is the exact reviewed product seal. Twenty unchanged runtime/template/license/package source files, the static renderer, fixture, tests and minimal source evidence are included. The upstream historical README is omitted because its demo-login/deployment instructions are unrelated to this reference; its exact blob/hash remain in source-manifest-original.json. The backup source-manifest.json lists the 20 present files and explicitly records that omission. This does not alter the 24-file reviewed product or claim that 21 source files are redistributed. No virtual environment, dependency installation, hosting configuration, private tool responses, conversation records or credentials are included.

With Python and Django 5.2.8 already installed:

```sh
python tools/render.py
python -m unittest discover -s tests -v
node tests/test_readonly.cjs
node --check public/assets/readonly.js
(cd public && sha256sum -c SHA256SUMS)
```

Rendering needs only the preserved local assets; it does not rebuild vendor CSS or contact an API. The historical source package/Pipfile locks are provenance, not an instruction to install or execute the old application.
