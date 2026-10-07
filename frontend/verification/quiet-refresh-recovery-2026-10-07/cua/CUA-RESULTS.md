# Quiet refresh synthetic CUA acceptance — 2026-10-07

Artifact: existing public QA Site v50, source `e0579ef414bba2740e169d4cc824972f1c9a8a0a`, successful deployment `appgdep_6ac61b37c89c8191a616ac85344228b7`.

Runtime source tree SHA256: `37ec92108e1b234e3198b58e56bf27cf51570a73e18225ba11558715c01f249e`.

Testing used the cloud browser, its same-origin iframe size harness, and an explicitly synthetic transport. No production API, real model, family data, or write was exercised. All unlisted endpoints and write methods were locally rejected. The fixture was artifact-only; no runtime data-source architecture was added.

## Observed checks

- Slow first visit: launch gate appeared before populated single-child Home; no misleading empty screen in sampled states.
- Care at 1440, 1024, 390, and 320 CSS pixels: document clientWidth equaled scrollWidth. Saved record and pending candidate remained visible.
- Care slow refresh at 320: zero `read-state-loading` elements; existing record and candidate retained, original busy controls disabled.
- Care transient failure: saved record remained; one short visible stale warning and one retry. The hidden live-region copy is not a second visible notice. Retry was operable; normal synthetic reading restored content.
- Tasks at 1024: coherent tablet layout. Slow refresh retained the row/count and exposed no loading notice; original controls were disabled while reading.
- Growth at 390: no horizontal overflow; switch from synthetic child Ming to Ching removed the previous child heading (count 0), revealing only the new child heading (count 1).
- Summary at 320: no horizontal overflow; the contextual period editor exposed Apply Period. Activating it showed zero loading elements and zero successful-reload banner.
- Care successful empty read removed the old saved row and search control; exactly one ordinary empty label remained.
- Simulated access denial cleared the selected child and scoped records, then showed the choose-authorized-child state. Restored fixture normal mode and reloaded the app after testing.

## Scope and limits

These are representative screen/interaction checks plus DOM geometry, not an exhaustive end-to-end matrix. First-load and switching motion were sampled, not recorded frame by frame. Reduced-motion and status-live-region lifecycle are covered by the fresh automated tests; no OS-level reduced-motion browser toggle was performed. Accessibility-tree labels and state were inspected, but no screen-reader software or continuous animation recording was run. Pending-agent reconciliation and first-offline cases are covered by owner regression tests; the synthetic online-refresh event does not refresh every owner.

The existing QA wrapper's dimension caption continues to say height 900 after selecting height 600; actual iframe size was controlled separately. At 900 high (or wider than the cloud window), the synthetic panel can be out of view; the existing 600-high/1024-wide controls made it operable. Its fixed synthetic badge overlaps part of the mobile bottom navigation and is not product runtime UI. Route navigation in that situation used the unobstructed wide sidebar. No runtime blocker was found in the checks above.

## Fresh automated evidence

- Combined regression set: 85/85 pass after environment recovery
- Independent review rerun: 49/49 plus typecheck and diff check
- Typecheck exit 0
- Production-mode Expo web export exit 0, 35 routes
- Fixture contract validation passed, zero actual API requests
- Evidence predating the environment reset was not reused as proof of these passes

Screenshots in this folder are original CUA JPEGs. Hashes are recorded in `screenshots.json`; no image editing was applied.
