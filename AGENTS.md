# AGENTS.md

Working notes for anyone (human or agent) changing this repository. They
describe the current state of the project, not the historical one. The
historical implementation log is `IMPLEMENTATION_LOG.md` and the historical
pre-v2 audit is `AUDIT_REPORT.md`; neither describes the current contract.

## What this project is

ContentBounty is an escrow marketplace for creative work on GenLayer. A poster
defines an ordered rubric and escrows a GEN reward, a creator submits a public
HTTPS source, GenLayer validators evaluate every rubric criterion, and
deterministic contract code derives the verdict and the settlement. The
Intelligent Contract is the source of truth: there is no custodial backend, no
private judge and no frontend-held signing key.

## Current deployment

| | |
|---|---|
| Current contract (v2.3) | `0x12F6A5654fd0496951cd11976D2ebFa2cB4417Da` on **Studionet** (chain 61999) |
| Deployment tx | `0xbb3d4e6681db88931c2d1e19ccafc6daf10ffd48bd691850658cdc98782f18a2` |
| Source sha256 | `0f9e045a462992e226fa69203049b2e9ea108cd9040c097f0c7449bb3cc4c0a5` |
| Accepted baseline (v2.2) | `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8` on **Bradbury** (chain 4221), unchanged |
| Baseline tags | `baseline-accepted` (cf85066), `baseline-accepted-source` (2e35764) |
| Milestone evidence | `docs/MILESTONE-1.md` |
| Milestone text | `submission/milestone-text.md` |

The deployed source and `contracts/content_bounty.py` must be byte-identical.
Check it with `gen_getContractCode` and `sha256sum`; see
`docs/MILESTONE-1.md` §0.

Studionet state is temporary and its GEN is faucet-simulated. Neither is
value.

## Rules that must keep holding

1. **The equivalence principle is the security boundary.** Every nondeterministic
   entry point runs `gl.vm.run_nondet_unsafe` with a validator that re-runs the
   same work itself and compares the payout-controlling fields
   (evidence SHA-256, decision, per-criterion bits, score bucket, reason code,
   claim-tag state). Do not narrow the equivalence set, and do not treat a
   shape check as consensus.
2. **Never persist what a validator did not verify.** No model prose belongs in
   contract state. The verdict is a closed set derived by deterministic
   contract code from verified fields.
3. **No unauthenticated caller may create global state about another
   address.** Per-address maps are keyed by the caller only.
4. **No state transition moves value.** `withdraw_reward`, `withdraw_refund` and
   `withdraw_bond` are the only outbound transfer paths, each authorised
   against a recorded recipient and each runnable once.
5. **The interface may only offer actions the contract accepts.** The offered
   actions come from one pure function, `frontend/src/lib/statusActions.ts`,
   whose vocabulary is checked against the status constants parsed out of
   `contracts/content_bounty.py`. Do not re-implement contract rules in the
   interface.
6. **Deadlines come from `gl.message_raw["datetime"]`**, never from a
   caller's clock.
7. **Documentation and the interface must not claim more than the tests and
   the live runs prove.** Label staged or simulated data as such.

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
npm ci && npm ci --prefix frontend

npm run lint:contract        # fast AST gate, 3 checks
npm run check:contract       # lint + SDK validation (downloads a 216 MB bundle the first time)
npm run test:contract        # Direct Mode contract tests
npm run test:evidence
npm run test:network
npm run test:lifecycle
npm run test:hosting
npm --prefix frontend test   # vitest
npm run build:frontend       # vue-tsc -b && vite build
npm run verify:frontend-bundle
```

`npm run check:contract` downloads `genvm-universal.tar.xz` (216 630 904 bytes)
from the `genlayerlabs/genvm` v0.2.16 release. The newer asset name
`genvm-runners-all.tar.xz` 404s for v0.2.16 and is tried first. Use the
linter's own `genvm-lint download --version v0.2.16` to populate its cache;
never hand-seed a cache.

## Live runs

`scripts/live-studionet-milestone.mjs` drives the live proof. It reads keys
from `GENLAYER_DEPLOYER_PRIVATE_KEY`, `GENLAYER_CREATOR_PRIVATE_KEY` and
`GENLAYER_CHALLENGER_PRIVATE_KEY`; it never writes key material to disk and
never prints a key. Throwaway keys live in `.secrets/` (gitignored).

Two operational rules learned the hard way:

* A finalized receipt does **not** guarantee that the next transaction is
  executed against the state that includes it. Confirm the finalized read
  state shows the expected change before sending a dependent transaction.
* Pin reads with `transactionHashVariant: 'finalized'`. The default
  `latest-nonfinal` variant can observe a torn snapshot.

Evidence sources must be published at **commit-pinned** raw URLs
(`raw.githubusercontent.com/unifyWeb3/contentbounty/<sha>/docs/proofs/…`).
The branch-pinned form is CDN-cached and served a stale revision.

## Layout

```text
contracts/content_bounty.py   the Intelligent Contract (the only contract)
frontend/                      Vue 3 + Vite product, injected wallet only
scripts/                       deploy, live proof, bundle verification, guards
tests/direct/                  Direct Mode contract tests
tests/js/                      lifecycle, proof, network and recovery tests
tests/unit/                    evidence preparation tests
docs/                          specification, milestone evidence, proofs
state/                         baseline audit, milestone plan, design, decision log
submission/                    the Changes & Improvements text
hosting/live-evidence/         public canonical evidence Worker (historical v2.1.1)
```

`state/MEMORY.md` is the decision log. Read it first when resuming work.
