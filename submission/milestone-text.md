# Milestone 1 — Changes & Improvements (ContentBounty)

Repo: https://github.com/unifyWeb3/contentbounty
Baseline tag: `baseline-accepted` (the accepted v2.2 deployment)
Milestone tag: `milestone-1`
New contract: `0x12F6A5654fd0496951cd11976D2ebFa2cB4417Da` on GenLayer Studionet (chain 61999)
Deployment transaction: `0xbb3d4e6681db88931c2d1e19ccafc6daf10ffd48bd691850658cdc98782f18a2`

---

## (a) Detailed version

ContentBounty v2.3 is new work on top of the accepted v2.2 contract, not a
resubmission. The accepted deployment stays live and unchanged on Bradbury at
`0x7F73e10059D0C669c2d2fe3FA716312587aC87c8`; v2.3 is a new deployment with a
new address, and the diff between the two tags is in
`docs/MILESTONE-1.md`.

What changed in the contract:

1. **Closed-set verdicts. The contract no longer stores any model prose.**
   `Submission.feedback` and `Challenge.proposed_feedback` are removed. Every
   field an evaluation round writes is either recomputed independently by
   every validator (evidence SHA-256, decision, per-criterion bits, score
   bucket, reason code, claim-tag state) or derived by deterministic contract
   code (`verdict_code`). A new view `get_submission_verdict` publishes the
   closed-set verdict, the per-criterion result and the rubric digest.
2. **Pull-based settlement. No state transition moves value.** `claim_reward`,
   `cancel_bounty`, `expire_bounty`, `finalize_challenge` and
   `timeout_challenge` now only record a liability. Three new methods,
   `withdraw_reward`, `withdraw_refund` and `withdraw_bond`, perform the
   transfers. Each can run exactly once and each is authorised against the
   recipient recorded when the liability was created. This removes the
   external call from the settlement path and means a recipient that cannot
   receive can no longer block settlement.
3. **Published escrow accounting.** `get_escrow_accounting` publishes every
   liability class the contract holds, so its liability can be checked against
   the contract's native balance instead of being implicit.
4. **Poster-declared dispute window.** The 48-hour challenge window was a
   hard-coded constant that was invisible in the bounty's own record. It is
   now a poster-declared parameter bounded to 300 … 172 800 seconds, stored on
   the bounty, copied into `challenge_deadline` at approval, and shown to the
   creator before they submit.
5. **Two defects fixed while redeploying.** An upheld challenge used to leave
   a *rejected* submission still claiming `criteria_bits = 11` and a perfect
   score; the overturned approval is now cleared. And a challenge whose
   evidence source changed after filing made `review_challenge` revert instead
   of returning a retryable `INCONCLUSIVE`, which could only be resolved 48
   hours later; `DIGEST_MISMATCH` is now a declared error class.
6. **Prompt-anchor neutralisation.** Untrusted evidence can no longer contain
   the contract's own prompt anchors before the model reads it. The SHA-256
   commitment still covers the exact published bytes.

What changed in the interface: one pure function now decides which actions
are offered, and its vocabulary is checked against the status constants parsed
out of the contract source, so the interface and the contract cannot drift.
This fixed a case where the interface offered "Expire permissionlessly" while
a challenge was active and the contract rejected it. The interface also shows
the closed-set verdict with a per-criterion list, the published escrow
liability, the dispute window, the new withdrawal actions, and real loading,
empty and error states.

Proof, all on Studionet: the full legitimate path (post, submit, evaluate,
claim, withdraw) with transaction hashes; the balance moved exactly 1 GEN on
the reward withdrawal, exactly 0.05 GEN on the bond withdrawal and exactly
1 GEN on the refund withdrawal, and moved **nothing** during the state
transitions; refusals for a double withdrawal, a wrong withdrawal recipient, a
double claim, the creator challenging their own submission, a wrong bond and
an invalid challenge reason, each rejected on chain; a submission carrying a
prompt injection attempt was rejected with `criteria_bits = 00`; and an
upheld challenge left the submission with empty criterion bits and a zero
score. The deployed bytes were read back with `gen_getContractCode` and are
byte-identical to `contracts/content_bounty.py` (sha256
`0f9e045a462992e226fa69203049b2e9ea108cd9040c097f0c7449bb3cc4c0a5`).

Tests: 84 direct-mode contract tests (67 before, 17 new; the new ones fail
against the baseline tag), 111 frontend tests (97 before, 14 new), lint 3/3,
and `genvm-lint check` reports 24 methods (11 view, 13 write).

Limits, stated plainly: Studionet state is temporary and its GEN is
faucet-simulated, so the live run proves the escrow mechanics, not money. The
milestone deployment is therefore a proof, not a permanent home; a persistent
Bradbury deployment of v2.3 needs one faucet claim in a browser. The claim tag
still proves control of the publishing surface at render time, not legal
authorship. A single deployment key is a single key. Prompt hardening narrows
the injection surface; the boundary is that a validator re-renders the
evidence and re-judges it independently.

## (b) Under 1000 characters, lowercase, plain

```text
contentbounty v2.3, new work on v2.2. repo github.com/unifyweb3/contentbounty. baseline tag baseline-accepted. new contract 0x12f6a5654fd0496951cd11976d2ebfa2cb4417da on studionet.

changed: no model prose stored; verdict fields are validator-recomputed or contract-derived. no state transition moves value: claim, cancel, expire and challenge settlement only record liabilities; withdraw_reward, withdraw_refund and withdraw_bond move it once each, to the recorded recipient. the dispute window is now a declared parameter.

proof: deployed bytes are byte identical to contracts/content_bounty.py. live on studionet: 1 gen moved on the reward, 0.05 gen on the bond, 1 gen on the refund, none on transitions; refusals rejected on chain; an injected submission was rejected, bits 00. 84 contract tests (17 new, failing on the baseline tag), 111 frontend tests, lint 3/3. table: docs/milestone-1.md.

limits: studionet is temporary and its gen is faucet-simulated; this proves mechanics, not money.
```

## What stewards can verify, and how

| What | How |
|---|---|
| The milestone is new work, not a resubmission | `git diff --stat baseline-accepted..milestone-1`, and `docs/MILESTONE-1.md` §0 |
| The deployed code is the repository code | `curl` `gen_getContractCode` for the new address, base64-decode, `sha256sum`; compare with `sha256sum contracts/content_bounty.py` |
| No model prose is stored | `get_submission` / `get_challenge` have no `feedback` field; `get_submission_verdict` returns a closed set |
| Value only moves on withdrawal | the balance deltas recorded around each live transaction in `docs/MILESTONE-1.md` §1 |
| Withdrawals cannot be repeated | the six refusal transactions, each `execution_result=ERROR` |
| The injection did not win | the injected evaluate transaction, `criteria_bits = 00` |
| The overturned approval was cleared | `get_submission(1)` after the upheld challenge |
| The tests are real | `npm run test:contract` (84 passed), `npm --prefix frontend test` (111 passed), `npm run lint:contract`, `npm run check:contract` |
| The new tests fail on the baseline | `state/red-state-baseline.txt` |
| The live run is reproducible | `scripts/live-studionet-milestone.mjs`, documented in `docs/MILESTONE-1.md` §2 |
