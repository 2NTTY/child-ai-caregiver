# Proposed safe Actions-log receipt

Destination: the same exact validation job's existing GitHub Actions logs. No artifact, new service, permission or retention setting is added. Root must approve these public fields before remote use.

Prefix: `HF_TERMINAL_V1 `. JSON schema version: `preview-hf-safe-terminal-v1`.

A complete receipt allows only:
- Fixed repository, proposed branch and variant; 40-hex authenticated event/checkout SHA; 64-hex reviewed control/input/lock/source/assembly identities, sizes and counts; fixed source base. Expected input identities are labeled as reviewed-manifest expectations; separate assemblyObserved and finalSourceMatched booleans distinguish actual observations from planned inputs.
- Closed-enum workflow outcomes, stage IDs/statuses, active setup/product stage, bootstrap phase and numeric exit. No exception body is copied. Early guard/finalizer failure uses a minimal INCOMPLETE envelope with a fixed reason.
- Stage process numeric exit/duration, timeout, own process-group ID, bounded numeric observed/reaped IDs, reaping/lingering booleans, SIGTERM/SIGKILL only, sampled RSS and wait4 RSS with distinct scope labels. Host/job memory/disk observations are numeric and explicitly not a stage hard envelope.
- Validated test totals, including failed-stage numeric summaries; only suite ID and failed ordinal for test failure localization, never titles/assertion values.
- Compiler members normalized only after source bytes/hash match the manifest or actual regular-file membership in the freshly installed lock-bound dependency tree is verified. Every dependency symlink hop must stay inside admitted dependency trees; unknown/nonexistent members are omitted and prevent PASS. This preserves the complete count/list SHA and full direct-root coverage. Known TypeScript diagnostics retain only source-relative path, line, column and numeric TS code. Unknown text/path is discarded with a fixed count, never echoed.
- Validated pinned tool versions, expected package-specific dependency entry/package paths, actual package JSON/entry SHA256, Node/npm metadata hashes and installed-lock identity. Tool metadata name/version/hash must agree with the expected package recorded during setup and isolation; entries cannot cross package boundaries. The actual hidden installed lock and setup/isolation identities must match before any dependency path is admitted.
- The three required Harbour semantic filenames, validated JSON byte counts and content hashes. Semantic contents are not printed. Other portable evidence directories must be empty.
- Bundle file count/total bytes and validated census hash only. No output filenames, contents, maps or executable assets are printed. Bundle publication and Harbour compiled admission remain OPEN.

Caps:
- JSON input object: 4 MiB; private raw stage log read: 32 MiB (supervisor already bounds it), safe diagnostic scan: first 256 KiB.
- Compiler: 20,000 members; each admitted relative member at most 256 ASCII characters, no controls, traversal or unknown source/dependency root.
- At most 64 safe TypeScript diagnostics and 64 failed ordinals per stage; up to 128 numeric process IDs; up to 8 known terminating signals.
- Tool entry hashing: at most 64 MiB per file, streamed; excess is incomplete evidence.
- Required zero exits and external-route counts use exact integer typing; false/null/string/float cannot substitute.
- Entire public receipt: 1 MiB. Any required complete compiler/evidence field lost to a cap produces INCOMPLETE, never PASS; receipt size fallback also exits nonzero. Diagnostic-only truncation is marked and cannot upgrade a failure.

A PASS requires all mandatory setup/process results, correct event/checkout/admission identity, source/lock identities, full compiler scope, every original forms/runtime case result, Harbour evidence, export census, final source match and complete terminal summary. Missing/inconsistent mandatory fields cannot be a PASS. The finalizer revalidates controls and discards arbitrary scratch strings. It does not `cat` raw files or serialize exceptions/environment/source contents.

This is evidence serialization and localization, not evidence that the real workflow ran. Local tests use explicitly synthetic temporary receipt fixtures. If cancellation, service termination or an unstarted finalizer prevents emission, the parent must treat absence of a valid receipt as incomplete, not successful persistence.

## Optional locked-install code observation

`lockedInstallDiagnostic` is null except when the locked-install stage has a failed process with an exact integer nonzero exit. Its only fields are:
- `scope`: fixed `observed-npm-code-not-root-cause`.
- `status`: `recognized`, `unknown`, `ambiguous`, `unavailable`, or `truncated`.
- `code`: null or one of `EUSAGE`, `ERESOLVE`, `EINTEGRITY`, `EFBIG`, `ENOSPC`, `EACCES`, `EPERM`, `ENOENT`, `E401`, `E403`, `E404`, `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, `EAI_AGAIN`.

The finalizer reads only the existing private locked-install output.raw through the existing regular-file/symlink/32 MiB bound, and requires its bytes and SHA256 to equal the supervisor's fixed-name rawLog identity. Missing, malformed or mismatched evidence is unavailable. A log over the 256 KiB scan cap is truncated and no code is emitted. For a log within that cap, only a single complete exact ASCII `npm error code CODE` line may be recognized, and the log must end in a newline. Repeated, conflicting or additional unknown code-marker lines are ambiguous. All other content is discarded. Unknown is not a cause classification.

Recognition means only that the private log contained one admitted npm code label. It does not establish which npm internal phase failed, identify a package, or establish a root cause. No raw message, tail, URL, package identity, path or environment value is emitted. This optional observation does not affect stage success, evidence completeness, terminal reason, or terminal exit code. Installation flags, environment, lifecycle policy, process limits and product commands are unchanged.
