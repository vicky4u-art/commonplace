# Commonplace

Mobile-first personal tasks and notes at **https://vicky4u-art.github.io/commonplace/**.
The original vanilla-JavaScript UI and GitHub Pages hosting are preserved.

## Architecture

- `app.js`: existing dashboard, capture, tasks/subtasks, rich notes, projects, search, voice and backup UI.
- `src/model.mjs`: validation, stable-ID additive import and three-way entity merge.
- `src/sync.mjs`: durable local queue, account separation, atomic cloud saves, migration and audio verification.
- `src/cloud-entry.mjs` → `vendor/cloud.js`: pinned Supabase SDK and sync code, bundled locally (no runtime CDN).
- `cloud-config.js`: **public** URL/publishable key only. Never add a secret/service-role key.
- `supabase/migrations/20261025182236_cloud_sync.sql`: relational schema, ownership RLS, transactional RPCs and private audio bucket.
- `docs/CLOUD_SETUP.md`: deployment configuration and manual acceptance steps.
- `docs/SYNC_DESIGN.md`: conflict, offline, migration and recovery behavior.

## Development

Requires Node.js 22 or later. Run `npm ci`, `npm run build`, then `npm run check`.
Serve the repository root over HTTPS or localhost. Commit `vendor/cloud.js` after changing sync source.
GitHub Pages serves `main` / repository root directly; no server or paid hosting is required.
The local `dist/` directory, when present, is an ignored preview copy, not the deployed source.

## Features retained

Dashboard, shared Inbox, quick capture, tasks and ordered subtasks, rich-text notes/checklists,
project assignment, two-way task/note links, task creation from selected note text, voice,
search, JSON backup/restore including audio, and installable/offline app shell.

## Current rollout status

The Supabase project, schema and private bucket are provisioned. The database has passed
live transactional and ownership checks. Authentication URL configuration and a real email
sign-in / iPhone-to-desktop acceptance test still need to be completed. **Do not consider
existing browser data migrated until the in-app import explicitly reports verification.**

The original `commonplace.v1` and `commonplace-audio` recordings are retained. Cloud saves use
an account-specific cache; importing never automatically erases the legacy workspace.
