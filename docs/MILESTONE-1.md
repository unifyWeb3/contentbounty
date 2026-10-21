# ContentBounty — Milestone 1 evidence

**Milestone:** ContentBounty v2.3 — closed-set verdicts and pull-based settlement.
**Baseline:** tag `baseline-accepted` (cf85066) / source tag `baseline-accepted-source` (2e35764).
**Milestone deployment:** `0x12F6A5654fd0496951cd11976D2ebFa2cB4417Da` on **GenLayer Studionet** (chain 61999).
**Deployment transaction:** `0xbb3d4e6681db88931c2d1e19ccafc6daf10ffd48bd691850658cdc98782f18a2`.

Everything in the "live transaction" column below was observed on Studionet.
Every number is reproducible with the command in the same row.

---

## 0. Before vs after

```bash
git diff --stat baseline-accepted..HEAD
git diff baseline-accepted..HEAD -- contracts/content_bounty.py | head -40
git tag -l
git show baseline-accepted:contracts/content_bounty.py | sha256sum
```

| | baseline-accepted | Milestone-1 (v2.3) |
|---|---|---|
| Contract file | minified, 52 237 bytes | readable, 81 035 bytes |
| Contract sha256 | `b5e89cf03ae7f79d1c6d0b0c45ee3b8e567fe4fb7f57fea0b370e165a33df36a` | `0f9e045a462992e226fa69203049b2e9ea108cd9040c097f0c7449bb3cc4c0a5` |
| Public methods | 19 (9 view / 10 write) | 24 (11 view / 13 write) — `npm run check:contract` |
| Direct-mode tests | 67 | 84 (17 new) |
| Frontend tests | 97 | 111 (14 new) |
| Model prose stored on chain | yes (`feedback`, `proposed_feedback`) | none |
| Value-moving methods | 5 (claim, cancel, expire, finalize bond, timeout bond) | 3, all explicit withdrawals |
| Published liability view | none | `get_escrow_accounting()` |
| Closed-set verdict view | none | `get_submission_verdict()` |
| Dispute window | hard-coded 172 800 s constant, not stored | poster-declared, 300 … 172 800 s, stored on the bounty |
| Challenge error classes | 5 (`DIGEST_MISMATCH` missing) | 6 (`DIGEST_MISMATCH` added) |
| Protocol anchors in evidence | reachable by the model | neutralised before the model sees the evidence |

### Deployed source equals repository source

```bash
curl -s -X POST https://studio.genlayer.com/api -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"gen_getContractCode","params":["0x12F6A5654fd0496951cd11976D2ebFa2cB4417Da"]}'
sha256sum contracts/content_bounty.py
```

Observed: deployed bytes 81 035, deployed sha256
`0f9e045a462992e226fa69203049b2e9ea108cd9040c097f0c7449bb3cc4c0a5`, identical to the
repository file (`BYTE IDENTICAL true`, printed by the deploy stage of
`scripts/live-studionet-milestone.mjs`).

### The baseline deployment was verified too, not assumed

The accepted deployment was read back with `gen_getContractCode` from Bradbury
(chain 4221) and is byte-identical to `contracts/content_bounty.py` at
`baseline-accepted`: 52 237 bytes, sha256 `b5e89cf0…33df36a`.

---

## 1. Claim → commit → test → live transaction

| # | Claim | Commit | Test | Live transaction |
|---|---|---|---|---|
| 1 | No model prose is persisted; the verdict is a closed set derived by contract code | `6565064` | `tests/direct/test_content_bounty.py::test_evaluation_persists_only_verified_closed_set_fields`, `::test_rejected_and_inconclusive_verdicts_are_closed_set` | evaluate `0xdc7ee91855035725c27daa9d3b470ccf97dd20237963da808b2dd9d5bf3ea591` → `verdict_code=ALL_CRITERIA_MET`, `get_submission` has no `feedback` key |
| 2 | The rubric the model judged is bound by a published digest | `6565064` | `::test_bounty_publishes_rubric_digest_matching_the_stored_rubric` | `get_bounty(0).rubric_sha256 = ccb2a9740d755d5945d458acc1701e17a2f8238e653ba06d2eea6591c0677d73` |
| 3 | The dispute window is a poster-declared, stored, minimum-bounded parameter | `6565064` | `::test_challenge_window_is_declared_bounded_and_stored`, `::test_challenge_window_cannot_change_after_posting` | post `0x1e6284fd82e9a930efc532f83dc2e7c00c83b2c80a7e0d0ccb1931ed2259c3df` → `challenge_window_seconds=300`; approval `challenge_deadline − approved_at = 300` |
| 4 | No state transition moves value | `6565064` | `::test_state_transitions_move_no_value_and_withdrawals_move_value_once`, `::test_refund_withdrawal_requires_the_poster` | claim `0x1881b6859675806df631834eb2e917e964e28289a98870ede4ba173d24db35e9`: creator balance 2000000000000002000 → 2000000000000002000 (no change). cancel `0x7490187cdad639f38df8a0698b9b68d79e16393f795e13365749e011c9d6f0b6`: poster balance 0 → 0 (no change) |
| 5 | The reward is pulled by the creator, exactly once, only by the creator | `6565064` | `::test_double_claim_and_double_withdraw_are_refused`, `::test_withdrawal_requires_the_recorded_recipient` | withdraw `0xa633957c76258f7c513540b783be198adddef5339f9bf59284ca21e7f563d23f`: creator balance 2000000000000002000 → 3000000000000002000, delta exactly 1000000000000000000 wei |
| 6 | The poster pulls the refund of a cancelled bounty | `6565064` | `::test_refund_withdrawal_requires_the_poster` | withdraw_refund `0x2daedf81e2ac8dd9c947ba799656cd3fa2b4fc8c7050be42217077706a395523`: poster balance 0 → 1000000000000000000, delta exactly 1 GEN |
| 7 | The bond is pulled by the recorded recipient, exactly once | `6565064` | `::test_finalize_is_deterministic_and_bond_releases_once` | withdraw_bond `0x9bee3dfadd43589bfeb5f2d711c025f56599763051c675b9bbe7d31d1fda1cd1`: challenger balance 1848000000000002000 → 1898000000000002000, delta exactly 50000000000000000 wei (0.05 GEN, the exact bond) |
| 8 | A double withdrawal is refused | `6565064` | `::test_double_claim_and_double_withdraw_are_refused` | `0x649116a7cae612d4eefe86e8b7f0762bc5a3692a4355cf99836a080a3797a04b` → `execution_result=ERROR`, `AssertionError: No reward is withdrawable` |
| 9 | A withdrawal by the wrong party is refused | `6565064` | `::test_withdrawal_requires_the_recorded_recipient` | `0x751da1911828b6a4999a51f71ede6503c42b77c5d995e735fcab3dbe01f34025` → `execution_result=ERROR` |
| 10 | A double claim is refused | `6565064` | `::test_double_claim_and_double_withdraw_are_refused` | `0xf2793b0ea54b42a150e47bb6bcf0e9007d3b478a09eac1584e452fe2636b1791` → `execution_result=ERROR` |
| 11 | The creator cannot challenge their own submission; the wrong bond and an invalid reason are refused | `6565064` | `::test_challenge_exact_bond_permissions_duplicate_and_deadline` | `0x42d3fb6f4a0a14cba10d2a341804bda1401469a36fbe88084f79f6a0ab1101aa`, `0x980ec59da9464db68e21b569bd3353dfbb06211b4be3de384200aea4b072486f`, `0x34dc761aeb466cbe29bac8982627b134ec735012daeae6d5049f4f83ab5e803a` → all `execution_result=ERROR` |
| 12 | The contract publishes its liability, and it is exactly the sum of the escrow and the pending withdrawals | `6565064` | `::test_escrow_accounting_matches_every_liability_class` | `get_escrow_accounting()` after the withdrawals: `bounty_escrow_total=2000000000000000000`, all other classes 0, `expected_native_balance=2000000000000000000`; the contract's observed native balance is 2122000000000000000 wei — see §4 for the exact 122 000 000 000 000 wei difference |
| 13 | An upheld challenge no longer leaves a rejected submission claiming a perfect score | `6565064` | `::test_upheld_challenge_clears_the_overturned_criterion_bits` | review `0x9f1b87732a7058da94f3e643959019bb924004c8e27838cf496346cfeea28389` (UPHOLD) → finalize `0xc725996849ef54fa821b35a0ee861b21a50fc96533eae32ea4e81e74225eb053` → `get_submission(1)`: `status=REJECTED`, `criteria_bits=''`, `score_bucket=0`, `verdict_code=CHALLENGE_UPHELD` |
| 14 | A changed challenge source is a retryable INCONCLUSIVE, not a revert | `6565064` | `::test_challenge_review_with_mutated_challenge_source_is_inconclusive_not_a_revert` | direct-mode only; the fix is listed in §5 |
| 15 | Injected evidence cannot forge the protocol anchors and cannot select the verdict | `6565064` | `::test_injected_evidence_cannot_forge_protocol_anchors`, `::test_injected_evidence_cannot_select_the_verdict_positive_control` | injected submit `0xc2f7d111fb14bc76307991c6e7c7205273f6861df642ba2d6e5bd5d295715201` → injected evaluate `0x30e8d53564b42ad5acc2b5284d487a27bf58c3f267dac008e8cd10390a2c8d02` → `decision=REJECT`, `criteria_bits='00'`, `verdict_code=NOT_ALL_CRITERIA_MET`, `reason_code=CRITERIA_NOT_MET` |
| 16 | The interface never offers an action the contract rejects | `f045442` | `frontend/src/lib/statusActions.test.ts` (14 tests, incl. the vocabulary check against the parsed contract constants) | the deployed app reads the v2.3 contract; the drift bug that offered "Expire permissionlessly" during an active challenge is fixed |
| 17 | A full legitimate lifecycle works end to end | `6565064` | `tests/direct/test_content_bounty.py` (84 tests) | post `0x1e6284fd…` → submit `0xabc8fd2cafb1662a97348eed1e689ad18a82ef9a0c56ad4f69b783c01735f20c` → evaluate `0xdc7ee918…` → claim `0x1881b685…` → withdraw `0xa633957c…` |
| 18 | A challenge can be filed, reviewed, finalised and the bond withdrawn | `6565064` | `::test_upheld_challenge_rejects_reopens_and_returns_bond` | challenge `0x6a8bd9a21dbe8478c86007bbd0523b09be55ce21a95b4a4b5a4b5015098defc7` → review `0x9f1b8773…` → finalize `0xc7259968…` → withdraw_bond `0x9bee3dfa…` |

---

## 2. How to reproduce the live run

The harness reads keys from the environment and never writes key material to
disk or to the log.

```bash
export GENLAYER_DEPLOYER_PRIVATE_KEY=0x…    # throwaway Studionet key
export GENLAYER_CREATOR_PRIVATE_KEY=0x…
export GENLAYER_CHALLENGER_PRIVATE_KEY=0x…
node scripts/live-studionet-milestone.mjs --stage deploy
node scripts/live-studionet-milestone.mjs --stage post
node scripts/live-studionet-milestone.mjs --stage submit  --evidence <url>
node scripts/live-studionet-milestone.mjs --stage evaluate
node scripts/live-studionet-milestone.mjs --stage claim
node scripts/live-studionet-milestone.mjs --stage withdraw
node scripts/live-studionet-milestone.mjs --stage refusals --challenge <url>
node scripts/live-studionet-milestone.mjs --stage challenge-post
node scripts/live-studionet-milestone.mjs --stage challenge-submit --evidence <url>
node scripts/live-studionet-milestone.mjs --stage challenge --challenge <url>
node scripts/live-studionet-milestone.mjs --stage bond-withdraw --id 1
node scripts/live-studionet-milestone.mjs --stage injected
node scripts/live-studionet-milestone.mjs --stage injected-submit --injected <url>
node scripts/live-studionet-milestone.mjs --stage evaluate-injected --id 2
node scripts/live-studionet-milestone.mjs --stage refund
node scripts/live-studionet-milestone.mjs --stage report
```

Evidence sources are published at **commit-pinned** raw URLs
(`raw.githubusercontent.com/unifyWeb3/contentbounty/<sha>/docs/proofs/…`). The
branch-pinned form is CDN-cached and served a stale revision during this work,
which is why the commit-pinned form is used.

| Evidence file | Commit | Claim tag inside |
|---|---|---|
| `docs/proofs/studionet-baseline-b1-evidence.txt` | `7881242` | v2.2 baseline, `cb-ec1905bf8acce879ed18` |
| `docs/proofs/milestone-1-evidence.txt` | `c4d7a4a` | v2.3 bounty 0, `cb-f9446285a70487b76ec3` |
| `docs/proofs/milestone-1-challenge-scenario-evidence.txt` | `55d47f9` | v2.3 bounty 1, `cb-10d3541b046ea3e0bc0c` |
| `docs/proofs/milestone-1-injected-evidence.txt` | `55d47f9` | v2.3 bounty 2, `cb-ccf1e35d3163d2e23b16` |
| `docs/proofs/milestone-1-challenge-evidence.txt` | `c4d7a4a` | challenge evidence (no tag required) |

---

## 3. The baseline audit, in one place

`state/AUDIT.md` has the full audit with 14 findings. The two the milestone
had to answer:

* **The equivalence-principle fix is real.** Every nondeterministic entry point
  runs `gl.vm.run_nondet_unsafe` with a validator that re-runs the same work
  itself and compares the payout-controlling fields
  (`contracts/content_bounty.py:391-398`, `:403-411`, `:426-433`, `:438-445`).
  The verdict is derived by deterministic contract code from the per-criterion
  bits (`:218-220`, `:276-281`). The historical "hardcoded approved with score
  100" defect is gone.
* **What was still weak** and is now fixed: leader free text persisted
  (F-1), value moved inside state transitions (F-2), the dispute window was an
  invisible constant (F-3), an upheld challenge left contradictory verdict
  fields (F-4), the interface could offer an action the contract rejects (F-5),
  the action rules were duplicated between the contract and the interface
  (F-6), a metric was labelled more strongly than its evidence (F-7), the rubric
  was not bound by a digest (F-8), the runtime warned about reading storage in
  nondeterministic mode (F-9), the documented lint gate needed a 216 MB
  download (F-10).

The red state for the new behaviour is captured in
`state/red-state-baseline.txt`: the new tests fail against the
`baseline-accepted` contract.

---

## 4. What GEN is worth on Studionet, and one honest discrepancy

**Nothing.** `sim_fundAccount` mints the balances; Studionet state is
temporary and the official network reference lists it as a hosted development
environment. The live run proves that value moves through the escrow and back
out through the withdrawal path. It does not prove money.

**The one discrepancy, stated exactly.** After every withdrawal the contract's
published liability was exactly correct:

```text
bounty_escrow_total       2000000000000000000
refund_pending_total                0
reward_pending_total                0
bond_escrowed_total                 0
bond_pending_total                  0
expected_native_balance  2000000000000000000
```

The contract's observed native balance was `2122000000000000000` wei — exactly
`122000000000000` wei more. That difference is accounted for precisely: the
refusal suite was run twice, and each run sent value on three **reverted**
payable calls (0.01 + 0.001 + 0.05 GEN). The Studionet simulator credits the
value of a reverted payable call and does not roll it back, so

```text
2 × (0.01 + 0.001 + 0.05) GEN = 0.122 GEN = 122000000000000 wei
```

which is the observed gap to the wei. The contract's own liability accounting
is exact and is what the contract guarantees; the native balance additionally
contains value stranded by reverted calls. **This is a platform behaviour, not
a contract defect, and it was not verified on Bradbury.** It is recorded as a
candidate for a future milestone (an explicit excess-refund rule), and
deliberately not fixed here because a sweeper would be a new authority over
funds.

---

## 5. Bugs found in the contract while redeploying it

1. **`DIGEST_MISMATCH` was not a declared challenge error class.** A challenge
   whose evidence source changed after it was filed made `review_challenge`
   **revert** instead of returning `INCONCLUSIVE`, so the challenge could only
   be resolved by waiting for the 48-hour review deadline. Fixed by adding the
   class (`contracts/content_bounty.py`, `CHALLENGE_ERROR_CLASSES`) and a
   regression test
   (`::test_challenge_review_with_mutated_challenge_source_is_inconclusive_not_a_revert`).
2. **The first anchor neutralisation still contained the anchor.** The
   replacement token embedded the anchor text, so the anchor was still present
   in the evidence the model saw. Replaced with markers that contain no anchor
   substring.

---

## 6. Operational finding about the network

On Studionet a **finalized receipt does not guarantee that the next
transaction is executed against the state that includes it**. Two transactions
executed against a stale snapshot and reverted with "Challenge does not exist"
and "Submission does not exist". The harness now polls the **finalized** read
state until the expected change is visible before sending a dependent
transaction, and pins every read with `transactionHashVariant=finalized`. The
same discipline is required for any reader of this deployment.

---

## 7. Verification commands

```bash
npm run lint:contract       # genvm-lint lint        -> Lint passed (3 checks)
npm run check:contract      # genvm-lint check --json -> ok, 24 methods (11 view / 13 write)
npm run test:contract       # pytest tests/direct    -> 84 passed
npm run test:evidence       # pytest tests/unit      -> 2 passed
npm run test:network        # node --test            -> all passed
npm run test:lifecycle      # node --test            -> all passed
npm --prefix frontend test  # vitest                 -> 111 passed
npm run build:frontend      # vue-tsc -b && vite build
npm run verify:frontend-bundle
```

`npm run check:contract` needs `genvm-universal.tar.xz` (216 630 904 bytes)
from the `genlayerlabs/genvm` v0.2.16 release. The newer asset name
`genvm-runners-all.tar.xz` returns HTTP 404 for v0.2.16 and is tried first.
The bundle was fetched with the linter's own
`genvm-lint download --version v0.2.16` command; no cache was hand-seeded.
