# ContentBounty Milestone-1 — Decision Log

Repo: /root/contentbounty  (github.com/unifyWeb3/contentbounty)
Working branch: `milestone-1` (from `main` @ cf85066)
Date started: 2026-10-21

## Stage 0 — Baseline and audit (DONE)

### Decisions
- D0.1: The task text refers to `web/`; this repo's web UI lives in `frontend/` (Vite + Vue 3).
  Decision: treat `frontend/` as the web UI. Reason: it is the only web client in the repo;
  renaming directories would be a rebrand, which the brief forbids.
- D0.2: No `state/` dir existed. Created it for MEMORY.md / AUDIT.md / MILESTONE-PLAN.md / DESIGN.md.
- D0.3: Repo root has no AGENTS.md. README is the framing doc. An AGENTS.md will be added
  in Stage 7 (the brief requires addresses to be updated there).
- D0.4: No git tags existed. Created `baseline-accepted` -> cf85066 (default-branch HEAD,
  the state the repo presents as its accepted live product) AND `baseline-accepted-source`
  -> 2e35764 (the exact source commit of the accepted live deployment). The contract file is
  byte-identical between the two, so the contract diff is identical either way.
- D0.5: Baseline live deployment audited = Bradbury 4221 `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8`.
  Read back with `gen_getContractCode` (base64) -> 52237 bytes, sha256 b5e89cf0...33df36a ==
  sha256 of `contracts/content_bounty.py`. BYTE IDENTICAL.
- D0.6: The prior review's two complaints are BOTH fixed in the current code. Verified with exact
  line numbers in state/AUDIT.md section 1. The equivalence fix is the substantive one
  (validators independently re-render AND re-judge), not the historical shape-only one.
- D0.7: Bradbury funding requires a Cloudflare Turnstile captcha in a browser -> a human action.
  Studionet is gasless and self-service via `sim_fundAccount`. DECISION: the milestone deployment
  and live proof run on Studionet (which is also what the brief asks for and what the user stated).
  The persistent Bradbury v2.2 deployment stays documented as the accepted baseline. A future
  Bradbury v2.3 deployment needs one human faucet claim; this is recorded as an open external item.
- D0.8: Studionet state is temporary and its GEN is faucet-simulated. All docs must say so.
- D0.9: `genvm-lint lint` passes 3/3 immediately. `genvm-lint check` needs the 216 MB
  genvm-universal.tar.xz from the genlayerlabs/genvm v0.2.16 release; the newer asset name
  `genvm-runners-all.tar.xz` 404s for v0.2.16. Download was started in the background.
- D0.10: `.gitignore` extended with `.secrets/` and `*.key` BEFORE any key file was created.
  Throwaway keys live in `.secrets/milestone-1-keys.json` (mode 0600, untracked).
  Addresses only: deployer 0xE4f71F7EEe7B99aD9DAEFf29A8cE77487A6Ad7D8,
  creator 0x5c4aF74CEe8A2F8a7C91d0c708a76f0aa7edd9a4,
  challenger 0xA41083790516e86D222dD3aE822300e1b15d2bFB.
- D0.11: Evidence for live runs is published at a commit-pinned raw URL
  (`raw.githubusercontent.com/unifyWeb3/contentbounty/<sha>/path`) because the branch-path form is
  CDN-cached and served a stale revision. Commit-pinned URLs are immutable and cache-proof.
- D0.12: One `git commit --amend` + `git push --force` was used on the feature branch BEFORE any
  publication, to replace a published evidence file that carried a wrong claim tag. From this
  point the branch is append-only; the default branch will be merged with a normal merge commit.

### Verified baseline facts (see state/AUDIT.md for the full list of 14 findings)
- Baseline live lifecycle on Studionet: deploy 0xff733590..., post 0xa0cef58e..., cancel/refund
  0x3a7c6e3c..., post#1 0x05cb4ba4..., submit 0x579e9774..., evaluate 0xcbaf53cd... ->
  APPROVED_PENDING / APPROVE / bits 11 / bucket 4 / ALL_REQUIRED_CRITERIA_MET.
- Value DOES move on Studionet: poster 2000 -> 1000 GEN on post, back to 2000 GEN on cancel.
- Baseline direct tests: 67 passed (pytest tests/direct -q, exit 0).

## Stage 1 — Milestone choice (DONE)

See state/MILESTONE-PLAN.md. Frozen scope: **ContentBounty v2.3 — closed-set verdicts and
pull-based settlement** (plus the upheld-challenge state fix, the poster-declared dispute window,
protocol-anchor neutralisation, and the UI status-action module).

## Stage 2 — Design (DONE)

See state/DESIGN.md.

## Stage 3 — Build
(next)

## Stage 4 — Self-review
(next)

## Stage 5 — Frontend
(next)

## Stage 6 — Deploy to Studionet and prove live
(next)

## Stage 7 — Make the change verifiable
(next)

## Stage 8 — Final checks and publish
(next)

## Stage 3 — Build (DONE)

- v2.3 contract written in readable form (81 035 bytes) and deployed to Studionet without
  minification. Studionet accepts it; Bradbury's pubdata limit was the reason v2.2 was minified.
- `genvm-lint lint` 3/3 pass. `npm run check:contract` -> lint 3/3, validate ok, 24 methods
  (11 view / 13 write), exit 0.
  IMPORTANT: the documented check command does not 404, it is simply slow: it downloads
  genvm-universal.tar.xz (216 630 904 bytes) from the genlayerlabs/genvm v0.2.16 release at
  ~85-107 kB/s, i.e. ~40-55 minutes. The newer asset name `genvm-runners-all.tar.xz` returns
  HTTP 404 for v0.2.16 and the linter tries it first. The bundle was fetched with the linter's
  own `genvm-lint download --version v0.2.16` command (its supported cache-populating path); no
  cache was hand-seeded.
- Direct-mode suite: 84 passed (67 before + 17 new). The 17 new tests fail against the
  baseline-accepted contract; captured in state/red-state-baseline.txt (14 shown there).
- Bug found and fixed while redeploying (reported): a challenge whose evidence source changed
  after filing made `review_challenge` REVERT instead of returning INCONCLUSIVE, because
  "DIGEST_MISMATCH" was not a declared challenge error class. The challenge could then only be
  resolved by waiting 48 hours. Fixed by adding the class and a regression test.

## Stage 4 — Self-review (DONE, folded into Stage 3)

Attacked the diff; found and fixed:
- DIGEST_MISMATCH challenge error class (above).
- The anchor neutralisation initially replaced an anchor with a token that CONTAINED the anchor
  ("QUOTED_EVIDENCE_UNTRUSTED_INPUT_JSON"), so the anchor was still present. Replaced with
  markers that contain no anchor substring.
- `get_escrow_accounting` and `get_submission_verdict` were added; both are read-only and
  publish only validator-verified or deterministic values.

## Stage 5 — Frontend (DONE)

- One pure function `availableActions` decides every offered action. Its vocabulary is checked
  against the constants parsed out of contracts/content_bounty.py, so the interface and the
  contract cannot drift.
- Fixed the drift bug found in the audit: the interface offered "Expire permissionlessly" while
  a challenge was active, and the contract rejects that.
- 111 frontend tests pass (97 before + 14 new). vue-tsc -b clean.

## Stage 6 — Deploy to Studionet and prove live (IN PROGRESS)

Deployed v2.3: contract 0x12F6A5654fd0496951cd11976D2ebFa2cB4417Da, deployment tx
0xbb3d4e6681db88931c2d1e19ccafc6daf10ffd48bd691850658cdc98782f18a2, deployed sha256
0f9e045a462992e226fa69203049b2e9ea108cd9040c097f0c7449bb3cc4c0a5 == sha256 of the repository
file (BYTE IDENTICAL true).

Live results so far are recorded in docs/MILESTONE-1.md.

OPERATIONAL FINDING: on Studionet a finalized receipt does NOT guarantee that the next
transaction is executed against the state that includes it. Two transactions executed against a
stale snapshot ("Challenge does not exist", "Submission does not exist"). The live harness now
polls the FINALIZED read state until the expected change is visible before sending a dependent
transaction, and every read is pinned with transactionHashVariant=finalized.
