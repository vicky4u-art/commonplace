# Cloud setup and acceptance

Project: `Commonplace` (`jrqqcoftmvzbslohuutw`), US West, in `vicky4u-art's Org`.
Frontend stays at https://vicky4u-art.github.io/commonplace/ .

## Remaining dashboard settings

1. Open the project in the Supabase dashboard → Authentication → URL Configuration.
2. Set **Site URL** to `https://vicky4u-art.github.io/commonplace/`.
3. Add this exact **Redirect URL**: `https://vicky4u-art.github.io/commonplace/`.
4. Keep email authentication enabled and email confirmation enabled; leave anonymous sign-ins disabled.
5. For this personal app, sign up once with your intended email, then optionally disable new-user signups
   (existing users can still sign in). Do not disable email confirmation to work around delivery problems.
6. Supabase's default sender only sends to organization team-member email addresses and is rate-limited.
   If the login email differs, or delivery is unreliable, configure custom SMTP under Authentication → Emails.
   Enter the SMTP credential directly in Supabase, never chat or the repository. Default magic-link templates
   using `{{ .ConfirmationURL }}` work with this static application's implicit flow.

No secret is required in the frontend. `cloud-config.js` already contains the project URL and public
publishable key. Supabase Auth stores and refreshes a persistent session under `commonplace.auth`.
The email link should be opened in the browser you want to use. Only one editing tab per browser profile
is allowed; if the link opens a second tab, close the first Commonplace tab and reload the new one.

## Migrate the device with existing data

1. Open Commonplace **in the same browser/profile where the existing data was saved**.
   Another origin (e.g. an older ChatGPT/Railway URL), Safari profile or installed PWA has different storage:
   export its JSON backup there and restore it here instead.
2. Settings → Back up original browser data. Keep the downloaded JSON somewhere durable.
3. Sign in with your email. Cloud data loads separately; the original local workspace is not erased.
4. Settings → Import browser data. Existing IDs with different content trigger a separate replacement
   confirmation. Declining leaves cloud data unchanged.
5. Wait for **Migration verified**. This checks full normalized data readback and SHA-256 of audio.
   Missing audio or interrupted writes produce an error, not a success marker. Retry safely.
6. Sign into a second browser using the same email. Expect background refresh within 15 seconds while
   visible, or sooner on focus / reconnect. Settings → Sync now is available.

JSON restore is additive in cloud mode, using the same ID collision checks. Local-mode restore retains
the original app's replace-with-confirmation behavior. Audio is included in JSON exports. A missing
recording fails the export visibly rather than silently creating an incomplete backup.

## Acceptance checklist — real user devices still required

- [ ] Receive a magic link and land on the production `/commonplace/` URL with a persistent session.
- [ ] Create a task on iPhone; see it on desktop after signing in to the same account.
- [ ] Edit and complete it; verify the change in the opposite direction.
- [ ] Verify rich headings, lists, checklists, subtasks/order/completion and project associations.
- [ ] Follow task↔note links and play a migrated audio recording from a second device.
- [ ] Export original data; import; retry; confirm no duplicates and retained original data.
- [ ] Temporarily disconnect, edit, reload, reconnect and verify the pending edit uploads.
- [ ] Make simultaneous edits to the same item; verify conflict recovery and explicit choice.
- [ ] Sign out and back in; verify account data is hidden on logout and restored on login.
- [ ] Verify the existing mobile navigation, quick capture and installed app still work.

Automated tests cover the data/queue/UI logic above, plus PostgreSQL RLS and rollback. Actual email
delivery, iOS browser behavior and cross-device authenticated HTTP transport are separate acceptance steps.

## Free-tier fit

As checked on 2026-10-25, Supabase Free includes 500 MB database storage, 1 GB file storage,
5 GB egress, 50,000 monthly active users and two active projects. This should suit personal text notes;
audio is the likely limiting factor. Free projects can pause after a week of inactivity. Free does not
include the Pro daily-backup retention feature, so keep JSON backups. Custom SMTP may have separate limits.
Sources: https://supabase.com/pricing and https://supabase.com/docs/guides/auth/auth-smtp .

## Rollback

Set `enabled: false` in `cloud-config.js` only as a deliberate maintenance action: it exposes the retained
legacy local workspace, not your latest cloud data. Do not present that workspace as a cloud recovery.
Restore the previous Git commit for UI regressions; do not drop database tables or delete original storage.
