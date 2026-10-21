# ContentBounty — Baseline Audit (Stage 0)

Audit date: 2026-10-21
Repository: `github.com/unifyWeb3/contentbounty`
Baseline audited: `main` @ `cf85066` (default-branch HEAD) — tagged `baseline-accepted`
Baseline live deployment audited: Bradbury (chain 4221) `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8`
Baseline source commit of that deployment: `2e35764`
Baseline source sha256: `b5e89cf03ae7f79d1c6d0b0c45ee3b8e567fe4fb7f57fea0b370e165a33df36a`

Method: read the contract, deploy script, tests, frontend and docs; read the
installed `genlayer-py` / `genlayer-std` sources; read the official GenLayer
documentation (`docs.genlayer.com`, including *The Equivalence Principle* and
*Networks*); and exercise the baseline contract live on Studionet.

---

## 0. Baseline identity and byte-level provenance

| Item | Value |
|---|---|
| Baseline tag | `baseline-accepted` (annotated) → `cf85066` |
| Baseline source-of-truth tag for the deployed code | `baseline-accepted-source` → `2e35764` |
| Advertised live address (baseline) | `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8` (Bradbury 4221) |
| Deployment tx (baseline) | `0x7b5ef343bffa78cc0f735ce0c7e41488b288a9bbe4c72d417a36f70349f18532` |
| Repo file sha256 at `cf85066` | `b5e89cf03ae7f79d1c6d0b0c45ee3b8e567fe4fb7f57fea0b370e165a33df36a` |
| `gen_getContractCode` of the deployed address (base64 → bytes) | 52 237 bytes, sha256 `b5e89cf0…33df36a` |

**Result: the deployed baseline contract and the repository file are byte-identical.**
Verified by reading the code back from the node, not by trusting the README.

Because the repository file is byte-identical between `2e35764` and `cf85066`,
the choice of baseline tag does not change the contract diff; it only changes
whether the post-deployment documentation commits are inside the diff window.
`baseline-accepted` is therefore placed on the default-branch HEAD, which is the
state the project presents as its accepted live product.

### 0.1 Live re-deployment of the baseline on Studionet (audit evidence, not the milestone)

The baseline contract was deployed unchanged to Studionet to observe its real
behaviour rather than reason about it.

| Step | Transaction | Observed |
|---|---|---|
| Deploy v2.2 baseline | `0xff7335905c814316aa2098bf3a9d05cd73648e46e6787240104a9691c96ca2eb` | `0xe798A2433e6274532df6f7f1EB007e25F2B69367`, FINALIZED / MAJORITY_AGREE |
| `post_bounty` (payable, 1 GEN) | `0xa0cef58eb245f9b7638dfa338a8ee19afe709783818ad8bd7e7e63e42968488a` | poster 2000 → 1000 GEN, contract balance 1 GEN |
| `cancel_bounty` (refund) | `0x3a7c6e3c70f875e5c8d4d6a535229862c9627fe1fab9b3933e1e3fa09bba93b8` | poster 1000 → 2000 GEN, contract balance 0 |
| `post_bounty` (bounty #1) | `0x05cb4ba4c974dfc9dcc7c61e4539ffacd1107aebc6fc3005d77eeb359e3a9e22` | FINALIZED / MAJORITY_AGREE |
| `submit_content` | `0x579e9774fbb6479a16e08a0e0a2c46a2eb019135a7b3e9ab6d01b809366b91a2` | digest `be7fa935…6e4bb4`, status `PENDING` |
| `evaluate_submission` | `0xcbaf53cdb26284664a61e37a60f052c090f5073e3ee74e0d9dea497c8edbd3a8` | `APPROVED_PENDING`, decision `APPROVE`, bits `11`, bucket `4`, `ALL_REQUIRED_CRITERIA_MET` |

**GEN on Studionet is faucet-simulated and worth nothing.** `sim_fundAccount`
mints balances out of nothing; Studionet state is temporary. It proves the
mechanics (escrow in, refund out, consensus evaluation, real LLM and web
render), not value.

---

## 1. The two reviewer complaints: are they fixed?

The prior review ("More Information Needed") said:

> nondeterministic web/LLM calls are defined but not used through an
> equivalence-principle execution path. More importantly, `evaluate_submission`
> currently ignores the AI result and hardcodes every submission as approved
> with score 100.

**Complaint 2 — "hardcoded every submission as approved with score 100": FIXED.**
There is no literal `{"approved": True, "score": 100}` anywhere in the current
contract. The verdict is derived deterministically from the per-criterion
booleans that the model returned:

* `contracts/content_bounty.py:218-220` — `decision = DECISION_APPROVE if met_count == len(criteria) else DECISION_REJECT`, `score_bucket = met_count * 4 // len(criteria)`, `reason_code` derived from the decision.
* `contracts/content_bounty.py:276-281` — `_valid_evaluation_shape` re-checks that `criteria_bits`, `decision` and `score_bucket` are mutually consistent, so an approved submission with score 0 cannot be persisted.

**Complaint 1 — "not used through an equivalence-principle execution path": FIXED,
and the fix is the substantive one, not the shape-only one.** The historical
audit (`AUDIT_REPORT.md`, finding C-1) had already noted that `365fdb5` only
validated the *shape* of the leader result. The current code no longer does
that. Every nondeterministic entry point runs `gl.vm.run_nondet_unsafe` with a
validator that **re-runs the same work itself** and compares the
payout-controlling fields:

```text
contracts/content_bounty.py:391-398   submit_content    leader+validator re-render the evidence, compare ok/hash/len/error/claim-tag
contracts/content_bounty.py:403-411   evaluate_submission leader+validator re-render AND re-judge, compare hash/decision/bits/bucket/reason/claim-tag
contracts/content_bounty.py:426-433   challenge_submission leader+validator re-render the challenge evidence
contracts/content_bounty.py:438-445   review_challenge  leader+validator re-render both sources AND re-judge, compare outcome/reason/error-class/hashes/claim-tag
```

This matches the official guidance in *The Equivalence Principle* ("Re-run the
same LLM/web task and compare the stable decision fields"; "A validator that
only checks `leader_result.calldata` for a valid JSON shape … is not performing
consensus"). The equivalence set is semantic (`decision` + per-criterion bits
+ score bucket + reason code + recomputed SHA-256 + claim-tag state), not
syntactic, and free-text feedback is deliberately excluded from it.

**Verdict: the earlier equivalence-principle fix is real, not cosmetic.**
Remaining caveat: the *leader's* free-text `feedback` is persisted although
validators do not verify it (see F-1).

---

## 2. Findings against the baseline

Severity: **C** critical, **H** high, **M** medium, **L** low.

### F-1 (H) — Unverified leader free text is persisted and presented as consensus output

`Submission.feedback` and `Challenge.proposed_feedback` store the leader
model's prose. The equivalence set excludes free text (correctly — two models
word things differently), so no validator ever recomputes it, yet the frontend
renders it in the same result card as `decision`, `criteria_bits` and
`score_bucket`.

Evidence: `contracts/content_bounty.py:212` (persisted `result[_F]`),
`:220` (feedback sliced to 280 chars), `:412` (written to storage),
`frontend/src/App.vue:1186` and `:1263` (rendered as the explanation).
Observed live on Studionet: `feedback = "Observations explicitly name GenLayer
and include an official GenLayer documentation URL."` — leader-authored,
validator-unverified.

Consequence: the last leader-controlled text channel remains in on-chain state.
This is the same class of defect the historical audit raised against
shape-only validation, one layer up.

### F-2 (H) — Value leaves the contract as a side effect of a state transition

`claim_reward`, `cancel_bounty`, `expire_bounty`, `finalize_challenge` and
`timeout_challenge` all call `_Recipient(...).emit_transfer(...)` in the same
transaction that mutates state.

* `contracts/content_bounty.py:463` — `claim_reward` transfers the reward.
* `:472` — `cancel_bounty` transfers the refund.
* `:474` — `expire_bounty` transfers the refund.
* `:449` — `_release_challenge_bond` transfers the bond.

Consequence: a recipient that cannot receive (or a creator whose wallet is
temporarily unavailable) blocks settlement of the whole transaction, and every
outbound transfer is an external call inside a state transition. There is no
explicit on-chain escrow accounting: the contract's liability is implicit in
the sum of `bounty.reward` plus outstanding bonds, and nothing on chain states
that total.

### F-3 (H) — The dispute window is a hard-coded constant, so a creator's payout
cannot be exercised end to end in a test run

`CHALLENGE_WINDOW_SECONDS = 172800` (`contracts/content_bounty.py:99`) is
fixed at 48 hours and is not stored on the bounty. `claim_reward` requires
`self._now() >= submission.challenge_deadline`. The deadline is therefore
invisible in the bounty's own record until an approval happens, and no live
run shorter than 48 hours can reach the creator payout.

Observed on Studionet: `approved_at = 1792558366`,
`challenge_deadline = 1792731166` — exactly 172 800 s later.

### F-4 (H) — An upheld challenge leaves contradictory persisted verdict fields

In `finalize_challenge`, the upheld branch sets
`submission.status = REJECTED`, `decision = REJECT` and a new `reason_code`,
but it leaves `criteria_bits` and `score_bucket` at the values produced by the
*approval* it is overturning.

* `contracts/content_bounty.py:454` — `status/decision/reason_code` are
  overwritten; `criteria_bits` and `score_bucket` are not.

Consequence: `get_submission` can return `status = REJECTED`, `decision = REJECT`,
`criteria_bits = "11"`, `score_bucket = 4` — i.e. a rejected submission that
still claims every criterion was met and a perfect score. The frontend renders
exactly those fields (`frontend/src/App.vue:1182-1183`).

### F-5 (M) — The frontend can offer an action the contract rejects

`canExpire()` in `frontend/src/App.vue:1024-1028` checks the evaluation
deadline and the absence of a provisional winner, but not the absence of an
active challenge. The contract's `expire_bounty` additionally requires
`not self._bounty_has_active_challenge(bounty_id)`
(`contracts/content_bounty.py:474`). The "Expire permissionlessly" button is
therefore shown in exactly the state where the contract will revert.

The same gap exists for `submit_content`: the UI does not check
`MAX_SUBMISSIONS_PER_BOUNTY` or the one-submission-per-creator rule
(`contracts/content_bounty.py:390`), so it can offer a submission the contract
will reject.

### F-6 (M) — Action availability is duplicated between the contract and the UI

Every `canX()` predicate in `frontend/src/App.vue:291-400` re-implements a
contract rule by hand (`attempt_count < 3`, `now <= evaluation_deadline`,
`provisional_submission_id === submission.id`, …). Nothing ties the UI
predicates to the contract source, so the two can drift — and F-5 is the drift
that already exists.

### F-7 (M) — A metric is labelled more strongly than its evidence

`frontend/src/App.vue:1109` renders "verified successful finalizations" from
`transactions.value`, which is only the **local browser's** `localStorage`
(`frontend/src/App.vue:198-209`). It is not a chain-wide count. The adjacent
section copy is honest, the metric label is not.

### F-8 (M) — The rubric is committed but not bound by a digest

`Bounty.rubric_json` stores the canonical rubric, but no hash of it is
published. A reader cannot verify that the rubric used by the model is the
rubric that was posted, other than by trusting the stored string.

### F-9 (M) — Reading storage inside the nondeterministic block is flagged by the runtime

Every live run emits
`UserWarning: Detected pickling storage class. Reading storage in nondet mode
is not supported` from `/py/libs/genlayer/gl/_internal/storage.py:21`. The
leader/validator closures capture `self`, so the contract is pickled into the
nondeterministic block. The current code does not *read* storage there (all
values are copied out first), so the behaviour is correct today, but the
runtime is warning that the pattern is unsupported.

### F-10 (L) — The documented lint gate is only reproducible after a 216 MB download

`npm run check:contract` → `genvm-lint check` resolves
`https://github.com/genlayerlabs/genvm/releases/download/v0.2.16/genvm-universal.tar.xz`
(216 630 904 bytes). The newer asset name `genvm-runners-all.tar.xz` returns
**HTTP 404** for `v0.2.16`, and the linter tries that name first. The download
took over 50 minutes at the available bandwidth and was interrupted twice
before completing. `genvm-lint lint` (the fast AST gate, 3 checks) passes
immediately and is the check the reviewer asked for.

### F-11 (L) — `AUDIT_REPORT.md` still sits at the root describing a rejected revision

The file documents the `a09fe6a` / `c0a6f67` rejection ("do not resubmit this
commit"). The README disclaims it at the bottom, but a reviewer landing in the
repository root sees a rejection report first.

### F-12 (L) — History contains two deployer keys that were printed to a session log

`IMPLEMENTATION_LOG.md` records that a deployer private key was emitted into
session tool output and instructs that it be treated as compromised. The
addresses `0x3211d141…8d3` and `0x3d591588…a5d` are blocked in
`scripts/deployer-guard.mjs`. The keys themselves are not in the repository,
and the blocked-address guard is present and correct.

### F-13 (L) — Documentation claims that are not what the code does

* `README.md:97` — "The v2.2 deployment proof verifies lint 3/3, 19 methods
  (9 view/10 write), direct 67 pass, frontend 97 pass". The direct suite is 67
  tests and does pass; the "frontend 97 pass" figure is not reproducible from
  the repository (the frontend Vitest suite has far fewer tests).
* `README.md:30` — "48h challenge window" is true but, per F-3, it is a
  constant rather than a stored, poster-visible parameter.

### F-14 (L) — Claim-tag documentation invites exactly the mistake I made

`README.md:220-226` and `contracts/content_bounty.py:87` use 20 hex characters
(80 bits). A reader who re-derives the tag with the full 32-byte digest will
produce a 40-hex-character tag and get a deterministic `CLAIM_TAG_MISSING`.
This is not a contract defect — it is a documentation sharpness gap that costs
a full submission cycle. (Observed live during this audit: the first live
submission on Studionet reverted with `CLAIM_TAG_MISSING` for exactly this
reason.)

### Items that are **not** weak (checked and confirmed)

* No unauthenticated caller can create global state about another address. The
  only per-address maps are keyed by the **caller**: `creator_submission_ids`
  and `creator_submission_counts` are written with
  `gl.message.sender_address` (`:390`, `:399`); `challenge_fingerprints` is keyed
  by `(submission_id, reason_code, evidence_hash)`; `evidence_submission_ids`
  is keyed by `(bounty_id, digest)`. There is no map a caller can write about
  an arbitrary third-party address or label.
* Duplicate submissions are blocked per creator per bounty, per evidence digest
  per bounty, and per challenge fingerprint (`:390`, `:399`, `:434`).
* Refunds cannot double-pay: `cancel_bounty` requires `OPEN` + zero
  submissions, `expire_bounty` requires no winner, no provisional winner and no
  active challenge, and both set a terminal status that the other refuses.
* Bond routing happens exactly once (`bond_released` guard at `:449`).
* `evaluate_submission` never moves value; only `claim_reward` did (baseline).
* Deadlines come from `gl.message_raw['datetime']`, not from wall-clock time
  (`:122-126`), and every deadline is compared against it.
* Prompt injection is framed as data, not instructions: the evidence is
  JSON-escaped with `\u003c`, `\u003e`, `\u0026` (`:195`) and passed in a
  single `UNTRUSTED_INPUT_JSON=` line whose template is byte-identical for
  every submission. The *decision* is derived by deterministic code from the
  criterion bits, so injected text cannot select the verdict.
* Rubric validation is strict: JSON array, ≤ 8 criteria, unique alphanumeric
  ids, bounded requirement length, canonicalised with sorted keys (`:127-133`).
* The URI allowlist and host canonicalisation are strict (`:134-142`).
* The direct-mode suite covers the full legitimate path, refusals with
  positive controls, the adversarial cases, and money movement: **67 passed**
  (`pytest tests/direct -q` → `67 passed in 10.67s`, exit 0).

---

## 3. Toolchain and network facts established for this milestone

Read from the installed SDK and the official docs, not from memory:

* `genlayer-py` 0.18.0 (pinned `a3dc35e`), `genlayer-test` 0.29.2, `genvm-linter` 0.10.0.
* `gl.nondet.web.render(url, mode='text'|'html'|'screenshot')` returns a real
  `str` (the `_lazy_api` wrapper resolves eagerly), so `isinstance(x, str)`
  checks in the contract are correct.
* `gl.vm.run_nondet_unsafe(leader, validator)`: an unhandled validator
  exception counts as *Disagree*; the value the contract receives is the
  **leader's** result once validators accept it. Validator intermediates are
  not persisted unless the leader result carries them.
* Official *Networks* page: Studionet = `https://studio.genlayer.com/api`,
  chain id `61999`, **temporary** state, real LLM models, built-in faucet.
  Bradbury = chain id `4221`, **persistent**. The official GenLayer skills
  documentation states Studionet is gasless and that testnet accounts must be
  funded through the faucet, which is protected by a Cloudflare Turnstile
  captcha and **cannot be automated**. Funding a Bradbury account is therefore
  a human action and is out of scope for an autonomous run.
* `gen_getContractCode` takes `{"address": "0x…"}` (object) on Bradbury and a
  bare address string on Studionet; it returns base64 source code.
* Studionet accepts a 74 928-byte readable contract (verified by deploying the
  pre-minification v2.2 source), so Bradbury's pubdata limit does not constrain
  a Studionet deployment.
* `sim_fundAccount` on Studionet requires the amount as a JSON **number**, not
  a hex string, and mints simulated balances.

## 4. What the baseline audit authorises as milestone work

The baseline is sound where it matters most: the equivalence principle is real,
the persisted global state is caller-scoped, the money paths cannot double-pay,
and the prompt-injection surface is framed as data. The open defects that are
worth a milestone are F-1, F-2, F-3, F-4, F-5, F-6, F-7 and F-8 — all of them
are visible, all of them are provable with tests, and all of them can be
demonstrated on a live deployment.
