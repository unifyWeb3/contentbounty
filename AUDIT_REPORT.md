# ContentBounty GenLayer Resubmission Audit

**Audit date:** 2026-08-06  
**Repository:** `https://github.com/unifyWeb3/contentbounty`  
**Reviewed commit:** `a09fe6a` (`main`)  
**Current advertised deployment:** `0xFf546d6B1CD45d2859a705a7FA181807670B9015` on Studionet  
**Scope:** Intelligent contract, frontend, deployment workflow, documentation, security model, network choice, test evidence, hackathon positioning, supplied reviewer feedback, and the Git history surrounding the rejected revision.

## Executive verdict

The **use case is a strong fit for GenLayer**. Deciding whether web content satisfies natural-language bounty criteria is subjective, requires web access and LLM reasoning, and can trigger deterministic escrow settlement. That is precisely the category of problem for which an Intelligent Contract is useful.

The contract that was originally submitted had an even more direct blocker: it defined web/LLM functions but never executed them, ignored their potential result, and hardcoded every evaluation as approved with score 100. The supplied reviewer rejection is accurate and matches repository commit `c0a6f67` exactly.

Commit `365fdb5` later fixed that literal defect by calling `run_nondet_unsafe` and consuming its return value. The current implementation therefore no longer hardcodes approval. It still does **not provide the consensus guarantee claimed by the product**, however: the leader fetches and judges the content while validators only validate the result's shape. They do not independently fetch the evidence, rerun the judgment, or verify that the verdict follows from the criteria. A dishonest or compromised leader can return any well-formed approval and the validator function will accept it. Official guidance explicitly warns against treating format validation as substantive consensus.

The product also undermines its own trust model through unilateral poster approval, rejection, and cancellation; overstates Studionet's simulated transfers as real locked funds; treats accepted transactions as irreversible payouts before finalization; lacks tests; and exposes private keys insecurely in the frontend.

**Recommendation:** do not resubmit this commit with documentation-only changes. Build and demonstrate a materially revised v2. Keep the same use case, but redesign the adjudication and lifecycle around independent validator verification, immutable evidence, retryable inconclusive outcomes, explicit finality, and persistent-testnet balance proofs. If hackathon rules permit resubmission, describe it honestly as a rebuilt version of the prior submission rather than using a second listing to conceal the rejection.

## Reviewer feedback and verified chronology

The project owner supplied the following rejection message after the first audit draft:

> Thanks for the submission. The use case is interesting and the frontend appears to call contract methods, but the submitted contract has blocking genvm-lint errors: nondeterministic web/LLM calls are defined but not used through an equivalence-principle execution path. More importantly, evaluate_submission currently ignores the AI result and hardcodes every submission as approved with score 100. Please fix the evaluation flow to actually use gl.vm.run_nondet_unsafe or the equivalence principle result, rerun lint, and resubmit once the contract passes.

The message can be verified against the repository history:

| Stage | Commit | Verified contract behavior | Assessment |
|---|---|---|---|
| Rejected revision | `c0a6f67` | Defines `get_evaluation` and `validate_evaluation`, never calls either, then assigns `eval_result = {"approved": True, "score": 100, "feedback": "test"}` | Exact match for the reviewer's blocking finding |
| Additional rejected-revision defect | `c0a6f67` | Calls nonexistent/incorrect `gl.transfer`; bounty posting accepts a recorded reward argument but is not payable, so the claimed escrow was not actually funded | The evaluation would also error during attempted payout and the escrow claim was false |
| Mechanical repair | `365fdb5` | Calls `glvm.run_nondet_unsafe`, consumes `eval_result`, makes posting payable, and changes payout to `_Recipient(...).emit_transfer` | Fixes the hardcoded-result and transfer-path defects identified in the rejection |
| Current revision | `a09fe6a` | Retains the `365fdb5` evaluation design; validator verifies only bool/int/string shape | Original blocker is removed, but meaningful independent validation is still absent |
| Current verification state | `a09fe6a` | Repository contains no GenLayer lint/test configuration or recorded passing lint output | The reviewer's explicit "rerun lint" acceptance condition is not reproducibly satisfied |

This chronology matters. The original rejection was **not** a vague product-alignment decision: it was a correct code-level rejection of a dead AI path and hardcoded approval. The later fix should not be described as fully resolving GenLayer consensus merely because it calls `run_nondet_unsafe`; the equivalence rule must also verify the fact that controls payout.

## Severity summary

| Severity | Finding | Resubmission impact |
|---|---|---|
| Critical | Validators validate only output shape | The core GenLayer claim is not true; a leader can fabricate a valid-looking verdict |
| Critical | No reproducible passing `genvm-lint` result | The reviewer explicitly required lint to pass before resubmission |
| Critical | README and UI overclaim independent consensus | Reviewers are shown claims contradicted by the source code |
| Critical | Poster can manually approve or reject | Trustless adjudication and creator protection can be bypassed |
| Critical | Poster can cancel after submissions | A creator can do the work and still lose the settlement opportunity |
| High | Studionet is used as proof of real escrow | Studionet is temporary and value transfers are simulated |
| High | UI treats non-final status as completed payout | `ACCEPTED` is not irreversible; external transfers occur on finalization |
| High | No contract, consensus, integration, or payout tests | There is no reproducible evidence that the claimed protocol works |
| High | Prompt-injection defenses do not protect the decision | Untrusted content and user criteria can steer the evaluator |
| High | Mutable/truncated URL content is the settlement evidence | Reviewers cannot reproduce exactly what validators judged |
| High | Private keys are stored unencrypted in browser storage | A normal XSS or browser compromise can steal all user funds |
| Medium | SDK and deployment versions are inconsistent and outdated | Behavior is fragile and does not match the current toolchain or docs |
| Medium | Frontend contains undefined handlers and fabricated receipt fallbacks | Reviewer-facing workflows can fail or show evidence that was never read |
| Medium | Contract lifecycle and data model are incomplete | Retries, deadlines, multiple submissions, provenance, and closure are ambiguous |
| Medium | Unbounded reads and serial N+1 frontend requests | The application stops scaling after modest use |
| Low | Repository polish and accessibility are incomplete | The project presents as a prototype rather than a finished submission |

## What is already correct

These parts should be retained conceptually:

- The product chooses a genuinely subjective settlement problem rather than using an LLM decoratively.
- `post_bounty` is payable and records the bounty criteria and reward on-chain.
- The leader currently demonstrates both GenLayer web access and model execution with `gl.nondet.web.render` and `gl.nondet.exec_prompt`.
- Unlike the rejected `c0a6f67` revision, the current contract calls `run_nondet_unsafe` and uses the returned `eval_result` rather than a hardcoded approval.
- Settlement is attempted in deterministic code with `emit_transfer`, rather than allowing model output to execute arbitrary calls.
- The UI distinguishes an execution error from a rejected submission in the live evaluation path.
- The README clearly explains why an ordinary deterministic smart contract cannot perform the web-content judgment.
- The repository is clean at commit `a09fe6a`; the missing tests and tooling are also missing from the committed Git tree, so they are not merely files lost during the Windows-to-WSL copy.

Those strengths make the project salvageable. The required change is not a new use case; it is a correct protocol and evidence model.

## Detailed findings

### C-1. The validator does not verify the evaluation

**Evidence:** `contracts/content_bounty.py:112-197`, especially `170-186`.

The leader closure performs all meaningful work:

1. Fetches the submitted URL.
2. Truncates the page.
3. Prompts an LLM.
4. Normalizes the returned verdict.

The validator closure checks only:

- the result is a `glvm.Return`;
- calldata is a dictionary;
- `approved` is a boolean;
- `score` is an integer between 0 and 100;
- `feedback` is a string.

It never receives or reuses the criteria and URL in a substantive validation step. Consequently these malicious leader results all pass:

```json
{"approved": true, "score": 100, "feedback": "Excellent work."}
```

```json
{"approved": false, "score": 0, "feedback": "Rejected."}
```

The validators cannot tell which result is supported by the webpage. The exact wording in the source confirms that this was intentional: it calls the validator a "shape-only" check designed to avoid LLM disagreement. That solves nondeterminism by removing verification of the important fact.

**Impact:** any leader can determine who gets paid. The central security and product claim is false.

**Required fix:** validators must independently obtain the relevant evidence and rerun a bounded judgment. Define an equivalence principle over decision semantics, not JSON syntax. A practical design is exact agreement on `decision` and per-criterion booleans, plus a documented score bucket or tolerance. Feedback text should not determine consensus.

### C-2. Public claims contradict the implementation

**Evidence:** `README.md:7-13`, `48-51`, `64-77`, `93-94`, `107-112`, `128-151`, `155-180`; `frontend/src/App.vue:245-292`, `392`, `434`.

The README says validators independently fetch and judge the page, no manual approval exists, no single party can fake the outcome, and consensus is verifiable from every UI evaluation. In reality:

- only the leader fetches and judges;
- validators accept any correctly shaped verdict;
- manual approve/reject methods exist;
- cancellation can return the escrow after work was submitted;
- evaluation transaction evidence is only kept in component memory;
- all approved/rejected statuses are labeled as consensus, including manual decisions.

This is more damaging than an unfinished feature because a technical reviewer can compare the prose and source in minutes.

**Required fix:** first make the protocol true, then rewrite every claim narrowly. Use separate on-chain decision origins such as `CONSENSUS`, `POSTER_OVERRIDE` only if an override remains, and never display consensus evidence without a transaction hash and parsed receipt/event data.

### C-3. Manual decisions bypass the advertised trust model

**Evidence:** `contracts/content_bounty.py:199-235`; corresponding frontend calls at `frontend/src/App.vue:1081-1148`.

`approve_with_reward` permits the poster to choose an arbitrary pending submission, payout amount, and feedback. `reject_submission` permits the poster to reject any pending submission without AI evaluation. The resulting storage uses the same `approved` and `rejected` statuses as consensus decisions.

**Impact:** the poster remains the adjudicator. They can reject valid work, approve unrelated work, pay less than the advertised bounty, and generate a status the UI describes as GenLayer consensus.

**Required fix:** remove these methods from the trustless settlement path. If the product must support negotiated/manual settlement, model it as a separate, explicitly labeled bounty type selected at creation. It must not share claims or status labels with consensus adjudication.

### C-4. Cancellation can defeat creator protection

**Evidence:** `contracts/content_bounty.py:237-247`.

The only cancellation conditions are poster ownership and `bounty.status == "open"`. The poster can cancel after one or many submissions have arrived, before triggering evaluation.

**Impact:** the README's motivating failure mode still exists. A poster can collect work or links, cancel, and reclaim the entire reward.

**Required fix:** define a deadline and cancellation policy in storage. A simple defensible rule is:

- before the first submission: poster may cancel and receive a refund;
- after the first valid submission and before deadline: poster may not cancel;
- after deadline with no valid submissions: permissionless expiry/refund;
- after deadline with pending evaluations: allow a documented grace period and retry/appeal process.

### C-5. The reviewer-required `genvm-lint` proof is still absent

**Evidence:** supplied rejection message, committed repository tree, root `package.json`, and `frontend/package.json`.

The reviewer did not merely ask for the hardcoded result to be replaced. The explicit resubmission condition was to rerun `genvm-lint` and resubmit **once the contract passes**. The current repository has no lint script, lint configuration, CI workflow, captured output, or documented command that proves commit `a09fe6a` passes the current GenVM linter.

Commit `365fdb5` says the repaired flow was verified on Studionet, but a successful transaction is not a substitute for static linting. Network execution and lint enforce different properties. The current use of a pinned older Python dependency, `glvm.run_nondet_unsafe`, and direct compatibility workarounds makes a fresh lint run especially important.

**Impact:** even if all other product issues were ignored, the repository does not contain evidence that the reviewer's stated gate has been met. Resubmitting without a clean, reproducible lint result risks an immediate repeat rejection.

**Required fix:** migrate to or verify against the current official toolchain, add an exact `lint` command to the project, run it from a clean checkout, fix every error and warning that is submission-blocking, and run it in CI. Record the tool version and include the passing command/output in the resubmission evidence. Do not paste an unverifiable screenshot as the only proof.

### H-1. Network claims confuse development simulation with persistent proof

**Evidence:** `deploy.mjs:1-30`, `frontend/src/App.vue:538-589`, `.env.example:1-7`, `README.md:15-16`, `85-94`, `162-165`, `247-248`.

The project is hardcoded to Studionet. Official network guidance distinguishes the environments:

- **Bradbury:** production-like persistent testnet for real AI workloads and application proof.
- **Asimov:** persistent infrastructure/stress testnet and the appropriate fallback while Bradbury is unavailable.
- **Studionet:** temporary hosted development environment for quick experiments.

Studio balances, gas, and transfers are simulated. The README partly acknowledges this at line 247, but elsewhere says rewards are "real, locked funds" and presents the Studio deployment as proof of escrow.

**Required fix:** make network configuration environment-driven. During the reported Bradbury downtime:

1. Deploy the final source to Asimov for persistent evidence.
2. Also deploy to Studionet for an easy reviewer demo.
3. Once Bradbury is restored, deploy the identical tagged source there and use it as the primary proof.
4. Show network name, chain ID, contract address, source commit, deployment transaction, and limitations in the README.

### H-2. Transaction acceptance is treated as irreversible completion

**Evidence:** `frontend/src/App.vue:913-938`, `973-989`, `1010-1051`, `1111-1146`.

The UI calls `waitForTransactionReceipt` and treats `MAJORITY_AGREE`, `status === "success"`, or numeric status `5` as success. It immediately says "reward released" or "sent to creator."

Official transaction-state guidance says only `FINALIZED` is irreversible. `ACCEPTED` remains inside the appeal/finality window. Value transfers to external accounts execute at finalization, and an accepted/finalized consensus result does not by itself prove that execution and transfer succeeded; the execution result and final balance delta must be checked.

**Required fix:** model at least these UI states:

```text
SUBMITTED -> PROPOSING/VOTING -> ACCEPTED (appealable) -> FINALIZED -> PAYOUT CONFIRMED
                                          \-> APPEALED / REOPENED
```

Do not say "paid" before finalization and recipient balance confirmation. Persist transaction hashes in contract events or indexed app state so proof survives reloads.

### H-3. The repository has no reproducible validation suite

**Evidence:** committed tree and package scripts. `frontend/package.json` only defines `dev`, `build`, and `preview`; the root package has no scripts. There is no `tests/`, `gltest.config.yaml`, CI workflow, linter configuration, or contract test dependency.

Missing evidence includes:

- GenVM contract linting;
- deterministic direct tests;
- validator agreement and dissent tests;
- malicious-leader tests;
- integration tests against real validators;
- prompt-injection cases;
- payout and refund balance-delta tests;
- frontend unit or end-to-end tests;
- a repeatable deployment smoke test.

Official testing guidance supports direct leader/validator execution, including running validators against chosen leader outputs. This project particularly needs a test in which the leader returns a fabricated approval and independent validators reject it.

**Required fix:** adopt the current project boilerplate's lint/test layout and add the matrix in the testing section below. CI must run it on every commit used in the submission.

### H-4. Prompt injection protections are ineffective

**Evidence:** `contracts/content_bounty.py:128-168`; claims at `README.md:153-159`.

The prompt directly interpolates two untrusted strings, poster-authored criteria and page content, into the same instruction context. The fetched content is not isolated with trustworthy delimiters, sanitized, greyboxed, summarized in a separate constrained stage, or checked for instruction-like text. A strict JSON output shape only constrains syntax; it does not stop a page from persuading the model to approve.

The validator shape check compounds the problem because validators do not reject a manipulated semantic result.

**Required fix:** use a structured rubric and a staged pipeline:

1. Fetch and normalize evidence.
2. Place it inside explicit untrusted-evidence delimiters.
3. Extract factual observations without making the payout decision.
4. Evaluate each immutable criterion against those observations.
5. Have validators independently repeat the process.
6. Reach equivalence over per-criterion results and the final decision.

Add adversarial webpages and criteria to tests. Prompt hardening reduces risk; independent validation is the security boundary.

### H-5. Settlement evidence is mutable and incomplete

**Evidence:** `contracts/content_bounty.py:80-97`, `109-136`.

Only a URL is stored. The page owner may change the content before evaluation, between validators, after evaluation, or before an appeal. The contract also evaluates only the first 3,000 characters. A submitter can place compliant content at the front and contradictory or missing material later, or move content after winning.

**Required fix:** accept content-addressed or immutable evidence where possible:

- IPFS/Arweave CID;
- Git commit and exact repository path;
- a canonical snapshot with a stored content hash;
- a trusted archive URL plus digest.

Store `evidence_hash`, fetch timestamp/block context, evaluator version, rubric version, and evaluation transaction ID. If ordinary dynamic URLs remain supported, label their guarantees as weaker and define what happens when validators fetch different content.

### H-6. Browser private-key handling is unsafe

**Evidence:** `frontend/src/App.vue:92`, `115`, `707-756`, `1151-1159`.

The frontend displays private keys, accepts pasted keys, and writes them unencrypted to `localStorage`. Disconnect deliberately leaves the key there, and page load silently reconnects it. Any XSS, compromised dependency, malicious browser extension, or shared-machine user can recover the key.

**Required fix:** use a supported injected wallet or explicit external signer flow. For a disposable Studio-only demo wallet, keep it memory-only and clearly label it as disposable; never use the same key on a persistent network. Disconnect must remove session credentials. Do not implement production custody in application JavaScript.

### M-1. GenLayer SDK versions and imports are inconsistent

**Evidence:** root `package.json`, `frontend/package.json`, `deploy.mjs:1-2`.

- Root dependency: `genlayer-js@^0.28.4`.
- Frontend dependency: `genlayer-js@^0.23.1`.
- Deployment script imports directly from `./frontend/node_modules`, so the root dependency is ignored.
- The current official repository/boilerplate reviewed during this audit uses the 1.x SDK line (`1.1.8` at review time).
- Current GenVM APIs expose `run_nondet_default`, `run_nondet`, and higher-level equivalence helpers; this contract uses the older `run_nondet_unsafe` interface and a pinned Python dependency hash.

**Impact:** code, receipt parsing, transaction states, and docs belong to different SDK generations.

**Required fix:** migrate contract, frontend, tests, and deployment script as one versioned stack based on the current boilerplate. Do not upgrade one package in isolation. Pin exact versions for the submission tag and document them.

### M-2. Frontend contains nonfunctional controls

**Evidence:** template references at `frontend/src/App.vue:497-516`; no script definitions exist for `openAdminEdit`, `adminCancel`, or `saveNote`.

These controls can fail at runtime. The admin cancel concept is also invalid: the contract only allows the bounty poster to cancel, so an arbitrary configured frontend admin cannot cancel other posters' bounties. `VITE_ADMIN_ADDRESS` only hides or shows client-side UI and grants no on-chain authority.

**Required fix:** remove the pseudo-admin dashboard unless there is a real, narrowly justified on-chain role. Delete unfinished controls or implement only behavior supported by the contract. Treat frontend gating as presentation, never authorization.

### M-3. The UI fabricates missing consensus evidence

**Evidence:** `frontend/src/App.vue:245-283`, `1064-1078`.

When live receipt information is missing, the UI displays "Majority agreed" and "Succeeded" anyway. `readLeaderOutcome` also treats a missing execution-result field as success. `evalInfo` is in-memory only, so these fabricated fallbacks are what users see after every reload. Manual decisions receive the same consensus card because display logic only checks `approved` or `rejected`.

**Required fix:** use explicit unknown states:

- `Evidence unavailable` when no receipt/event was loaded;
- `Execution result unavailable` when the receipt lacks the field;
- separate decision origins;
- a durable transaction reference stored on-chain or derived from events/indexing.

Never infer proof from absence.

### M-4. Contract input and state invariants are insufficient

**Evidence:** `contracts/content_bounty.py:56-98`, `116-168`, `188-247`.

Problems include:

- URL validation is only `startswith("http")`; malformed and unexpected schemes/hosts pass.
- No maximum lengths exist for title, description, criteria, URL, or feedback.
- No contract-level duplicate URL or one-submission-per-creator rule exists; frontend checks are bypassable.
- `approved` and `score` are not constrained together, so approval with score 0 is valid.
- Fetch, parsing, or model errors become permanent rejection instead of an inconclusive/retryable result.
- An approved submission closes the bounty but leaves all other submissions `pending` forever.
- There is no deadline, evaluation attempt count, retry policy, evaluator/rubric version, or provenance.
- `admin` is stored but unused.
- Addresses are stored as strings rather than the SDK's address type.
- It is unclear whether anyone or only the poster is intended to trigger evaluation; the contract allows anyone while the frontend only shows the control to the poster.

**Required fix:** define these invariants before coding. Keep the number of states small and make every transition explicit and tested.

### M-5. Read paths are unbounded and the frontend multiplies them

**Evidence:** `contracts/content_bounty.py:263-294`; `frontend/src/App.vue:833-879`.

`get_all_bounties` walks every bounty and `get_submissions_for_bounty` walks every submission. `loadMine` and `loadAll` then issue one serial submission query per bounty. This creates O(bounties x submissions) work plus serial network latency.

**Required fix:** add indexed storage and pagination. Store submission IDs by bounty and by creator, provide page/cursor arguments, and load independent pages concurrently where appropriate. Events can support history/indexed views without full-state scans.

### M-6. Amount handling loses precision

**Evidence:** `frontend/src/App.vue:640-651`, `687-692`, `899-912`, `1085-1107`.

Contract `u256` values are typed as JavaScript `number`, formatted with `Number()`, and divided using floating point. User rewards are parsed with `parseFloat`, rounded to nine decimal places, then scaled to wei. Large values can exceed JavaScript's safe integer range and legitimate 18-decimal values are silently rounded.

**Required fix:** represent all on-chain integers as `bigint` or decimal strings. Use the SDK's unit parsing/formatting helpers and reject excessive decimal precision explicitly.

### M-7. Activity and admin data are stale and expensive

**Evidence:** tab assignment at `frontend/src/App.vue:17-21`; loading functions at `797-879`; startup at `1151-1161`.

Changing tabs only changes `activeTab`; there is no watcher or tab handler that calls `loadMine` or `loadAll`. Startup loads only bounties. The relevant data is refreshed incidentally after some writes, so a reviewer can open an empty or stale screen.

**Required fix:** load data on route/tab entry, add visible loading/error/empty states, and replace the serial N+1 query model.

### L-1. Repository and presentation polish are incomplete

**Evidence:** `frontend/src/main.ts:1-4`, `frontend/src/style.css`, `frontend/index.html:1-12`, committed default assets.

- The default Vite stylesheet is still imported and defines global `:root`, body, heading, and `#app` rules that conflict with the application's embedded CSS.
- The HTML title is still `frontend`.
- Default Vite/Vue images and favicon remain committed.
- There is no hosted frontend URL in the README.
- The app uses symbols/text where accessible icon buttons and labels would be clearer.
- Several controls lack robust focus, keyboard, and screen-reader treatment.
- The dense header/tab layout needs mobile viewport verification.
- Runtime Google Fonts create an avoidable external dependency for a demo.

These presentation issues were not cited in the supplied rejection, but they weaken reviewer confidence and should be cleared before resubmission.

## Proposed v2 protocol

### 1. Bounty creation

Store a bounded, structured bounty record:

```text
bounty_id
poster: Address
reward: u256
title / description with explicit length limits
rubric_version
criteria[]: stable IDs + bounded natural-language requirements
submission_deadline
evaluation_deadline or grace period
status: OPEN | LOCKED | FILLED | EXPIRED | CANCELLED
```

Creation escrows the full advertised reward. Cancellation is allowed only before the first valid submission, or after a clearly defined no-submission expiry.

### 2. Submission and evidence

Store:

```text
submission_id
bounty_id
creator: Address
canonical evidence URI
evidence content hash/CID/commit
submitted_at
status: PENDING | EVALUATING | APPROVED | REJECTED | INCONCLUSIVE | SUPERSEDED
attempt_count
latest evaluation provenance
```

Enforce duplicate and per-creator rules in the contract. Prefer content-addressed evidence. If a web snapshot service is used, its trust assumptions must be documented.

### 3. Leader evaluation

The leader should:

1. Resolve the canonical evidence.
2. Verify its digest when one is provided.
3. Normalize content deterministically and enforce a documented maximum size.
4. Treat the content as untrusted evidence.
5. Evaluate every criterion separately.
6. Return a compact stable structure such as:

```json
{
  "decision": "APPROVE",
  "criteria": [
    {"id": "c1", "met": true},
    {"id": "c2", "met": true}
  ],
  "score_bucket": 4,
  "evidence_hash": "0x...",
  "reason_code": "ALL_REQUIRED_CRITERIA_MET"
}
```

Natural-language feedback may be stored or emitted separately, but it should not be part of equivalence.

### 4. Independent validator evaluation

Each validator must independently:

1. Fetch/resolve the same evidence.
2. Verify the digest.
3. Run the same rubric prompt or supported equivalence helper.
4. Derive its own structured result.
5. Compare semantically important fields.

A defensible equivalence rule could require:

- exact `evidence_hash` match;
- exact final `decision` match;
- exact agreement on all required criterion booleans;
- exact score bucket or difference no greater than one documented bucket;
- ignore prose feedback equality.

The validator must reject a syntactically valid leader output when its own evaluation disagrees.

### 5. Three-way result model

Use `APPROVE`, `REJECT`, and `INCONCLUSIVE`.

- `APPROVE`: substantive evaluation says all required criteria are met.
- `REJECT`: evidence was successfully fetched and judged not to meet the rubric.
- `INCONCLUSIVE`: timeout, fetch mismatch, empty evidence, model/parser failure, or validator disagreement that should permit retry.

Infrastructure failures must not permanently punish the creator. Bound retries and define who pays/initiates them.

### 6. Settlement and finality

On accepted approval, mark the decision as accepted/pending finality. Emit enough provenance to locate the evaluation transaction and result. Do not represent the creator as paid until the transaction is finalized and the external transfer is confirmed.

Use GenLayer's protocol appeal window instead of inventing a fake instant-finality model. The UI should show the deadline/status and link directly to the transaction/appeal surface.

### 7. Multiple submissions

Choose and document one policy:

- **First finalized approval wins:** subsequent submissions become `SUPERSEDED`; or
- **Best before deadline:** evaluate all, then deterministically select by a documented rule; or
- **Single submission bounty:** close submissions after the first valid entry.

The current implicit first evaluated approval wins invites ordering manipulation. Evaluation triggering should be permissionless or driven by a clear deadline so the poster cannot suppress a valid candidate.

## Required test matrix

### Contract lint and deterministic tests

- Current GenVM/boilerplate lint passes.
- Empty and overlong title/criteria/evidence URI fail.
- Zero reward fails.
- Invalid bounty and submission IDs fail.
- Duplicate creator and duplicate evidence rules work on-chain.
- Only allowed state transitions succeed.
- Cancellation before submission succeeds.
- Cancellation after submission fails.
- Expiry and refund rules work exactly at boundaries.
- Manual trustless-path approval/rejection methods do not exist.
- Approved payout equals the escrowed amount.
- All losing/pending submissions move to a terminal state when required.

### Consensus and adversarial tests

- Honest leader and validators approve clearly compliant content.
- Honest leader and validators reject clearly noncompliant content.
- A malicious leader returns approval for noncompliant content; validator rejects.
- A malicious leader returns rejection for compliant content; validator rejects.
- Leader changes score/criterion booleans; equivalence behaves as documented.
- Validator wording differs but semantic result agrees.
- Validators fetching a different evidence hash return inconclusive/disagree.
- Prompt injection in page text cannot force approval.
- Prompt injection in bounty criteria is bounded and does not override protocol instructions.
- Long content cannot hide decisive evidence beyond an undocumented truncation boundary.

### Reliability tests

- Fetch timeout, DNS failure, 404, empty page, and unsupported content return `INCONCLUSIVE`, not permanent rejection.
- Parser/model failure is retryable and attempt count is bounded.
- Content mutation or digest mismatch is detected.
- Repeated evaluation cannot double-pay.
- Concurrent submissions/evaluations cannot double-fill the bounty.

### Network integration tests

- Real validators execute leader and validator paths on the selected network.
- Accepted status is displayed as appealable/pending.
- Finalized status is detected separately.
- Creator and poster balance deltas prove payout/refund on a persistent network.
- Explorer transaction, contract, and appeal links resolve.
- The deployed bytecode/source corresponds to the tagged commit.

### Frontend tests

- Production build and typecheck finish successfully.
- Wallet connect/disconnect does not persist raw keys.
- Post, submit, evaluate, inconclusive, reject, appeal/pending, finalized, and payout-confirmed states render correctly.
- Missing receipt data renders `unknown`, not invented success.
- Decision origin is displayed accurately.
- Transaction evidence survives reload.
- `u256` values round-trip without precision loss.
- Desktop and mobile end-to-end happy paths pass.
- Keyboard navigation, labels, focus, contrast, and overflow are checked.

## Network and deployment plan

Use this order:

1. **Bradbury** for the final production-like proof when it is restored.
2. **Asimov** as the persistent fallback during Bradbury downtime.
3. **Studionet** for reviewer convenience and development only.

Deploy the same tagged source to the persistent testnet and Studionet. The README should include a table like:

| Purpose | Network | Contract | Source tag | What it proves |
|---|---|---|---|---|
| Persistent settlement proof | Asimov/Bradbury | `0x...` | `v2.0.0` | Transaction history, finality, balance deltas, appeals |
| Fast interactive demo | Studionet | `0x...` | `v2.0.0` | Reviewer can quickly exercise UI; transfers are simulated |

Keep RPC and explorer configuration in one network map rather than hardcoding Studionet throughout the component. The deployment script should consume the installed root SDK normally, accept an explicit supported network argument, verify chain ID, and print deployment plus source metadata.

## Remediation roadmap

### Phase 0: freeze claims and capture the prior state

- Tag the rejected version for reference.
- Preserve the rejection message/request-for-information and any portal feedback in private project notes.
- Stop advertising the current deployment as independent validator adjudication or real escrow proof.
- Confirm that hackathon rules permit a revised/resubmitted product entry.

### Phase 1: protocol specification

- Write the lifecycle, actor permissions, deadlines, cancellation, retries, winner policy, and finality states before editing code.
- Define immutable evidence requirements and the three-way result model.
- Define the exact equivalence principle and provide examples of agreement/disagreement.
- Decide whether evaluation is permissionless. Permissionless triggering is preferable for avoiding poster suppression, with rate/bond controls if needed.

### Phase 2: clean boilerplate migration

- Start from the current official GenLayer project boilerplate.
- Pin one compatible GenVM/CLI/JS toolchain.
- Port the storage model and core deterministic methods.
- Add linting, direct tests, consensus tests, and CI before adding the frontend.

### Phase 3: secure adjudication

- Implement content-addressed evidence and digest verification.
- Implement structured per-criterion evaluation.
- Implement genuinely independent validator verification.
- Add prompt-injection and malicious-leader tests.
- Implement inconclusive/retry behavior and provenance/events.

### Phase 4: settlement and appeals

- Implement cancellation/expiry rules.
- Prevent double settlement and ordering abuse.
- Integrate accepted, appealable, finalized, and transfer-confirmed states.
- Prove payout and refund using balance deltas on Asimov or Bradbury.

### Phase 5: frontend rebuild/hardening

- Use an external signer; remove raw private-key persistence.
- Centralize network configuration.
- Replace floating-point token math.
- Remove pseudo-admin and manual consensus labels.
- Persist and render real transaction evidence.
- Implement complete loading/error/inconclusive/finality states.
- Remove starter CSS/assets and verify responsive/accessibility behavior.

### Phase 6: reviewer package

- Host the frontend at a stable URL.
- Record a short unedited demo from bounty creation through finalized payout proof.
- Provide two explorer-linked examples: clear approval and clear rejection/inconclusive handling.
- Include a malicious-leader test result showing validators disagree.
- Include architecture, trust assumptions, known limitations, deployment table, exact setup commands, and test command/output in the README.

## Resubmission checklist

Do not resubmit until every blocking item is true.

### Blocking

- [ ] Validator independently verifies the substantive judgment.
- [ ] A test proves a fabricated but well-formed leader approval is rejected.
- [ ] Manual poster decisions cannot masquerade as consensus.
- [ ] Poster cannot cancel after a valid submission under normal conditions.
- [ ] Evidence is immutable/content-addressed or the weaker trust model is explicit.
- [ ] Fetch/model failures are inconclusive and retryable, not permanent rejection.
- [ ] Accepted and finalized states are separately represented.
- [ ] Payout is proven by finalized execution and balance deltas on a persistent network.
- [ ] Current GenLayer lint, direct tests, consensus tests, and integration tests pass in CI.
- [ ] README statements exactly match source behavior.

### Strongly recommended

- [ ] Same source tag is deployed to Asimov/Bradbury and Studionet.
- [ ] Network, chain ID, contract, deployment transaction, and limitations are documented.
- [ ] Raw private keys are never stored in `localStorage`.
- [ ] All `u256` values use `bigint`/decimal-safe helpers.
- [ ] Undefined admin handlers and pseudo-authority are removed.
- [ ] Consensus evidence remains verifiable after reload.
- [ ] Hosted frontend and concise demo video are available.
- [ ] Mobile, accessibility, and end-to-end checks pass.

## Suggested submission positioning

Use a literal, technically accurate pitch:

> ContentBounty is an Intelligent Contract escrow that evaluates content-addressed submissions against a structured natural-language rubric. A leader and validators independently retrieve the same evidence and judge each criterion; semantic agreement determines an approve, reject, or inconclusive result. Approved rewards settle only after GenLayer finality, with transaction and balance proof visible in the app.

The demo should lead with the GenLayer-specific proof, not generic marketplace screens:

1. Show the immutable criteria and evidence hash.
2. Show leader and validators independently evaluating it.
3. Show a malicious-leader/direct test being rejected.
4. Show an accepted result during its appeal window.
5. Show finalization and recipient balance delta.
6. Explain why this cannot be implemented as an ordinary EVM contract without an oracle or trusted adjudicator.

Avoid claims such as "real funds" on Studionet, "validators independently fetch" unless they actually do, or "paid" before finalization.

## Official sources used

The audit compared the project against the official GenLayer repositories and documentation available on 2026-08-06:

- GenLayer documentation: `https://docs.genlayer.com/`
- Full documentation text: `https://docs.genlayer.com/full-documentation.txt`
- Networks: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/networks.mdx`
- When to use GenLayer: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/when-to-use-genlayer.mdx`
- Equivalence principle: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/equivalence-principle.mdx`
- Contract testing: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/testing.mdx`
- Prompt injection: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/security-and-best-practices/prompt-injection.mdx`
- Value transfers: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/features/value-transfers.mdx`
- Transaction statuses: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/understand-genlayer-protocol/core-concepts/transactions/transaction-statuses.mdx`
- Appeal process: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/understand-genlayer-protocol/core-concepts/optimistic-democracy/appeal-process.mdx`
- Advanced Git bounty example: `https://github.com/genlayerlabs/genlayer-docs/blob/main/pages/developers/intelligent-contracts/examples/_advanced/_git-bounties.mdx`
- GenVM: `https://github.com/genlayerlabs/genvm`
- Project boilerplate: `https://github.com/genlayerlabs/genlayer-project-boilerplate`
- GenLayer CLI: `https://github.com/genlayerlabs/genlayer-cli`
- GenLayer Studio: `https://github.com/genlayerlabs/genlayer-studio`
- GenLayer JS: `https://github.com/genlayerlabs/genlayer-js`
- GenLayer Skills: `https://github.com/genlayerlabs/genlayer-skills`
- Whitepaper: `https://www.genlayer.com/whitepaper`

## Verification performed and limitations

### Performed

- Reviewed every committed application, contract, deployment, configuration, and documentation file.
- Compared the committed tree with the local copied workspace.
- Reviewed Git history and current `main` commit.
- Matched the supplied rejection message to the exact `c0a6f67` hardcoded evaluation path and traced its repair in `365fdb5`.
- Compared the contract patterns with current GenVM, boilerplate, CLI, Studio, JS SDK, skills repository, and official docs.
- Reproduced the production build stall in the copied WSL environment.
- Confirmed no test/lint/CI toolchain exists in the repository.

### Limitations

- The advertised Studio RPC/explorer was unreachable during the earlier live-network portion of this review, so the historical deployment and README example transactions could not be independently replayed.
- `npm run build --prefix frontend` transformed 441 modules but did not finish within a 120-second bound; it exited via timeout. This is a build verification failure for submission purposes, though it does not by itself identify a source compile error.
- A direct Vue typecheck also did not finish within a 90-second bound in this copied environment. The undefined template handlers were confirmed by static source search.
- Contract lint and tests could not be run because the repository contains no GenLayer lint/test configuration or dependencies.
- Bradbury was reported unavailable by the project owner. The final resubmission must recheck official network status and deployment requirements at implementation time.

## Bottom line

ContentBounty should remain a GenLayer project. The original rejection was caused by a concrete implementation failure: the submitted `c0a6f67` contract never executed its nondeterministic functions, hardcoded approval and score 100, and had blocking lint errors. The later `365fdb5` change removed the hardcoded result, but it stopped at shape-only validation and the repository still contains no reproducible passing `genvm-lint` result.

The next resubmission therefore needs to satisfy both layers: conclusively clear the reviewer's original lint/execution gate and strengthen the equivalence principle so validators verify the actual decision that moves funds. Doing this correctly leads naturally to immutable evidence, semantic equivalence, adversarial tests, honest UI evidence, finality-aware settlement, and precise documentation.

A strong resubmission is a **protocol rebuild with proof**, not a renamed clone or README refresh.

## Implementation-session handoff prompt

The following can be given to a new Codex or Claude Code session together with this repository:

```text
Read AUDIT_REPORT.md completely, then inspect the repository and current official
GenLayer boilerplate/docs before editing. Rebuild ContentBounty v2 for hackathon
resubmission; do not make documentation-only changes and do not preserve an unsafe
API merely for backward compatibility.

The non-negotiable property is substantive independent validation: validators must
resolve the same immutable evidence and independently judge the rubric. A shape-only
validator is forbidden. Add a direct test proving a fabricated but well-formed leader
approval is rejected.

First write a short implementation plan and explicit lifecycle/equivalence spec. Then:
1. migrate to one pinned current GenLayer boilerplate/toolchain;
2. implement bounded storage, immutable evidence, deadlines, safe cancellation,
   APPROVE/REJECT/INCONCLUSIVE, provenance, events, and double-payout protection;
3. remove unilateral manual decisions from the trustless path;
4. add lint, direct, consensus, adversarial, integration, and balance-delta tests;
5. rebuild the frontend around an external signer, bigint amounts, network config,
   durable evidence, and accepted/finalized/payout-confirmed states;
6. deploy the identical source tag to Asimov (or Bradbury when restored) and Studionet;
7. rewrite the README so every claim is demonstrated by tests or explorer evidence.

Preserve unrelated user changes. Treat the existing v0.2 deployment as historical and
deploy a new v2 contract because the storage/lifecycle redesign is intentionally
incompatible. Work through implementation, verification, local frontend launch, and a
final resubmission checklist. Record any current GenLayer API differences discovered
since this audit instead of guessing old API behavior.
```
