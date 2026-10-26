# Upstream provenance

- Source: [openai/skills/skills/.curated/security-best-practices](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices)
- Pinned commit: `49f948faa9258a0c61caceaf225e179651397431`
- Checked and modified: 2026-10-26
- License: Apache-2.0; original full text retained in [LICENSE](LICENSE).
- Status: **project adaptation, not an official unmodified install**.
- Scope, choices and validation: [report](../../../docs/SKILLS_INSTALLED.md).
- Original and installed hashes/source mapping: [manifest](../../../docs/SKILLS_INSTALLED.json).

This preserves the legacy coding library (entry and all 10 references). The source
repository was deprecated at this pin; it is not a maintained CVE feed. Active
references add scope/version and evidence/severity calibration notices. The React
redirect rule replaces a demonstrably unsafe leading-slash regex with a contextual
parsed-URL policy and synthetic regression; the unchanged original remains below
`upstream/`. No frontend design skill or agent metadata is installed.

Selected original source files are retained byte-for-byte as `upstream/*.txt`
(including nested references); they are provenance data, **not active instructions**.
[UPSTREAM.patch](UPSTREAM.patch) records every selected-source adaptation and
rebuilds the active Markdown from those originals. Only the top-level `SKILL.md`
is an installed entry. All added text files are non-executable; no hooks, plugin
manifest, MCP, global settings or auto-updater are installed.
