# Archived documentation

Historical Phase 1–10 specifications and review reports. These
documents describe the **pre-Phase-17** architecture: workspaces,
multi-list hierarchy, per-workspace roles, the Telegram Mini App
(`/app` + `/lists/[id]` + `/views/board`), `/lists` / `/share` /
`/snapshot` slash commands, Better Auth session flow, and the
"operator-mode" OpenRouter key resolution.

**Phase 17 collapsed all of this into a chat-only model.** One
Telegram chat = one to-do context; there are no workspaces, no
lists hierarchy, no Mini App. The bot is the surface.

These files are kept for context — if you're trying to understand
why a schema column exists, or why a `_shared.ts` invariant has a
particular shape, the history is here. **They do not reflect the
current implementation.** See the root [`README.md`](../../README.md)
and [`docs/`](../) for current state.

## Index

### Architecture
- `architecture-overview.md` — pre-pivot system overview
- `architecture-pass-phase-2.md` — workspaces + lists + roles
- `architecture-pass-phase-3.md` — sharing + reminders + assignees
- `architecture-pass-phase-4.md` — OSS quality + i18n + a11y
- `architecture-pass-phase-4.5.md` — snapshot URLs + audit + restore

### Reviews
- `review-phase-1.md` through `review-phase-5.md` — per-phase
  architecture review reports

### Handoffs
- `phase-5-handoff.md` — launch prep handoff
- `phase-6-handoff.md` — post-launch handoff

### Launch
- `launch-checklist-phase-5.md` — Phase 5 production deployment runbook
  (already executed)
- `launch-status.md` — Phase 5 launch status snapshot
- `project-state-phase-17.md` — last project-state snapshot before this
  hygiene pass (pre-onboarding-walkthrough)
