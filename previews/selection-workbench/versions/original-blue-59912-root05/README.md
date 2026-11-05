# Original blue Care preview, reconstruction05

An expanded static preview reconstructed from [commit59912](https://github.com/2NTTY/child-ai-caregiver/commit/59912bd1f79dae120d393f66f944e4241ee483cb), tree `aec1c9a4d90ce3162279da864adea7fd90405f07`. This is **not the original sealed v92 release archive**. The original renderer and visual design are retained. The explicit synthetic owner/entry adapter and provenance packaging are reconstruction additions.

## Run locally

From this version directory, run `python3 -m http.server 8000 --directory static`, then open `http://localhost:8000/`. Use an HTTP server, not `file://`. A GitHub HTML file is not a deployed page.

Mount: the HTTP root. Do not put these root-relative files under an arbitrary workbench subpath. The HTML and bundle belong together; do not mix this version with the other mount variant.

## Synthetic boundary

Only synthetic examples and selected read-only fixture responses are available. Unsupported reads return 503; saves, sends, real models, account operations, device actions and persistent storage are unavailable or refused. They must not be presented as successful operations. No real family data, photos, messages or credentials are included. The original Admin origin-based `/login` behavior remains a limitation of prefix use.

The notice is a normal-flow row. Revision 05 adds clipping only to the app's allocated root area, keeping the original skip-to-main control enabled. All JavaScript, bundled CSS and assets are unchanged by this notice correction.

## Bounded acceptance

Tested locally at a real 1180×757 desktop viewport and separate 320×700 / 390×700 **CSS iframe** widths. The two notice/navigation failures were replayed and closed. The check included real keyboard Tab/Enter to skip-to-main, the information drawer, main content scrolling, home/tasks/profile, direct-route hard reload, Back/Forward and the brand-home link.

These are not true top-level narrow-device tests, a four-size matrix, a full assistive-technology/accessibility audit, native acceptance or complete site acceptance. Real existing Site paths, retained files and service workers still need integration verification. A path prefix is not a separate-origin sandbox. No deployment or merge to master is represented by this payload.

## Actual synthetic screenshots

- [Home](screenshots/home.png)
- [Tasks](screenshots/tasks.png)
- [Profile](screenshots/profile.png)

See [machine-readable provenance and limits](provenance.json) and [the exact file allowlist](files.json). Run `python3 verify.py` for read-only integrity, resource-link and ordinary-HTTP-handler checks. The verifier does not start a server or browser.
