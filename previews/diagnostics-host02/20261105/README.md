# Host02 diagnostic footer: exact HTML patch preservation

This packet preserves a narrowly scoped, locally accepted Care/Handbook host-layout correction. It is **not a runnable preview, a complete application source archive, a new application build, or a deployment**.

The local synthetic diagnostic panel previously used fixed positioning and could cover bottom navigation. The two exact HTML outputs place that panel in normal document flow. The application root remains shrinkable, while the original diagnostic disclosure, scrolling and safety controls stay in the unchanged JavaScript.

## Included and excluded

- `before/` contains the two exact parent HTML inputs.
- `after/` contains the two exact browser-checked host02 HTML outputs.
- `host-layout.patch` reproduces those outputs with a standard unified patch.
- `HOST-PROVENANCE.json` records the complete parent artifact hash lists, the local source/dependency manifest identities, and the before/after HTML identities.
- `ACCEPTANCE.md` states the actual limited checks and the remaining gaps.
- `SHA256SUMS` covers every other file in this packet.

The required JavaScript, CSS assets, images, fonts, source maps, full source closures, installed dependencies and raw browser/tool records are **not included**. Opening `after/*/index.html` by itself will not run the application. Full candidate source closures were verified locally, but this packet does not assert that a public remote commit can reconstruct them. The Git base commit only provides an isolated place to preserve the patch, not the historical bundle's source identity.

## Reproduce the HTML change

Run from this packet's directory, with standard POSIX tools and GNU patch:

```sh
sha256sum -c SHA256SUMS
work="$(mktemp -d)"
cp -R before/. "$work/"
patch --batch --forward --fuzz=0 -p1 -d "$work" < host-layout.patch
cmp "$work/care/index.html" after/care/index.html
cmp "$work/handbook/index.html" after/handbook/index.html
```

These commands only copy the included HTML inputs into a new temporary directory, apply the patch there, and compare exact bytes. They do not fetch dependencies, launch the application, contact a backend, or validate the full application. Leave the original `before/` and `after/` files unchanged.

## Boundaries

Only the known inline layout CSS changes. All other HTML bytes, including asset references, are retained. The original JavaScript/assets were byte-identical between the parent and the browser-tested local host derivative. The patch does not apply the separate runtime-source correction.

The correction concerns the local synthetic diagnostic host. It is not a finding that the public preview has this defect. The four-design/seven-condition acceptance remains open. No Site content, credentials, access permissions, production data, or existing preview version is changed by preserving this packet.
