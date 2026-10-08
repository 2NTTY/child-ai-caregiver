# 036 receipt relation validation

## Result

All 19 targeted SQL checks passed at 2026-10-08 15:02:49 UTC on PostgreSQL 17.11, using its official single-user mode against a new private synthetic cluster. The original 036 migration bytes were used without modification. PostgreSQL exited with code 0; the driver verified every expected named assertion in order and exactly one final success marker, with no uncaught `ERROR`, `FATAL`, or `PANIC`. `single-user-summary.json` is the machine-readable result, `single-user-results.log` contains raw PostgreSQL output, and `single-user-environment.log` records commands, version, and hashes. `single-user-cleanup.log` records removal of the temporary cluster after the foreground backend exited.

No TCP fallback, permission escalation, installation, system change, real data, model call, or cloud resource was used. The single-user process reads SQL directly from stdin without creating a socket or listener. This is single-connection relational SQL evidence, not concurrency, lock-competition, permissions, or application-runtime evidence.

## Preserved prior attempts

- `attempt-1-blocked/`: `initdb` succeeded, but the sandbox rejected the private Unix socket with `Operation not permitted`; PostgreSQL shut down before fixture/migration SQL ran. The cluster was removed. No socket operation was retried and no TCP fallback was attempted.
- `attempt-2-harness-stopped/`: single-user execution performed DDL rollback/commit and catalog checks, then the runner's `exit_on_error=on` promoted the first expected FK error to `FATAL`, preventing SQL's exception handler from validating it. The batch stopped immediately and its cluster was removed. This was a harness configuration failure, not evidence of a defective migration. Those logs and generated SQL are preserved.
- The authorized final attempt changed only the runner: `exit_on_error=off`, `log_min_messages=notice`, and a stdin driver that waits for each backend prompt and refuses to send further SQL after an uncaught error. The migration, fixture, and 19 assertions were unchanged. All checks then passed.

## Scope

This is the original migration 036 against a deliberately minimal synthetic parent schema. `agent_runs` contains only its identifiers, owner/child parent references, and migration 025's composite unique key. `family_document_operations` reproduces migration 028's table columns and constraints. The synthetic `user` and `children` parents contain only primary keys. The `yb1.synthetic-*` strings are fabricated check-compatible placeholders, not product encryption evidence.

The 19 checks cover transactionally rolling back and committing 036; preservation of prior operation rows; both receipt uniqueness keys; independent owner, child, and missing-parent foreign-key rejections; allowed/rejected tools; duplicate operations; the product store's exact `ON CONFLICT(owner_user_id,op_id) DO NOTHING` conflict target; retention of the original receipt on retries; operation/receipt rollback; and deletion cascades from either parent. Expected rejection tests validate SQLSTATE and constraint identity before emitting `PASS`: FK `23503`, uniqueness `23505`, and tool check `23514`. A conflicting retry's post-insert application check remains the responsibility of the product tests: SQL verifies it cannot overwrite the original link, not that PostgreSQL itself raises the application `document_receipt_scope_changed` error.

This establishes only 036's relational mechanics on the recorded PostgreSQL version. It is not a 001-035 migration run, a complete application schema/store integration test, a PostgreSQL 18 validation, a production database test, a full encrypted document mutation test, or a Firestore migration validation. No repository source or migration was modified.

## Reproduce the executed single-user validation

```sh
./run-single-user-validation.sh ../source/server/migrations/036-agent-document-operations.sql
```

This runner creates its own fresh private `0700` cluster, expands psql-only directives into native SQL without changing the assertions, submits one command at a time to PostgreSQL, verifies all 19 named results and the final marker, then removes only its own cluster. It does not connect to an existing database. The SQL input is retained as `single-user-input.sql`. A compatible existing official installation can be used with `PG_BIN` and `PG_SHARE` environment variables instead of the unpacked binaries.

Single-user mode and its statement boundaries: https://www.postgresql.org/docs/17/app-postgres.html

Error-handling configuration: https://www.postgresql.org/docs/17/runtime-config-error-handling.html

## Optional socket runner for a permitted local environment

`run-validation.sh` initializes a brand-new temporary cluster, starts only a private Unix socket in a `0700` directory with no TCP listener, applies the minimal fixture, runs the original migration and assertions, and stops/removes only its own temporary cluster on exit. It writes version/hash/setup/results/cleanup evidence to this directory. It must not be run against an existing database.

Run with the downloaded local binaries:

```sh
./run-validation.sh ../source/server/migrations/036-agent-document-operations.sql
```

Or point at an existing compatible official PostgreSQL installation without installing anything:

```sh
PG_BIN=/absolute/path/to/postgresql/bin PG_SHARE=/absolute/path/to/postgresql/share \
  ./run-validation.sh /absolute/path/to/036-agent-document-operations.sql
```

The initial blocked attempt is preserved under `attempt-1-blocked/`; root-level logs are the latest runner attempt. The runner requires Unix sockets to be allowed. Do not change transport or escalate permissions to evade a denied action.

## Official package provenance

Debian Trixie amd64 packages were downloaded directly from the official Debian archive and unpacked into `pgroot/` with `dpkg-deb -x`, without executing installation hooks or modifying global state. Official SHA-256 values were checked before running the binaries. Existing system shared libraries satisfied dynamic loading; no dependency package was downloaded.

- Server: https://packages.debian.org/trixie/amd64/postgresql-17/download
  - https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-17_17.11-0+deb13u1_amd64.deb
  - SHA-256: `d2ce1ddffafa783f9acda4c92c86fc21e8288bff3782d739294f14fa797d7886`
- Client: https://packages.debian.org/trixie/amd64/postgresql-client-17/download
  - https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-client-17_17.11-0+deb13u1_amd64.deb
  - SHA-256: `9d8558f8dd57c8e92e218a20698383575d53742ca3f9e7c2b7fe5f246d5216ae`

Initial commands:

```sh
curl -fL --max-time 60 https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-17_17.11-0+deb13u1_amd64.deb -o packages/postgresql-17_17.11-0+deb13u1_amd64.deb
curl -fL --max-time 60 https://deb.debian.org/debian/pool/main/p/postgresql-17/postgresql-client-17_17.11-0+deb13u1_amd64.deb -o packages/postgresql-client-17_17.11-0+deb13u1_amd64.deb
sha256sum -c packages/SHA256SUMS
for file in packages/*.deb; do dpkg-deb -x "$file" pgroot; done
ldd pgroot/usr/lib/postgresql/17/bin/postgres
ldd pgroot/usr/lib/postgresql/17/bin/psql
pgroot/usr/lib/postgresql/17/bin/postgres --version
pgroot/usr/lib/postgresql/17/bin/psql --version
./run-validation.sh
```
