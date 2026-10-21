# Milestone-1 Plan — ContentBounty v2.3

Status: **scope frozen** at the end of Stage 1. No additions after this point
except fixes for verified blockers or security issues found in Stages 3–4.

Baseline: tag `baseline-accepted` (cf85066) / source tag `baseline-accepted-source` (2e35764).
Baseline live deployment: Bradbury 4221 `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8`.

---

## 1. What the baseline already does well (and therefore must not be re-litigated)

* The equivalence principle is real: validators independently re-render the
  evidence and independently re-run the criterion judgment, and the equivalence
  set is semantic (`decision`, per-criterion bits, score bucket, reason code,
  recomputed SHA-256, claim-tag state). The historical "shape-only validation"
  defect is closed.
* The verdict is derived by deterministic contract code from the per-criterion
  bits; no submission is hardcoded approved.
* No unauthenticated caller can write global state about another address.
* Money cannot double-pay; deadlines come from the GenVM transaction timestamp;
  the evidence source allowlist and rubric validation are strict.

The milestone is therefore **not** "make the AI path real". It is real already.
The milestone is about what is still unverified, what is still implicit, and
what the product still cannot show a user.

## 2. Candidates evaluated

### C-a. Verified, reproducible evaluation with closed-set verdicts
**For:** the last leader-controlled artefact on chain is the free-text
`feedback`, which no validator verifies and the UI presents beside the
verified fields (audit F-1). Replacing it with a deterministic, closed-set
verdict makes *every* persisted verdict field validator-verified or
deterministic.
**Against:** removing the model's explanation is a product regression; users
lose the sentence that says *why*. Mitigated by storing the per-criterion
verdict bits and a closed-set reason code and rendering them in the UI.

### C-b. Defences against prompt injection inside submissions
**For:** it is on the brief's list and it is a real attack surface.
**Against:** the injection surface is already framed as data, escaped with
`\u003c/\u003e/\u0026`, and the verdict is derived deterministically from the
criterion bits, so an injected document cannot select the verdict. The official
guidance is explicit that "prompt hardening reduces risk; independent
validation is the security boundary". A hardening change on its own would be a
weak milestone.
**Included, but scoped narrowly** to the one concrete, checkable gap: an
evidence document must not be able to forge the protocol anchors that the
contract's own prompt template uses.

### C-c. Correct payout and refund paths with pull-based withdrawal
**For:** value currently leaves the contract inside the same transaction that
mutates state (audit F-2). Every outbound transfer is an external call in a
state transition, a recipient that cannot receive blocks settlement, and the
contract's liability is implicit — nothing on chain states the escrow total.
Pull-based settlement makes the liability explicit, gives one audited outbound
path, and removes reentrancy through payout.
**Against:** it is the riskiest change in the plan — it touches every money
path and can break the payout proof that the project already has. It also
changes the user flow (claim, then withdraw).

### C-d. Deadlines, expiry and creator-cancel rules
**For:** already implemented and tested.
**Against:** nothing meaningful to add. **Rejected.**

### C-e. Per-submitter scoping so no caller can create global state about others
**For:** on the brief's list.
**Against:** already correct in the baseline (audit, "items that are not
weak"). **Rejected** — there is nothing to fix.

### C-f. An appeals or re-evaluation path
**For:** a creator who is rejected has no recourse.
**Against:** the challenge path already provides a second, independent
consensus round over the same evidence with a bounded bond and a mandatory
timeout. A second appeals path would be a much larger state machine, and it
cannot be proven live inside the challenge window without a second long wait.
**Rejected** for this milestone; the challenge window work (C-g) already
shortens the demonstrable dispute cycle.

### C-g. A dispute window the poster declares, stored on the bounty
**For:** the 48-hour window is a hard-coded constant that is invisible in the
bounty's own record (audit F-3). Storing it as a poster-declared,
minimum-bounded parameter makes the dispute window part of the commitment the
creator accepts, and it makes the creator payout reachable inside a single
test run, so the live proof can cover the whole lifecycle.
**Against:** a poster who wants a short window shortens the dispute window
for everyone. **Mitigation:** a hard floor (300 s) and a hard ceiling (48 h),
the exact window stored on the bounty and shown to the creator before they
submit, and the default unchanged at 48 h.

### C-h. A real UI upgrade that reflects every contract state
**For:** the brief requires it, and the baseline UI already contains a drift
bug (audit F-5: the UI offers "Expire permissionlessly" in a state where the
contract reverts) and a duplicated action-rule implementation (audit F-6).
**Against:** UI work alone is not a milestone for a GenLayer program.
**Included**, because it is the surface where every contract state becomes
visible, and because the drift bug must be fixed anyway.

## 3. Chosen scope (frozen)

**ContentBounty v2.3 — closed-set verdicts and pull-based settlement.**

Contract (new deployment, new address):

1. **S1 — Closed-set verdicts.** Remove `Submission.feedback` and
   `Challenge.proposed_feedback` (leader free text that no validator
   verifies). Add a deterministic `verdict_code` on every submission, derived
   only from validator-verified fields. Add `rubric_sha256` to the bounty so
   the rubric that the model judged is bound by a published digest.
2. **S2 — Poster-declared dispute window.** `post_bounty` takes
   `challenge_window_seconds`, floor 300 s, ceiling 172 800 s, default
   172 800 s. Stored on the bounty and used to compute
   `challenge_deadline`.
3. **S3 — Pull-based settlement.** No value moves as a side effect of a state
   transition. `claim_reward` marks the reward withdrawable;
   `cancel_bounty`/`expire_bounty` mark the refund withdrawable;
   `finalize_challenge`/`timeout_challenge` mark the bond withdrawable. Three
   new explicit withdrawal methods (`withdraw_reward`, `withdraw_refund`,
   `withdraw_bond`) perform the transfers, each exactly once, each authorised
   against the recorded recipient. New view `get_escrow_accounting()` publishes
   the contract's liability so it can be checked against the observed native
   balance.
4. **S4 — Fix the upheld-challenge contradiction.** An upheld challenge clears
   `criteria_bits` and `score_bucket` instead of leaving the approval's
   perfect score on a rejected submission.
5. **S5 — Protocol-anchor neutralisation.** Evidence text is scanned for the
   contract's own prompt anchors and those anchors are neutralised before the
   text reaches the model. The SHA-256 commitment still covers the original
   published bytes.

Frontend:

6. **S6 — One status→action module.** A single pure function derives the
   available actions for a bounty/submission/challenge from contract state. It
   is tested against the status constants parsed out of the contract source so
   the two cannot drift. Real loading/empty/error/pending states; no action the
   contract would reject; the withdrawal states are surfaced.

Deployment and evidence:

7. **S7 — New v2.3 deployment on Studionet** with a full live lifecycle
   (post → submit → evaluate → challenge → review → finalize → claim →
   withdraw, plus refunds), live refusals (injected/fabricated evidence must
   not be approved, double claim refused, double withdraw refused, creator
   cannot challenge, wrong bond rejected), byte-for-byte source equality with
   the repository file, and a pinned-block final read.

Out of scope for this milestone (recorded, not hidden): a persistent Bradbury
v2.3 deployment (needs one human faucet claim), a second appeals path, an
identity registry, and X/Twitter as a source.

## 4. Success as evidence

Every claim below names the commit, the test and the live transaction that will
prove it. The authoritative table with the real hashes lives in
`docs/MILESTONE-1.md`, produced in Stage 7.

| # | Claim | Commit | Test | Live |
|---|---|---|---|---|
| 1 | Every persisted verdict field is validator-verified or deterministic; no leader free text is stored | contract commit | `tests/direct/test_content_bounty.py::test_evaluation_persists_only_verified_closed_set_fields` (+ positive control) | `evaluate_submission` tx on the v2.3 deployment; `get_submission` shows `verdict_code` and no `feedback` |
| 2 | The rubric used by the model is bound by a published digest | contract commit | `test_bounty_publishes_rubric_digest_matching_the_stored_rubric` | `get_bounty` on the v2.3 deployment returns the same `rubric_sha256` |
| 3 | The dispute window is a stored, bounded, poster-declared parameter | contract commit | `test_challenge_window_is_declared_bounded_and_stored` (+ refusal tests with positive control) | `get_bounty` shows the declared window; `challenge_deadline - approved_at` equals it |
| 4 | No value moves as a side effect of a state transition | contract commit | `test_state_transitions_move_no_value_and_withdrawals_move_value_once` | balance delta observed only after the `withdraw_reward` tx |
| 5 | A withdrawal cannot be claimed twice, and only by the recorded recipient | contract commit | `test_double_withdraw_is_refused_for_reward_refund_and_bond` (each with a positive control) | a second `withdraw_reward` tx reverts on chain |
| 6 | The contract's liability is explicit and equals the observed native balance | contract commit | `test_escrow_accounting_matches_the_sum_of_every_liability` | `get_escrow_accounting()` vs `eth_getBalance` of the contract |
| 7 | An upheld challenge does not leave a rejected submission claiming a perfect score | contract commit | `test_upheld_challenge_clears_the_overturned_criterion_bits` | `get_submission` after a live upheld challenge |
| 8 | Injected evidence cannot forge the contract's protocol anchors | contract commit | `test_injected_evidence_cannot_forge_protocol_anchors` (+ positive control: a compliant document with the same anchors still evaluates) | an injected document that must not be approved |
| 9 | The UI never offers an action the contract rejects | frontend commit | `frontend/src/lib/statusActions.test.ts` (bound to the status constants parsed from the contract source) | the deployed app at the Vercel URL |
| 10 | The deployed bytes are the repository bytes | deploy commit | — | `gen_getContractCode` → sha256 == sha256 of `contracts/content_bounty.py` |

## 5. What will not be claimed

* That GEN on Studionet has value. It does not; `sim_fundAccount` mints it.
* That the v2.3 deployment is persistent. Studionet is temporary.
* That the claim tag proves authorship or legal ownership. It proves control
  of the publishing surface at render time and nothing more.
* That a single deployer key is a distributed trust model. It is not: one key
  signs one deployment.
* That prompt hardening is the security boundary. Independent validator
  recomputation is.
* That the transaction list in the browser UI is a chain-wide audit trail.
