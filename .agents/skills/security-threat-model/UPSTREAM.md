# Upstream provenance

- Source: [openai/codex-security/plugins/codex-security](https://github.com/openai/codex-security/tree/8ed8d9dffc766343c8534601286dc5980afcb1c8/plugins/codex-security)
- Pinned commit: `8ed8d9dffc766343c8534601286dc5980afcb1c8`
- Checked and modified: 2026-10-26
- License: Apache-2.0; original full text retained in [LICENSE](LICENSE).
- Status: **project adaptation, not an official unmodified install**.
- Scope, choices and validation: [report](../../../docs/SKILLS_INSTALLED.md).
- Original and installed hashes/source mapping: [manifest](../../../docs/SKILLS_INSTALLED.json).

This adapts only `skills/threat-model/SKILL.md` and
`references/threat-model.md` from the newer canonical repository. The local entry
is named `security-threat-model` for the selected project capability; it is not
the legacy openai/skills implementation or a full Codex Security installation.
The 2026-10-26 pinned main source was deliberately selected rather than the older
plugin-catalog 0.1.32 snapshot. Source maps are explicit in the manifest.

Preserved: source-grounded consumers/configuration/mounts/effective authority,
hypotheses versus validated findings, risk-based independent architecture review,
scope and coverage gaps. Adapted: local name, project authority and role limits,
read-only analysis, normal document output. Omitted: artifact MCP/storage/cache
and scan checkpoint contracts, scanners, daemon/model workers, all executable and
plugin/runtime integration files. No fixed reviewer or threat count is imposed.

Selected original source files are retained byte-for-byte as `upstream/*.txt`
(including nested references); they are provenance data, **not active instructions**.
[UPSTREAM.patch](UPSTREAM.patch) records every selected-source adaptation and
rebuilds the active Markdown from those originals. Only the top-level `SKILL.md`
is an installed entry. All added text files are non-executable; no hooks, plugin
manifest, MCP, global settings or auto-updater are installed.
