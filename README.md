# Commonplace

A private, local-first mobile web app for personal tasks, notes, and projects. No subscription, AI API key, or backend required.

## Run locally

Serve this folder with a static HTTP server (for example `python3 -m http.server 8000`), then open `http://localhost:8000`. Alternatively open `index.html` directly, but installability and microphone access depend on using HTTPS or localhost.

## Features

- Dashboard with Inbox, Tasks, Notes, Projects, and quick capture
- Tasks with completion, subtasks, reordering, descriptions, and project assignment
- Rich-text notes (headings, lists, links, checklists) and autosave
- Two-way note↔task links, and create tasks from selected note text
- Voice capture: browser speech transcription where available; otherwise audio notes via MediaRecorder
- Global search, offline app-shell caching (PWA)
- JSON backup and restore, including recorded audio

## Data and privacy

Data lives **only in the current browser** using localStorage (text) and IndexedDB (audio). It does **not** automatically synchronize between devices. Clearing site data can delete notes. Back up regularly using Settings. Rule-based input classification is processed locally (not cloud AI); a hosted AI backend would be required for LLM-powered classification.

## Deployment

Any static hosting service works (GitHub Pages, Cloudflare Pages, Netlify, Vercel, etc.). HTTPS is required for microphone access on phones. The app has no server-side credentials or per-user login; on a shared machine, others using the same browser profile may see the notes.

## Live site

Once GitHub Pages is enabled (Settings → Pages → Deploy from a branch → main → / (root)), open https://vicky4u-art.github.io/commonplace/.
