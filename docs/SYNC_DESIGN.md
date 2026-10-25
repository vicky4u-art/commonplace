# Synchronization and data protection

## Schema and security

`cp_projects`, `cp_tasks`, `cp_subtasks`, `cp_notes`, `cp_task_notes`, `cp_audio` and `cp_workspaces`
use `user_id` ownership. Composite foreign keys include the owner, preventing cross-account project,
task, note or audio references. Every table enables RLS with `auth.uid() = user_id` in both `USING`
and `WITH CHECK`. Anonymous roles have no table/RPC access. RPC functions run as SECURITY INVOKER
with an empty search path. Ownership comes from the session, never a submitted owner parameter.

Entity `data` JSONB retains original IDs, timestamps, rich-text content and metadata without a lossy
rewrite; generated columns expose titles, content, completion and parent IDs for SQL. Subtasks and
links are stored as separate relational rows. Subtask position is explicit. Row `updated_at` records
server commit time; original client timestamps remain in `data`. No client clock determines a winner.

The `commonplace-audio` bucket is private. Objects are immutable at
`<user-id>/<encoded-audio-id>/<sha256>`; authenticated users can only insert/read their own prefix.
No public URLs, object replacement or automatic purge policies exist. The bucket allows 50 MB per file.
Audio is downloaded through authenticated requests, verified, then cached in owner-namespaced IndexedDB.

## Reliable writes and predictable conflicts

1. Each edit synchronously persists `{base, state}` to an owner-specific localStorage key.
2. A 700 ms debounce triggers sync; reconnect/focus and a 15-second foreground poll also retry.
3. `cp_read` reads the full account in one SQL snapshot. It avoids REST table pagination limits.
4. A three-way merge compares base, local and cloud by stable entity ID. Changes to distinct entities
   merge automatically. A task is one conflict unit including its ordered subtasks and note links.
5. Same-entity edits or edit-vs-delete conflicts pause uploading. Settings offers a download of both
   versions and explicit local/cloud choices. If the merge leaves broken relationships, the selected
   whole workspace is used. Recovery copies are written before either version is replaced.
6. `cp_commit(expected_revision, document)` locks the workspace row and checks its revision. A stale
   revision writes nothing. Otherwise all records/relationships are replaced **within one transaction**;
   any constraint failure rolls back everything. This deliberately simple snapshot transaction fits a
   small personal workspace, but should become incremental if the app grows to large datasets.
7. The response is compared with the submitted snapshot. New edits typed during an in-flight request
   remain queued. An interrupted response can safely be retried; no append-only operation creates duplicates.

Only one editing tab per origin/browser profile is allowed using Web Locks; another tab asks the user
 to close the first and reload. Different devices/browsers can edit concurrently. Current Safari/Chrome
support this on HTTPS. No editing is allowed while a first cloud read or import is incomplete. Cached
accounts can edit during temporary network failures. Sync does not overwrite an idle focused editor
with a remote update; it waits for editing to finish. Same-item simultaneous edits are not CRDT merged.

## Local storage and account separation

- `commonplace.v1`: original local workspace. Cloud saves never write to it.
- `commonplace.legacy.original`: exact original text snapshot captured before first migration.
- `commonplace.cloud.v1.<user-id>`: cloud base and durable pending state; retained through logout.
- `commonplace.migrated.<user-id>`: verified legacy source fingerprint.
- `commonplace.recovery.<user-id>.<timestamp>`: retained pre-import/conflict versions, exportable in Settings.
- IndexedDB `commonplace-audio` / `recordings`: original audio keys remain unchanged; cloud keys are
  `<user-id>:<audio-id>` and restore staging keys use a temporary namespace.

Sign-out clears rendered account data, including an open editor/modal, and stops synchronization. It does
not erase the original data or durable pending edits. A different account cannot load the previous
account's queue. Browser caches are not encrypted against someone with access to the same OS/browser
profile or developer tools; use a private device/profile. This is not end-to-end encryption.

If local storage fills up, edits stay in memory, sync pauses and a prominent NOT SAVED status appears.
Export before leaving, free space and retry. Browser eviction/site-data clearing can destroy unsynced
changes; no static app can guarantee durability if its local storage is removed.

## Migration and backups

Import is additive and idempotent by ID. Identical IDs/content are accepted; differing cloud records
require explicit replacement confirmation. The cloud revision is checked again atomically to prevent
races after that confirmation. Audio upload precedes row commit and is downloaded to verify its checksum.
Missing audio aborts the import. Successful migration requires full data readback and preserves all
original local records/recordings. Partial audio uploads may remain as unreferenced private objects;
this favors recovery over automatic deletion. The UI's explicit import action can re-import retained
records that were subsequently deleted in cloud; the app never silently re-imports them on login.

Cloud JSON restore uses the same merge/confirmation workflow and preserves IDs. Rich text is sanitized
at rendering/editing/restoration boundaries. Recovery archive downloads contain named local/cloud/incoming
snapshots; a maintainer can wrap a chosen snapshot in `{ "data": snapshot }` for restoration. Audio
metadata in a recovery archive is not a standalone audio backup; use the full JSON backup for that.

## Verification performed

`npm run check` runs original-UI tests in DOM instances, sync tests with deterministic network/storage
failures, and real PostgreSQL tests via PGlite. Live Supabase SQL checks also exercise roundtrip,
completed subtasks, stale revisions and cross-user read/write denial in a rolled-back transaction.
Security advisor: no findings. New relationship indexes are currently reported as unused (expected
before real traffic; retain them for foreign-key lookups). No production personal data was used in tests.
