# ContentBounty Milestone-1 — Decision Log

Repo: /root/contentbounty  (github.com/unifyWeb3/contentbounty)
Working branch: `milestone-1` (created from `main` @ cf85066, no divergence at start)
Date started: 2026-10-21

## Stage 0 — Baseline and audit (IN PROGRESS)

### Decisions
- D0.1: The task text refers to `web/`; this repo's web UI lives in `frontend/` (Vite + Vue 3).
  Decision: treat `frontend/` as the web UI. Reason: it is the only web client in the repo;
  renaming directories would be a rebrand, which the brief forbids.
- D0.2: No `state/` dir existed. Created it for MEMORY.md / AUDIT.md / MILESTONE-PLAN.md / DESIGN.md.
- D0.3: Repo root has no AGENTS.md. Will note absence; README is the framing doc.
- D0.4: No git tags exist. Baseline tag `baseline-accepted` must be created.
