# Bounded chat layout correction: public summary

Source: `e0a8fb1a153a4b379a87dae246bf5aef3878ce82`.
Prior candidate: `979219fa97532059afe0878c70433f06c23ffa7a`.

A real 320 x 600 CSS-pixel synthetic preview exposed a layout failure in the
prior candidate: the timeline grew with its history rather than having an
effective inner scroll range, leaving the latest messages and composer outside
the usable initial view. Private captures and raw observations are not included.

The correction measures the available workspace and the toolbar/composer in
logical layout units, then gives the page a finite height with a minimum reading
area. Long history no longer determines page height. Short space or an expanded
input may still require outer scrolling; controls are not hidden to mask it.
The same scope, DOM ownership, timeline refs, reading anchor, input state,
unknown-state and permission behavior remain in place.

Three synthetic layout/state tests plus existing history and journal tests
passed in a 12-test focused combination. The final broader combination passed
78/78 across 15 scripts and the full frontend TypeScript check. These counts
overlap and are not additive. `compare-owner.cjs` remains unchanged as source
verification tooling; it requires the prior comparison commit to be available.

The latest source/export correspondence and a bounded chat browser check passed.
This does not establish every layout size, zoom transition, history scenario,
heading, focus or assistive-technology case. Final broader browser QA remains
pending. No real backend/model, fixture mutation, deployment or merge is implied.
