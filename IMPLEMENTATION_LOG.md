# ContentBounty v2 implementation log

## 2026-08-06 — audit intake and toolchain selection

### Decisions and assumptions

- Read `AUDIT_REPORT.md` completely, including the implementation-session
  handoff. The file remains unchanged.
- Treat v0.2 and its Studionet address as historical. v2 intentionally breaks
  storage/API compatibility.
- Do not modify the frontend until contract lint and direct/adversarial tests
  pass.
- Adopt the lifecycle and equivalence design in
  `docs/CONTENT_BOUNTY_V2_SPEC.md`.
- Use first consensus-approved submission wins, permissionless evaluation,
  cancellation only before the first submission, and permissionless expiry
  after an explicit evaluation grace period.
- Require an HTTPS evidence URI plus normalized-rendered-text SHA-256. This
  detects mutation but does not guarantee availability; content-addressed HTTPS
  gateways are preferred.
- Do not add contract events yet: the current official Intelligent Contract
  documentation exposes transaction execution events to clients but does not
  document a stable user-defined event declaration API. Store bounded provenance
  in contract state and use transaction hashes externally.

### Official resources inspected

- `AUDIT_REPORT.md` official-source list.
- Current `genlayerlabs/genlayer-project-boilerplate` main at commit
  `e685f1f12c4c357787d48390692a654baf576f03` (2026-06-10).
- Current official full documentation downloaded from
  `https://docs.genlayer.com/full-documentation.txt` on 2026-08-06.
- Relevant current guidance: custom `run_nondet_unsafe`, substantive independent
  validator verification, Direct Mode `run_validator()`, deterministic
  transaction timestamps, finalized value transfers, bounded persistent storage,
  and prompt-injection hardening.

### GenLayer versions selected

- Python: 3.12.3.
- `genlayer-py`: tag `v0.18`, commit
  `a3dc35e04898e3889cbfa855bcaf7d2664675b8f`.
- `genlayer-test`: tag `v0.29`, commit
  `9c09578b143905471fb0657dd53bdaf18da8e35f`; installed package version
  `0.29.2`.
- `genvm-linter`: main commit
  `fa4a4d4536b28fdc2730e13a983ba01b69ccc6f3`; installed package version
  `0.10.0`.
- Direct Mode/semantic SDK source: official GenVM `v0.2.16`, commit
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`.
- Official boilerplate JavaScript SDK reference: `genlayer-js` `^1.1.8`.
  Frontend migration has not begun.

### Commands and results

```text
wc -l AUDIT_REPORT.md
=> 728 lines

git status --short --branch
=> clean feat/contentbounty-v2 branch before implementation

git clone --depth 1 https://github.com/genlayerlabs/genlayer-project-boilerplate.git ...
=> PASS; inspected commit e685f1f12c4c357787d48390692a654baf576f03

curl -L --max-time 60 -sS https://docs.genlayer.com/full-documentation.txt
=> PASS; 19,846 lines downloaded and relevant APIs reviewed

python3 -m venv .venv
=> PASS

.venv/bin/pip install -r <official-boilerplate>/requirements.txt
=> PASS; installed genlayer-py 0.18.0, genlayer-test 0.29.2,
genvm-linter 0.10.0

.venv/bin/python -m py_compile contracts/content_bounty.py
=> PASS

.venv/bin/genvm-lint lint contracts/content_bounty.py
=> PASS; 3 AST safety checks

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 .venv/bin/genvm-lint check contracts/content_bounty.py --json
=> PASS; lint {"ok":true,"passed":3}, semantic schema validation
{"ok":true,"contract":"ContentBounty","methods":9,"view_methods":4,"write_methods":5,"ctor_params":0}.
The prebuilt source contains the official GenVM v0.2.16 checkout at
387e1a66e920cb2dfadcdce40ab2d28da02efd1e; it avoids downloading the 310 MB
all-runners archive while using the linter's supported prebuilt layout.

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std .venv/bin/pytest tests/direct -v
=> PASS; 16 passed in 1.62s. The source checkout is the same official GenVM
v0.2.16 commit noted above. Without this local-only override, genlayer-test
uses its normal versioned runner cache.

git diff --check
=> PASS
```

### Remaining blockers

- Contract architecture, equivalence spec, lint setup, and adversarial Direct
  Mode tests are complete and green.
- Add a smaller Studio/localnet integration matrix and run it when an endpoint
  is available.
- Studio/localnet integration, persistent testnet deployment, finality proof,
  frontend rebuild, and frontend tests are later stages.

### Deployments

| Network | Contract address | Deployment transaction | Source commit | Status |
|---|---|---|---|---|
| Studionet (historical v0.2) | `0xFf546d6B1CD45d2859a705a7FA181807670B9015` | Not verified in this session | `a09fe6a` lineage | Historical only |
| v2 | Not deployed | Not deployed | `015ba57` | Contract gate passed; deployment pending |

## Contract milestone status

- [x] Lifecycle/equivalence specification written.
- [x] Bounded escrow, evidence digest, deadlines, retries, three-way result,
  first-winner settlement, expiry/refund, and paginated reads implemented.
- [x] Shape-only validator removed; validators independently render, hash,
  extract, judge, and compare payout-controlling fields.
- [x] `genvm-lint lint` and full `genvm-lint check` pass.
- [x] 16 adversarial Direct Mode tests pass.
- [x] Contract milestone committed as `015ba57`.
- [x] Frontend rebuild began only after the contract gate passed.

## 2026-08-07 — final contract gate rerun

```text
npm run lint:contract
=> PASS; 3 checks

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> npm run test:contract -- --quiet
=> PASS; 16 passed in 1.81s

git diff --check
=> PASS

git diff --quiet -- AUDIT_REPORT.md
=> PASS; AUDIT_REPORT.md remains unmodified

git commit -m "feat(contract): rebuild ContentBounty v2 adjudication"
=> PASS; milestone commit 015ba57
```

## 2026-08-07 — v2 frontend and client integration

### Decisions and assumptions

- Replaced the v0.2 Vue application instead of adapting its old storage and
  method assumptions. The v2 frontend calls only `post_bounty`,
  `submit_content`, `evaluate_submission`, `cancel_bounty`, `expire_bounty`,
  `get_bounties_page`, and `get_submissions_page`.
- Use an injected external signer. The application no longer generates,
  imports, displays, or persists raw private keys. Wallet disconnect is local;
  the extension remains responsible for account authorization and custody.
- Centralize Studionet/RPC/explorer/contract configuration in
  `frontend/src/lib/genlayer.ts`. A custom RPC URL can be supplied without
  changing application code.
- Use `genlayer-js` `1.1.8`, matching the current official boilerplate
  reference inspected before implementation. The address-backed SDK client
  routes signing methods to the injected provider, while GenLayer RPC reads use
  the configured network endpoint.
- Parse reward input directly to `bigint` with at most 18 fractional digits.
  Floating-point GEN-to-wei conversion is forbidden.
- Require the user to commit the exact normalized-rendered-text SHA-256 with the
  evidence HTTPS URI. The frontend does not invent a digest or silently fetch a
  CORS-dependent browser rendering that may differ from validator rendering.
- Persist only transaction identifiers, action metadata, timestamps, and
  observed lifecycle state in local storage. This lets evidence survive reload
  without persisting a wallet secret.
- Treat `SUBMITTED`, `ACCEPTED`, and `FINALIZED` as different states. An approved
  accepted evaluation is not described as paid. Even after finalization, the UI
  tells the user to verify recipient balance before claiming payout
  confirmation because contract state proves the transfer was emitted, not the
  external balance delta.
- Remove manual approval/rejection and pseudo-admin flows. Evaluation remains
  permissionless and settlement remains contract-controlled.
- Update the deployment helper to import the root SDK package, read the
  deployer key from `GENLAYER_DEPLOYER_PRIVATE_KEY` rather than command-line
  history, and wait explicitly for `FINALIZED`.
- Rewrite the README files to describe v2. The historical v0.2 Studionet address
  is no longer presented as a current compatible deployment.

### GenLayer and frontend versions used

- `genlayer-js`: `1.1.8` in both root and frontend lockfiles.
- Resolved `viem`: `2.55.11` in the frontend lockfile after compatible advisory
  updates.
- Vue: `3.5.31` resolved.
- TypeScript: `5.9.3` resolved.
- Vite: `8.2.1` resolved.
- Contract toolchain remains `genlayer-py 0.18.0`, `genlayer-test 0.29.2`,
  `genvm-linter 0.10.0`, and official GenVM `v0.2.16` at
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`.

### Commands and results

```text
npm install genlayer-js@^1.1.8 --ignore-scripts  # frontend
=> PASS; installed official genlayer-js 1.1.8 and updated lockfile

npm audit --omit=dev --json  # before compatible updates
=> 5 transitive production advisories: 1 moderate, 4 high, 0 critical
=> affected old viem/ws, brace-expansion, postcss, and js-yaml resolutions

npm audit fix
npm install --ignore-scripts
=> PASS; compatible transitive versions resolved to viem 2.55.11,
ws 8.21.0, brace-expansion 1.1.18, postcss 8.5.26, js-yaml 4.3.1
=> a final npm audit request returned HTTP 400 because npm is retiring the
quick-audit endpoint and rejected the generated tree; `npm ls --all` passes and
the installed versions are beyond every advisory range reported above

npm run build:frontend
=> PASS; vue-tsc project build and Vite 8.2.1 production bundle
=> largest application chunk 465.87 kB, below Vite's 500 kB warning threshold

node --check deploy.mjs
=> PASS

npm run lint:contract
=> PASS; 3 checks

npm run test:contract -- --quiet
=> EXPECTED ENVIRONMENT FAILURE; Direct Mode attempted to download the official
GenVM v0.2.16 runner archive and sandbox DNS was unavailable. No contract test
assertion executed successfully in this unconfigured run.

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std npm run test:contract -- --quiet
=> PASS; 16 passed in 1.40s using the previously verified official GenVM
v0.2.16 source at commit 387e1a66e920cb2dfadcdce40ab2d28da02efd1e

git diff --check
=> PASS

git diff --quiet -- AUDIT_REPORT.md
=> PASS; AUDIT_REPORT.md remains unmodified
```

### Frontend milestone status

- [x] External injected signer; no application-managed private keys.
- [x] Exact decimal-to-wei parsing.
- [x] v2 rubric, deadlines, evidence digest, retry, expiry, and pagination UI.
- [x] Accepted/finalized transaction evidence survives reload.
- [x] Manual settlement and pseudo-admin controls removed.
- [x] Network configuration centralized and SDK upgraded to `1.1.8`.
- [x] TypeScript and production build pass.
- [x] Frontend milestone committed as `47001b6`.
- [ ] Run a live injected-wallet smoke test after a v2 contract is deployed.
- [ ] Prove a finalized payout with a recipient balance delta on the selected
  network.

### Remaining blockers

- No v2 contract address or deployment transaction exists yet. Deployment needs
  an explicitly supplied funded deployer key and a reachable selected network.
- The ignored local `frontend/.env` still contains the historical v0.2 address.
  It was preserved as user-local state; the application now explicitly blocks
  that address, and the file must be updated after v2 deployment.
- A live browser signing/evaluation/finality smoke test depends on that v2
  deployment.
- Studio/localnet integration tests and an automated recipient balance-delta
  assertion remain separate deployment-stage work.

### Deployments

| Network | Contract address | Deployment transaction | Source commit | Status |
|---|---|---|---|---|
| Studionet (historical v0.2) | `0xFf546d6B1CD45d2859a705a7FA181807670B9015` | Not verified in this session | `a09fe6a` lineage | Historical only; incompatible with v2 |
| v2 | Not deployed | Not deployed | `47001b6` | Blocked on deployer credentials/network execution |

## 2026-08-07 — receipt classification hardening

### Decisions and assumptions

- Added a pure frontend receipt classifier in `frontend/src/lib/transactionClassifier.ts`.
  It accepts official enum names, numeric SDK fields, and legacy snake-case RPC
  fields, then persists the observed status, consensus result, execution result,
  and an explicit failure reason.
- A transaction is only `ACCEPTED` when its status is `ACCEPTED`, its consensus
  result is `MAJORITY_AGREE`, and execution is `FINISHED_WITH_RETURN`. A
  transaction is only `FINALIZED` when all three checks hold with
  `FINALIZED` status. Finalized execution errors, disagreement/no-majority,
  undetermined, cancellation, leader timeout, and validator timeout are
  terminal `FAILED` states.
- `READY_TO_FINALIZE` and appeal states remain processing states; they never
  receive accepted or settlement copy. RPC polling errors remain observation
  errors rather than being mislabeled as on-chain execution failures.
- Numeric result normalization follows the installed genlayer-js 1.1.8
  mappings and fails closed for unknown finalized values. The current official
  source also documents newer names (`MAJORITY_TIMEOUT`, `TIMEOUT`, and
  `NONDET_DISAGREE`), which are recognized as failures when returned by name.
- Studionet was reported unavailable by the GenLayer team during this session
  (temporary one-hour maintenance window). No deployment or live RPC smoke test
  was attempted; live evidence remains blocked until service returns.

### GenLayer and frontend versions used

- `genlayer-js` `1.1.8`
- `vitest` `3.2.7` (installed from the `^3.2.4` dev dependency)
- Vue `3.5.31`, TypeScript `5.9.3`, Vite `8.2.1`

### Commands and results

```text
cd frontend && npm install --cache /tmp/contentbounty-npm-cache
=> PASS; added Vitest and updated the lockfile; 0 vulnerabilities reported

cd frontend && npm test
=> PASS; 1 file, 27 tests

cd frontend && npm run build
=> PASS; vue-tsc project build and Vite production bundle

git diff --check
=> PASS
```

### Remaining blockers

- No live receipt or explorer evidence can be collected while Studionet is in
  the announced maintenance window. No v2 deployment has been performed.
- Finalized payout and recipient balance-delta proof remain blocked on a live
  selected network and explicit deployment authorization.

## 2026-08-07 — official network selection

### Decisions and assumptions

- Replaced RPC/label/explorer overrides with one validated selector in each
  runtime: `VITE_GENLAYER_NETWORK` for the browser and `GENLAYER_NETWORK` for
  deployment. Both accept only `studionet`, `testnetAsimov`, or
  `testnetBradbury`, default to `studionet`, and reject differently-cased or
  unsupported values.
- Each selector returns the complete official `genlayer-js/chains` object. No
  chain ID, RPC URL, explorer, or consensus contract is independently mixed
  with another network's configuration.
- Official genlayer-js 1.1.8 values used in this session:
  - `studionet`: chain ID `61999`, RPC `https://studio.genlayer.com/api`,
    consensus `0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575`;
  - `testnetAsimov`: chain ID `4221`, RPC
    `https://rpc-asimov.genlayer.com`, consensus
    `0x6CAFF6769d70824745AD895663409DC70aB5B28E`;
  - `testnetBradbury`: chain ID `4221`, RPC
    `https://rpc-bradbury.genlayer.com`, consensus
    `0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D`.
- Asimov and Bradbury share chain ID `4221`. Wallet switching uses the selected
  official wallet parameters, but an injected wallet cannot prove which RPC it
  associates with a shared chain ID. Documentation requires its chain-4221 RPC
  to match the network selector displayed by the application.
- The deployment helper now logs selector, network name, chain ID, RPC,
  consensus contract, explorer, deployer address, source path, source SHA-256,
  source commit/dirty state, transaction hash, and explorer links. It exits
  nonzero for invalid configuration, SDK errors, non-successful receipt
  classification, or a missing deployment address.
- No deployment was attempted. The announced Studionet maintenance window and
  the prohibition on using credentials without explicit authorization remain
  in force.

### Commands and results

```text
npm run test:network
=> PASS; Node test runner, 3 network-selection assertions

cd frontend && npm test
=> PASS; 2 files, 33 tests (27 receipt-classifier + 6 network-selection)

cd frontend && npm run build
=> PASS; vue-tsc and Vite production build, 460 modules transformed

node --check deploy.mjs
=> PASS

env GENLAYER_NETWORK=localnet node deploy.mjs
=> EXPECTED FAILURE; exit code 1 and explicit supported-value error

env GENLAYER_NETWORK=testnetBradbury GENLAYER_DEPLOYER_PRIVATE_KEY=bad node deploy.mjs
=> EXPECTED FAILURE; exit code 1 and private-key validation error; no network call
```

### Remaining blockers

- Wallets identify networks primarily by chain ID; Asimov versus Bradbury RPC
  selection cannot be independently attested by `eth_chainId` because both use
  `4221`.
- Live deploy/finality and balance-delta evidence are still blocked on explicit
  authorization, a funded key, and a reachable selected network.

## 2026-08-07 — canonical evidence preparation

### Decisions and assumptions

- Removed the caller-supplied digest from `submit_content`. The v2 protocol now
  calls `submit_content(bounty_id, evidence_uri)`; its GenLayer leader and real
  validators independently run `gl.nondet.web.render(..., mode="text")`, apply
  the contract normalization, and must agree on success, SHA-256, character
  count, and failure reason before storage is created.
- The contract-generated submission digest is authoritative. Evaluation
  rerenders and compares against that stored digest, so later content mutation
  remains `INCONCLUSIVE/DIGEST_MISMATCH`. A URI unavailable at submission fails
  without consuming a submission slot; evaluation-time availability remains a
  retryable inconclusive result.
- Defined the preparation profile `content-bounty-text-v1`: strict UTF-8 raw
  text, CRLF/CR converted to LF, outer Unicode whitespace stripped, maximum
  16,000 normalized characters, published at a stable, preferably
  content-addressed HTTPS URI. HTML, browser DOM text, and ordinary HTTP bodies
  are not claimed to be equivalent to GenLayer WebRender.
- Added `scripts/prepare_evidence.py`, which emits the exact canonical text,
  URI, SHA-256, character count, and UTF-8 byte count and can write the canonical
  bytes to publish. This local helper makes preparation reproducible, while the
  on-chain renderer consensus removes the need for users to guess its digest.
- Added a CRLF fixture whose prepared digest is asserted in both utility tests
  and the contract's submission/evaluation path. Direct Mode proves shared
  normalization and control flow with a mocked renderer; it is not presented as
  live WebRender equivalence evidence.
- Updated the frontend to accept only the evidence URI and explain the raw-text
  workflow. The generated on-chain digest remains visible on stored
  submissions.

### GenLayer and contract versions used

- Contract source header: `v2.1.0` (submission ABI changed to contract-generated
  evidence commitments)
- GenVM: official `v0.2.16` at
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`
- `genlayer-test` `0.29.2`, `genvm-linter` `0.10.0`, `genlayer-py` `0.18.0`

### Commands and results

```text
.venv/bin/pytest tests/unit -v  # first run
=> FAIL during collection; GenLayer pytest import handling did not include the
repository root, so `scripts.prepare_evidence` was not importable

pyproject.toml: pythonpath = ["."]
npm run test:evidence
=> PASS; 2 passed in 0.04s

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -v
=> PASS; 18 passed in 2.97s

.venv/bin/genvm-lint lint contracts/content_bounty.py
=> PASS; 3 checks

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 .venv/bin/genvm-lint check contracts/content_bounty.py --json
=> PASS; lint 3/3 and semantic schema validation for ContentBounty (9 methods,
4 view, 5 write, 0 constructor parameters)

.venv/bin/python scripts/prepare_evidence.py --uri https://gateway.example/ipfs/bafy-content-bounty/evidence.txt --file tests/fixtures/canonical_evidence.txt --write-canonical /tmp/contentbounty-canonical-evidence.txt
=> PASS; canonical SHA-256
6c3cb3fd6a3bae4746f817bc82864f65a99ef05181cad4f69fb16a23038f46bd,
44 characters, 44 UTF-8 bytes
```

### Remaining blockers

- Direct Mode substitutes the configured mock body for WebRender output. The
  fixture proves contract/preparer normalization parity but not a real browser
  renderer. Live submission consensus on a deployed contract is still required
  for explorer-linked WebRender evidence.
- No live endpoint or credentials were used during the announced Studionet
  maintenance window.

## 2026-08-07 — structured prompt-injection hardening

### Decisions and assumptions

- Replaced interpolated `<UNTRUSTED_...>` blocks with one compact JSON object on
  a single `UNTRUSTED_INPUT_JSON=` line. Rubric arrays and evidence/observation
  strings are serialized rather than concatenated into prompt structure.
- JSON escaping keeps submitted quotes, backslashes, newlines, fake JSON, and
  fake output instructions inside string values. `<`, `>`, and `&` are emitted
  as `\\u003c`, `\\u003e`, and `\\u0026`, so submitted closing tags do not
  appear as raw delimiters.
- Bumped evaluator provenance to
  `content-bounty-evaluator-v2.1-json-envelope`.
- Replaced the tautological prompt-injection test with tests that use the Direct
  Mode live-handler hook to capture the actual prompts. They parse the envelope
  back to the exact original data and prove attacks do not create prompt lines
  outside it. Coverage includes closing tags, “ignore previous instructions,”
  fake JSON/output-format instructions, system/role impersonation, malicious
  rubric requirements, and injection propagated through extracted observations.
- These tests prove structural encoding only. Mocked handler responses do not
  prove behavioral resistance by a real model; no such claim is made.

### GenLayer and evaluator versions used

- Contract source header `v2.1.0`
- Evaluator `content-bounty-evaluator-v2.1-json-envelope`
- Official GenVM `v0.2.16` at
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`
- `genlayer-test` `0.29.2`, `genvm-linter` `0.10.0`

### Commands and results

```text
GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -v
=> first run: 21 passed, 1 failed because the provenance assertion still
expected the prior evaluator version; prompt-envelope tests themselves passed

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -q
=> PASS; 22 passed in 2.15s

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 .venv/bin/genvm-lint check contracts/content_bounty.py --json
=> PASS; lint 3/3 and semantic schema validation (9 methods, 4 view, 5 write)
```

### Remaining blockers

- A real-model adversarial run requires a reachable GenLayer network, a deployed
  v2.1 contract, transaction funding, and the network's configured validator
  models. It was not run during the announced Studionet outage and cannot be
  marked complete without transaction/explorer evidence.

## 2026-08-07 — creator-indexed activity

### Decisions and assumptions

- Added one append-only creator index entry per stored submission plus a creator
  count. This is linear with the already-bounded submission record growth and
  does not duplicate evidence or rubric payloads.
- Added `get_creator_submissions_page(creator, offset, limit)` with the same
  maximum page size of 50 as the existing market views. Unknown creators and
  offsets beyond the creator count return an empty page.
- Replaced the frontend's `Promise.all` whole-market scan with sequential pages
  from the creator-indexed view. The local address filter remains a defensive UI
  check, not the data-discovery mechanism.
- The initial Direct test passed fixture byte addresses directly to the Python
  method, which bypassed ABI address conversion and did not match stored address
  strings. The test was corrected to use the contract-returned creator address,
  matching the public ABI/SDK call path.

### Commands and results

```text
GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -q
=> first full run: 22 passed, 1 failed because the Direct-only raw-byte address
bypassed ABI conversion in the new view test

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct/test_content_bounty.py::test_creator_activity_is_indexed_and_paginated -v
=> PASS; 1 passed in 0.39s

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -q
=> PASS; 23 passed in 10.14s

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 .venv/bin/genvm-lint check contracts/content_bounty.py --json
=> PASS; lint 3/3 and semantic schema validation (10 methods, 5 view, 5 write)

cd frontend && npm test
=> PASS; 2 files, 33 tests

cd frontend && npm run build
=> PASS; vue-tsc and Vite production build, 460 modules transformed
```

### Remaining blockers

- The creator view has Direct Mode and semantic-schema coverage but no live RPC
  pagination evidence until v2.1 is deployed.

## 2026-08-07 — CI and live-consensus proof structure

### Decisions and assumptions

- Added `scripts/check_contract.sh` and `npm run check:contract`. Clean runs pin
  `GENVM_VERSION=v0.2.16`, select the official release bundle, and execute full
  `genvm-lint check --json`; local constrained runs may explicitly override the
  source mode with a verified prebuilt tree.
- Added GitHub Actions CI on Node 22/Python 3.12. It installs the commit-pinned
  Python requirements and both npm lockfiles, checks out only the official
  GenVM Python runner at commit
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`, then runs semantic lint, Direct
  Mode, evidence preparation, network selection, frontend unit tests,
  typecheck/build, and clean-diff checks.
- Added an opt-in live runner that deploys the current source with the complete
  selected official chain object. Every transaction must produce a successful
  `ACCEPTED/MAJORITY_AGREE/FINISHED_WITH_RETURN` observation and then a separate
  successful `FINALIZED` observation.
- The live runner structures proof for clear rejection (including a real-model
  adversarial evidence fixture), mutation/fetch inconclusive behavior, clear
  approval, finalized recipient balance delta, deployment/source metadata, and
  explorer links. It writes no private keys and creates its proof file with mode
  `0600`.
- Public SDK/testnet APIs expose no authorized leader-result fabrication hook.
  The live proof records fabricated-leader disagreement as unsupported instead
  of claiming it was tested. An authorized validator harness remains necessary.
- CI deliberately excludes live tests because they spend funds, mutate external
  evidence, and create persistent network state.

### Commands and results

```text
node --check tests/integration/live_consensus.mjs
=> PASS

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 npm run check:contract
=> PASS; full lint 3/3 and semantic schema validation (10 methods, 5 view, 5 write)

npm run test:live
=> EXPECTED EXTERNAL-BLOCKER FAILURE; exit code 1 listing the six required live
credentials/evidence variables; no RPC call, deployment, or credential access
occurred
```

### Remaining external blockers

- Studionet was in the GenLayer team's announced maintenance window during this
  work. No availability probe was made to avoid conflating maintenance with an
  implementation failure.
- No deployment authorization, funded deployer/creator keys, stable approval /
  adversarial rejection fixtures, or mutable-evidence webhook were supplied.
- Consequently there is no v2.1 contract address, transaction hash, explorer
  link, accepted/finalized live receipt pair, real-model adversarial result, or
  recipient balance-delta proof.
- Fabricated leader disagreement additionally requires a GenLayer-provided or
  authorized validator harness not exposed by the current public SDK/testnets.

### Deployments

| Network | Contract address | Deployment transaction | Source commit | Status |
|---|---|---|---|---|
| v2.1 | Not deployed | Not deployed | Not deployed | Blocked on authorization, credentials, fixtures, and reachable network |

## 2026-08-07 — final offline verification gate

```text
GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 npm run check:contract
=> PASS; full semantic lint and schema validation, 10 methods (5 view / 5 write)

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> npm run test:contract -- --quiet
=> PASS; 23 passed in 1.81s

npm run test:evidence -- --quiet
=> PASS; 2 passed in 0.04s

npm run test:network
=> PASS; Node test runner, 3 internal assertions

cd frontend && npm test
=> PASS; 2 files, 33 tests in 2.81s

cd frontend && npm run build
=> PASS; vue-tsc and Vite 8.2.1 production build; 460 modules; largest chunk
470.90 kB (100.72 kB gzip)

node --check deploy.mjs
node --check tests/integration/live_consensus.mjs
=> PASS

./node_modules/.bin/js-yaml .github/workflows/ci.yml
=> PASS; workflow parsed successfully

git diff --check
git diff --quiet -- AUDIT_REPORT.md
=> PASS; no whitespace errors and AUDIT_REPORT.md remains unmodified
```

The offline implementation is ready for another independent code review. It is
not resubmission-ready: the live deployment, real-model/adversarial consensus,
accepted-versus-finalized explorer proof, and finalized recipient balance delta
remain externally blocked and unproven.

## 2026-08-07 — post-maintenance live preflight

### Decisions and assumptions

- Resumed live-proof preflight after the user reported that GenLayer service was
  available again. Only read-only endpoint checks were made; no deployment,
  transaction, balance mutation, or credential output occurred.
- Checked required variable presence without printing values. There is no root
  `.env`, and none of the six required `LIVE_*` inputs are exported in this
  process. `frontend/.env` contains only the public `VITE_CONTRACT_ADDRESS`
  setting and is not a source of deployer credentials.
- A GET response of HTTP 405 was treated only as host reachability. A read-only
  `eth_chainId` JSON-RPC call was then used to verify that Studionet and Bradbury
  were serving RPC requests. Asimov still failed DNS resolution from this
  environment.

### Commands and results

```text
curl --max-time 10 -sS -o /dev/null -w 'studionet_http=%{http_code}' https://studio.genlayer.com/api
=> PASS; HTTP 405 (reachable endpoint, method not allowed)

curl --max-time 10 -sS -o /dev/null -w 'bradbury_http=%{http_code}' https://rpc-bradbury.genlayer.com
=> PASS; HTTP 405 (reachable endpoint, method not allowed)

curl --max-time 10 -sS -o /dev/null -w 'asimov_http=%{http_code}' https://rpc-asimov.genlayer.com
=> EXTERNAL ENVIRONMENT FAILURE; DNS could not resolve rpc-asimov.genlayer.com

curl --max-time 10 -sS -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://studio.genlayer.com/api
=> PASS at 2026-08-07T12:31:35+01:00; result 0xf22f (61999)

curl --max-time 10 -sS -X POST -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  https://rpc-bradbury.genlayer.com
=> PASS at 2026-08-07T12:31:35+01:00; result 0x107d (4221)
```

### Remaining external blockers

- The runner still lacks `LIVE_DEPLOYER_PRIVATE_KEY`,
  `LIVE_CREATOR_PRIVATE_KEY`, `LIVE_APPROVE_EVIDENCE_URI`,
  `LIVE_REJECT_EVIDENCE_URI`, `LIVE_MUTABLE_EVIDENCE_URI`, and
  `LIVE_MUTATION_WEBHOOK_URL`. The optional network/reward/output variables are
  also unset, so the runner would default to Studionet if required inputs were
  later supplied.
- Network availability is no longer the Studionet blocker, but live deployment
  and consensus proof cannot start without the funded distinct accounts and
  evidence services. The project remains not resubmission-ready.

### Deployments

No deployment was made during this preflight. There are no new addresses or
transaction hashes.

## 2026-08-07 — injected-wallet network identity hardening

### Decisions and assumptions

- Inspected the official `genlayer-js` `1.1.8` chain objects and shipped
  consensus ABIs before editing. Studionet exposes `getContracts()` at its
  consensus main contract; Asimov and Bradbury expose `VERSION()` and
  `getAddressManager()`.
- A read-only Bradbury RPC probe proved that checking only selected-address code
  and `VERSION()` is insufficient: Bradbury still has nonempty code at the
  official Asimov consensus address, and that historical contract also returns
  `VERSION() == 2.0.0`.
- Every frontend write now uses a fail-closed injected-provider guard. It checks
  `eth_chainId`, calls `eth_getCode` for the selected official consensus
  address, and executes the official ABI's `getContracts()` or `VERSION()`
  probe through the wallet provider.
- For shared chain ID `4221`, the guard additionally compares the exact current
  head height and block hash from the injected provider with the selected
  official RPC. This detects Asimov/Bradbury history mismatch even when old
  contracts remain deployed at both known addresses. Payable and nonpayable
  writes share the same guard and cannot reach `writeContract` when identity is
  ambiguous.
- Wallet switching remains chain-ID based. Because the two public testnets
  share `4221`, mismatch errors explicitly require the user to change the
  wallet's chain-4221 RPC to the selected official endpoint; there is no network
  fallback.
- Read-only official probes found Asimov and Bradbury currently serving the
  same chain-4221 height and block hash. Identical head state is therefore
  treated as equivalent EVM execution state after the selected consensus
  contract code/ABI checks; any future divergence or provider lag fails closed.
- Residual assumption: the selected official RPC is the reference for current
  chain history and must support browser JSON-RPC/CORS plus
  `eth_getBlockByNumber`. Unavailability fails closed. A sufficiently deep RPC
  compromise could defeat this comparison; the frontend does not claim a
  cryptographic light-client proof.

### Commands and results

```text
node SDK ABI/chain inspection
=> genlayer-js lockfile version 1.1.8; Studionet consensus
0xb7278A61aa25c888815aFC32Ad3cC52fF24fE575 with getContracts(); Asimov
0x6CAFF6769d70824745AD895663409DC70aB5B28E and Bradbury
0x0112Bf6e83497965A5fdD6Dad1E447a6E004271D with VERSION()/getAddressManager()

curl eth_getCode/eth_call against the official Bradbury RPC
=> selected Bradbury consensus has 1,159 bytes of runtime code and VERSION
2.0.0; the Asimov consensus address on Bradbury also has nonempty code and
returns VERSION 2.0.0, confirming that code presence alone is ambiguous

curl eth_getBlockByNumber(latest) against Asimov and Bradbury
=> both returned block 0x1018acf with hash
0x9d8817eb4ea50e7e618f6210d737599dd33da1031cc565cf443f848b04498e05;
the endpoints currently expose identical EVM head state

cd frontend && npm test -- --run src/lib/walletNetwork.test.ts
=> PASS after the exact-head stale-provider case was added; 1 file, 11 tests

cd frontend && npm run build
=> PASS after one TypeScript narrowing correction; vue-tsc and Vite production
build, 461 modules transformed
```

### Remaining blockers

- A browser/injected-wallet smoke test on each selected network still requires
  a deployed v2.1.1 address and explicit authorization to sign. No wallet or
  credentials were used here.

## 2026-08-07 — authoritative submission evidence bounds

### Decisions and assumptions

- Bumped the contract source header to `v2.1.1` without changing the public ABI.
- Submission preparation now emits explicit failed commitments for
  `EMPTY_EVIDENCE` and `EVIDENCE_TOO_LARGE`. A successful commitment is valid
  only for 1-16,000 normalized characters.
- Validators independently render and must match the leader's success flag,
  digest, character count, and failure reason. Failed commitments are accepted
  as substantively equivalent consensus results but then revert the submission
  transaction before any count, creator/evidence index, allowance, or bounty
  status mutation.
- Evaluation retains retryable empty/oversized results for evidence that was
  valid at submission but later mutated.

### Commands and results

```text
GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest \
  tests/direct/test_content_bounty.py -q -k \
  'empty_rendered or 16000 or 16001 or retry_without or matching_invalid or submission_requires or mutation_to_oversized'
=> PASS; 8 passed, 21 deselected

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> .venv/bin/pytest tests/direct -q
=> PASS; 29 passed in 3.38s

GENVM_SOURCE_MODE=prebuilt \
GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 \
npm run check:contract
=> PASS; full lint 3/3 and semantic schema validation, 10 methods (5 view / 5 write)

npm run test:evidence -- --quiet
=> PASS; 2 passed in 0.03s
```

### Remaining blockers

- Live submission consensus on the exact WebRender output remains part of the
  external proof gate. Direct Mode proves state ordering and leader/validator
  equivalence with controlled renderer results.

## 2026-08-07 — persistent proof modes and lifecycle observation

### Decisions and assumptions

- `LIVE_GENLAYER_NETWORK` and `LIVE_PROOF_MODE` are both explicit requirements.
  `persistent` accepts only `testnetBradbury` or `testnetAsimov`.
  `studionet-smoke` accepts only Studionet and records simulated value semantics
  with `persistentPayoutProofValid: false`.
- Extracted live receipt classification and lifecycle observation into a pure
  Node module. It normalizes numeric, camelCase, and snake_case fields, records
  timestamped observations, accepts immediate successful finalization, and
  distinguishes finalization success from a separately observed accepted phase.
- Every successful lifecycle still requires `MAJORITY_AGREE` and
  `FINISHED_WITH_RETURN`. Undetermined, canceled, leader/validator timeout,
  disagreement/no-majority, and execution-error results fail closed.

### Commands and results

```text
node --check scripts/live-proof-mode.mjs
node --check scripts/live-lifecycle.mjs
node --check tests/integration/live_consensus.mjs
=> PASS

npm run test:network
=> PASS; network-selection and proof-mode test files

npm run test:lifecycle
=> PASS; lifecycle test file covering field normalization, immediate
finalization, distinct acceptance/finalization, intermediate states, and
terminal consensus/execution failures

cd frontend && npm test
=> PASS before the final exact-head case; 3 files, 43 tests
```

### Remaining external blockers

- No live consensus proof was run. Persistent proof still requires funded
  distinct deployer and creator accounts, stable approval evidence,
  adversarial rejection evidence, a mutable evidence endpoint and mutation
  webhook, explicit authorization to deploy/spend, and an explicit persistent
  network selection.
- Fabricated leader disagreement still requires an authorized validator
  harness not exposed by the public SDK/testnets.

### Deployments

No deployment was made. There are no new addresses or transaction hashes.

## 2026-08-07 — independent-review remediation final verification

### Commits

- `4f97a1a` — `fix(frontend): verify injected wallet network identity`
- `8638dac` — `fix(contract): reject invalid evidence before locking`
- `462f9d5` — `fix(safety): harden live proof and wallet failure gates`

### Commands and exact results

```text
GENVM_SOURCE_MODE=prebuilt \
GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 \
npm run check:contract
=> PASS; full lint 3/3 and semantic schema validation for ContentBounty,
10 methods (5 view / 5 write), 0 constructor parameters

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> \
npm run test:contract -- --quiet
=> PASS; 29 passed in 6.03s

npm run test:evidence -- --quiet
=> PASS; 2 passed in 0.03s

npm run test:network
=> PASS; 2 Node test-file subtests (network selection plus live proof-mode
validation), 0 failures

npm run test:lifecycle
=> PASS; 1 Node test-file subtest containing the synthetic lifecycle matrix,
0 failures

cd frontend && npm test
=> PASS; final rerun after wallet RPC-error copy change, 3 files, 44 tests in
3.26s

cd frontend && npm run build
=> PASS; vue-tsc and Vite 8.2.1 production build, 461 modules transformed,
largest chunk 475.86 kB (102.15 kB gzip)

node --check deploy.mjs
node --check scripts/genlayer-network.mjs
node --check scripts/live-proof-mode.mjs
node --check scripts/live-lifecycle.mjs
node --check tests/integration/live_consensus.mjs
=> PASS

./node_modules/.bin/js-yaml .github/workflows/ci.yml
=> PASS; workflow parsed and contains semantic lint, Direct Mode, evidence,
network/proof-mode, lifecycle, frontend tests/build, and diff checks

npm run test:live
=> EXPECTED EXTERNAL-BLOCKER FAILURE; exit code 1 before any RPC call, listing
LIVE_GENLAYER_NETWORK, LIVE_PROOF_MODE, both funded account keys, all three
evidence URIs, and the mutation webhook as required
```

### Remaining external proof gate

- funded, distinct deployer and creator accounts;
- stable approval evidence containing the required clear-pass facts;
- adversarial rejection evidence for a real configured validator model;
- a mutable evidence endpoint and HTTPS mutation webhook;
- explicit authorization to deploy and spend;
- `LIVE_GENLAYER_NETWORK=testnetBradbury` or `testnetAsimov` together with
  `LIVE_PROOF_MODE=persistent`.

There is still no explorer-linked v2.1.1 deployment, live accepted/finalized
observation, real-model adversarial outcome, or finalized persistent recipient
balance delta. The branch is ready for another independent offline review but
is not resubmission-ready.

### Deployments

No deployment was made. There are no new network addresses or transaction
hashes.

## 2026-08-07 — Bradbury-only network and incremental proof remediation

### Decisions and assumptions

- `testnetBradbury` is the only active persistent production/hackathon target.
  `studionet` remains available only as an explicitly labelled
  `studionet-smoke` demo. `testnetAsimov` is no longer an active selector in
  the frontend, deployment helper, live-proof mode, environment example, or
  current documentation. Historical Asimov observations above are retained as
  audit history only.
- Bradbury and another network share chain ID `4221`, while an injected wallet
  does not expose its RPC URL. Wallet preflight therefore does not claim a
  cryptographic RPC-URL identity proof. It treats identical execution state as
  equivalent only after comparing wallet and official Bradbury RPC block hashes
  at a stable common block, selected as `min(walletHeight, referenceHeight) -
  2`, with a maximum sampled-head lag of 3 blocks.
- At that stable block, every Bradbury write also requires exact normalized
  consensus bytecode equality and exact normalized official ABI-probe output
  equality (`VERSION()`). Missing code, malformed responses, probe/decode
  errors, divergent history, excessive lag, and reference-RPC failures block
  both payable and nonpayable writes before `writeContract`.
- The live runner creates a mode-0600 proof artifact before deployment and
  atomically checkpoints deployment metadata, every lifecycle observation,
  each completed scenario, and terminal failures. Failure messages redact
  32-byte private-key-looking values; private keys are never stored.
- `proofComplete` is true only for persistent Bradbury mode after successful
  deployment finalization, clear rejection, mutation/fetch inconclusive
  behavior, clear approval finalization, and an exact recipient balance delta
  equal to the reward. Studionet smoke always records
  `persistent=false`, `balancesSimulated=true`,
  `persistentPayoutProofValid=false`, and `proofComplete=false`.

### GenLayer and JavaScript versions used

- `genlayer-js` 1.1.8; frontend lockfile resolves Vue 3.5.31, TypeScript
  5.9.3, Vite 8.2.1, Vitest 3.2.7, and viem 2.55.11.
- Contract toolchain remains `genlayer-py` 0.18.0, `genlayer-test` 0.29.2,
  `genvm-linter` 0.10.0, and official GenVM v0.2.16 at commit
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`.

### Commands and exact results

```text
npm ci                         # root, escalated only for registry access
=> PASS; 217 packages added in approximately 3 minutes

cd frontend && npm ci          # sequential rerun after an overlapping local
                               # install had left node_modules incomplete
=> PASS; 306 packages added in approximately 5 minutes

npm ci --prefix frontend       # exact requested command, rerun after repair
=> PASS; 307 packages added and 0 vulnerabilities reported in approximately
7 minutes

GENVM_SOURCE_MODE=prebuilt \
GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 \
npm run check:contract
=> PASS; full lint 3/3 and semantic schema validation, 10 methods (5 view / 5
write), 0 constructor parameters

npm run check:contract
=> EXPECTED SANDBOX NETWORK BLOCKER; release-mode semantic validation could
not download the SDK because registry/DNS was unavailable. The pinned local
official GenVM prebuilt command above passed.

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std \
npm run test:contract -- --quiet
=> PASS; 29 Direct Mode tests

npm run test:evidence
=> PASS; 2 evidence-preparation tests

npm run test:network
=> PASS; network selector, deployment-mode, and live proof-mode tests

npm run test:lifecycle
=> PASS; synthetic lifecycle tests plus incremental proof-store tests

cd frontend && npm test -- --run
=> PASS; 4 files, 64 tests (transaction classifier, wallet/network guard,
network selector, App write-guard static checks)

npm run build:frontend
=> PASS; vue-tsc and Vite production build, 461 modules transformed

node --check deploy.mjs
node --check tests/integration/live_consensus.mjs
node --check scripts/live-proof-store.mjs
node_modules/.bin/js-yaml .github/workflows/ci.yml
=> PASS; JavaScript syntax and CI YAML parse

git diff --check
=> PASS
```

### Remaining blockers and deployments

- Live consensus proof remains externally blocked by funded, distinct deployer
  and creator accounts; stable approval evidence; adversarial rejection
  evidence from a real configured model; a mutable evidence endpoint and
  mutation webhook; explicit authorization to deploy/spend; and a selected
  persistent Bradbury network.
- No deployment, transaction hash, explorer-linked finality, or balance-delta
  evidence exists. No private key or credential was used.

| Network | Contract address | Deployment transaction | Status |
|---|---|---|---|
| testnetBradbury | Not deployed | Not deployed | Persistent proof blocked |
| Studionet smoke | Not deployed in this session | Not deployed | Demo mode only |

## 2026-08-08 — latest-common wallet identity and adversarial proof binding

### Decisions and assumptions

- Bradbury remains the only persistent network, and the frontend default is now
  `testnetBradbury`. Studionet is available only when explicitly selected for
  smoke/demo. The ignored local `frontend/.env` now contains an empty contract
  address and Bradbury selector; no historical v0.2 address is consumed by a
  local or production build.
- Shared-chain preflight now computes
  `latestCommonHeight=min(walletHeight, officialHeight)` and compares both
  providers' block hashes at that exact height. Consensus bytecode and the
  Bradbury `VERSION()` probe are read at that latest-common block. The older
  `latestCommonHeight - 2` block remains an additional continuity check; it is
  never the sole identity comparison. A maximum sampled-head lag of 3 blocks
  remains permitted. Equivalent execution state is the honest conclusion; the
  wallet RPC URL itself remains unavailable to the browser.
- Added a committed canonical rejection fixture and manifest at
  `tests/fixtures/live/adversarial_rejection_v1.{txt,json}`. Its normalized
  SHA-256 is
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537` and it
  contains 1,092 characters. The live runner reads the on-chain submission
  digest, compares it to this manifest before accepting the rejection scenario,
  records expected/observed hashes and fixture version, and requires
  `adversarialRejectionVerified` for `proofComplete`.
- Vite now rejects the historical v0.2 address at build configuration time and
  `scripts/verify_frontend_bundle.mjs` scans generated assets for it. The UI
  remains not configured until a finalized v2.1.1 Bradbury address is supplied.

### Commands and exact results

```text
npm ci
=> PASS; 217 packages installed; npm audit reported 4 existing findings
(1 moderate, 3 high)

npm ci --prefix frontend
=> PASS; 307 packages installed; 0 vulnerabilities reported

GENVM_SOURCE_MODE=prebuilt \
GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 \
npm run check:contract
=> PASS; full semantic lint 3/3; ContentBounty schema validated with 10
methods (5 view / 5 write) and 0 constructor parameters

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std \
npm run test:contract -- --quiet
=> INITIAL RUN: 28 passed, 1 failed because the expiry test used a fixed
2026-08-08 timestamp that was no longer guaranteed to follow its dynamically
created deadline
=> FIX: derive the warp timestamp from evaluation_deadline + 1 second
=> FINAL PASS; 29 passed in 12.89s

VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS= \
npm run build:frontend
=> PASS; vue-tsc and Vite production build, 461 modules transformed; Vite
final verification build completed in 1.50s

VITE_GENLAYER_NETWORK=testnetBradbury \
VITE_CONTRACT_ADDRESS=0xFf546d6B1CD45d2859a705a7FA181807670B9015 \
npm run build:frontend
=> EXPECTED REJECTION; exited 1 before bundling with the incompatible-v0.2
address error

npm run verify:frontend-bundle
=> PASS; 8 generated files scanned; historical address absent

npm --prefix frontend test -- --run
=> PASS; final rerun 4 files, 67 tests in 8.02s

npm run test:network
=> PASS; 3 Node test-file subtests, 0 failed, in 8.35s

npm run test:lifecycle
=> PASS; 3 Node test-file subtests, 0 failed, in 4.43s

npm run test:evidence -- --quiet
=> PASS; 3 evidence/preparation tests in 0.26s

node --check deploy.mjs
node --check scripts/genlayer-network.mjs
node --check scripts/live-proof-mode.mjs
node --check scripts/live-lifecycle.mjs
node --check scripts/live-proof-store.mjs
node --check scripts/live-adversarial-fixture.mjs
node --check scripts/verify_frontend_bundle.mjs
node --check tests/integration/live_consensus.mjs
=> PASS; all eight JavaScript syntax checks exited 0

./node_modules/.bin/js-yaml .github/workflows/ci.yml
=> PASS; CI YAML parsed successfully

env -u LIVE_GENLAYER_NETWORK -u LIVE_PROOF_MODE \
-u LIVE_DEPLOYER_PRIVATE_KEY -u LIVE_CREATOR_PRIVATE_KEY \
-u LIVE_APPROVE_EVIDENCE_URI -u LIVE_REJECT_EVIDENCE_URI \
-u LIVE_MUTABLE_EVIDENCE_URI -u LIVE_MUTATION_WEBHOOK_URL \
npm run test:live
=> EXPECTED PASS OF THE NEGATIVE GATE; exited 1 before RPC/deployment and
listed all eight required LIVE_* inputs

git diff --check
=> PASS

git diff --quiet -- AUDIT_REPORT.md
=> PASS; AUDIT_REPORT.md unchanged

git status --short
=> PASS; only the documented remediation files were modified/untracked before
the local milestone commit; ignored frontend/.env contains Bradbury plus an
empty contract address
```

### Remaining external blockers

- No deployment, signing, fund spending, or live proof was performed.
- Authorized persistent Bradbury proof still requires funded distinct accounts,
  approval evidence, hosting the exact committed adversarial fixture at
  `LIVE_REJECT_EVIDENCE_URI`, the mutation endpoint/webhook, explorer-linked
  finality, and an exact finalized recipient balance delta.

## 2026-08-08 — official GenVM release source and production audit closure

### Decisions and assumptions

- Semantic lint remains pinned to `GENVM_VERSION=v0.2.16` in release mode.
  `scripts/check_contract.sh` now defaults `GENVM_REPO` to the official
  `genlayerlabs/genvm` repository, which publishes the v0.2.16
  `genvm-universal.tar.xz` runner bundle. CI explicitly supplies the same
  repository. Validation was not redirected to `genvm-manager` or weakened.
- Root-only exact npm overrides constrain the five audited transitive packages
  to `brace-expansion` 1.1.18, `js-yaml` 4.3.1, `viem` 2.55.11, `ws` 8.21.0,
  and `ox` 0.14.33. The root lockfile changed only those resolutions; the
  frontend manifest and lockfile are unchanged.
- The official 216,630,904-byte universal runner bundle was downloaded from
  the v0.2.16 GitHub release. Its observed SHA-256,
  `4f0b358ec98ec148be9b95cdfb0f0e1a6cbe64da0194fdfac3fffc6f5d1d93e2`,
  matches the digest published in the official release metadata.

### Commands and exact results

```text
npm ci
=> PASS; 217 packages installed

npm ci --prefix frontend
=> FIRST SANDBOX RUN: esbuild installer was blocked with EPERM
=> AUTHORIZED EXACT RERUN PASS; 307 packages installed, 308 audited, 0
vulnerabilities

npm audit --omit=dev
=> PASS; found 0 vulnerabilities

npm audit --omit=dev --prefix frontend
=> PASS; found 0 vulnerabilities

npm run check:contract
=> PASS through the normal release-mode script path;
{"ok":true,"lint":{"ok":true,"passed":3},"validate":{"ok":true,
"contract":"ContentBounty","methods":10,"view_methods":5,
"write_methods":5,"ctor_params":0}}

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std \
npm run test:contract -- --quiet
=> PASS; 29 passed in 3.51s

npm run test:evidence
=> PASS; 3 passed in 0.05s

npm run test:network
=> PASS; 3 Node test-file subtests, 0 failed, in 4.65s

npm run test:lifecycle
=> PASS; 3 Node test-file subtests, 0 failed, in 1.87s

npm --prefix frontend test
=> PASS; 4 files, 67 tests in 4.95s

VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS= \
npm run build:frontend
=> PASS; vue-tsc plus Vite, 461 modules transformed, built in 2.19s

npm run verify:frontend-bundle
=> PASS; 8 files scanned, historical address absent

bash -n scripts/check_contract.sh
./node_modules/.bin/js-yaml .github/workflows/ci.yml
git diff --check
=> PASS
```

### Deployment status and blockers

- No deployment, signing, key access, fund spending, or push occurred.
- No network address, transaction hash, explorer finality, or balance-delta
  proof exists; the previously recorded Bradbury live-proof blockers remain.

## 2026-08-08 — durable live-evidence hosting handoff

### Preflight and security status

- Bradbury persistent mode was confirmed before any transaction. The funded,
  distinct public accounts were `0x3211d1419709682b81c53CC51cb63622E25488d3`
  (deployer, 3.076255469721474380 GEN observed) and
  `0x7fD87C28F4345ee8A4124511e16084464ca2E123` (creator,
  1.999977837255340040 GEN observed).
- Root `.env` CRLF line endings were normalized locally so the required
  `set -a; source .env; set +a` sequence works. The ignored file remains mode
  600 and was not committed.
- A provider-discovery diagnostic inadvertently emitted the deployer private
  key assignment into session tool output. The value is not reproduced in this
  log and was never used to sign. Treat that key as compromised: rotate it and
  update the ignored `.env` before any deployment or spending.
- No hosting-provider credential or configured target was available. All four
  live evidence/webhook inputs remain unset, so `npm run test:live` was not run
  and no proof artifact exists.

### Hosting preparation

- Added `hosting/live-evidence`, a Cloudflare Worker scaffold using exact static
  raw-text assets and a SQLite-backed Durable Object. `/approve.txt` and
  `/reject.txt` serve committed fixture bytes, `/mutable.txt` selects initial or
  changed bytes from durable state, and authenticated `POST /mutate` persists
  the state transition after validating the runner's exact `uri` body.
- The rejection route is tested byte-for-byte against
  `adversarial_rejection_v1.txt`; normalized SHA-256 remains
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537`
  with 1,092 characters. The approval fixture contains both required rubric
  facts.
- Deployment instructions intentionally contain no account identifier, token,
  or invented URL. Wrangler 4.120.0 must be authenticated externally, the
  `MUTATION_TOKEN` must be entered as a provider secret, and the four `.env`
  routes must use the actual HTTPS origin returned by deployment.

### Commands and exact results

```text
npm run test:hosting
=> PASS; final rerun 1 Node test-file subtest, 0 failed, in 0.70s

npm run test:evidence -- --quiet
=> PASS; 3 passed in 0.10s

npm run test:lifecycle
=> PASS; 3 Node test-file subtests, 0 failed, in 1.04s

cd hosting/live-evidence
npx --yes wrangler@4 deploy --dry-run --config wrangler.jsonc
=> PASS with Wrangler 4.120.0; 5 static files read; Worker bundle 5.19 KiB
(1.77 KiB gzip); Durable Object and Assets bindings validated; no deployment

node --check hosting/live-evidence/worker.mjs
./node_modules/.bin/js-yaml .github/workflows/ci.yml
git diff --check
=> PASS

git status --short --branch
=> clean at preflight start; no .env tracking
```

### Remaining external actions

- Rotate the exposed deployer key and fund its replacement public address if
  necessary. Re-run the public-address and balance-only preflight.
- Authenticate Wrangler 4.120.0 to the intended Cloudflare account, set the
  mutation token with `wrangler secret put`, deploy the prepared worker, and
  verify the actual HTTPS routes as documented in
  `hosting/live-evidence/README.md`.
- Only after those gates pass may the authoritative live runner deploy the
  contract. No Bradbury contract address, transaction hash, proof artifact, or
  frontend deployment exists yet.

## 2026-08-08 — Bradbury live-proof attempt stopped after deployment submission

### Secret-safe preflight and authorization

- The configured live mode was `testnetBradbury` with `persistent` proof mode.
  The ignored root `.env` remained mode 600. The configured accounts derived to
  distinct public addresses: deployer
  `0x3d5915888E60CdaFFbB1F94DeeB71694F5de2a5d` and creator
  `0x7fD87C28F4345ee8A4124511e16084464ca2E123`.
- The last successful read-only balance check before the run observed
  9.542458082508298980 GEN for the deployer and 1.999977837255340040 GEN
  for the creator.
- The Cloudflare evidence origin reported `mutableState=initial`; the approval
  route contained both live-rubric facts; and the raw rejection route normalized
  to SHA-256
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537`
  with 1,092 characters.

### Authoritative run and preserved failure evidence

```text
set -a
source .env
set +a
npm run test:live
=> FAIL (exit 1) during the first deployment lifecycle read. The SDK submitted
   deployment transaction
   0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93,
   then Bradbury RPC getTransactionAllData failed with `fetch failed` before a
   lifecycle observation or contract address was recorded.
```

- Explorer link:
  https://explorer-bradbury.genlayer.com/tx/0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93
- The mode-0600 proof artifact is preserved at
  `/tmp/contentbounty-live-consensus-proof.json`. It records `status=FAILED`,
  `proofComplete=false`, an empty contract address, and every completion check
  false. No evidence mutation, bounty scenario, evaluation, or payout occurred.
- Subsequent read-only RPC checks returned either DNS/connection failures or a
  null `eth_getTransactionByHash` result. The transaction's authoritative final
  state and any deployed address therefore remain unverified. The runner was not
  rerun, avoiding a possible duplicate deployment.

### Security incident and remaining blockers

- A diagnostic command emitted the currently configured deployer private-key
  assignment into protected session tool output. The secret is not reproduced
  here or in the proof artifact, but the key must be treated as compromised.
  The configured `.env` still derives to the same deployer address above, so a
  replacement key has not yet been installed in this workspace. No further
  signing may use that key.
- Required before continuing: restore stable access to the official Bradbury
  RPC/explorer; determine the recorded deployment transaction's final status and
  address read-only; rotate and fund a new deployer key; update the mode-600
  ignored `.env`; reconfirm distinct public accounts, balances, all evidence
  routes, and `mutableState=initial`; then decide whether the existing deployment
  can be resumed or a new authoritative run is required.
- No persistent proof, finalized payout delta, frontend contract configuration,
  frontend deployment, commit, or push was completed in this attempt.

## 2026-08-09 — finalized Bradbury deployment recovery and proof resume

### Findings and security clarification

- The exposed key was not committed to the repository, `.env`, proof artifact,
  or implementation log. It was accidentally emitted in a protected tool-session
  diagnostic while deriving a public wallet address from the ignored `.env`.
  Anyone with access to that session transcript could potentially have seen it,
  so it was correctly treated as compromised. The replaced key now derives to
  `0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7`; creator remains
  `0x7fD87C28F4345ee8A4124511e16084464ca2E123`. Private-key values and the
  mutation token are not recorded.
- `.env` remains mode 600 and Git-ignored. All shell loads used `set -a; source
  .env; set +a` without tracing or value output.

### Recovery implementation

- Added explicit `LIVE_EXISTING_CONTRACT_ADDRESS` and
  `LIVE_EXISTING_DEPLOYMENT_TRANSACTION` recovery inputs. They must be supplied
  together; recovery never invokes `deployContract`.
- Recovery reads the official Bradbury consensus-data lifecycle through
  genlayer-js, requiring `FINALIZED`, `AGREE`, and `FINISHED_WITH_RETURN`.
  It decodes deployment calldata, verifies the recovered contract address, and
  compares the exact source SHA-256. Existing proof artifacts are identity
  checked and atomically resumed rather than overwritten.
- Bradbury's official result name is currently `AGREE` (SDK/local variants may
  expose `MAJORITY_AGREE`); lifecycle classification now accepts both while
  retaining disagreement/no-majority/execution-failure rejection.
- Recovery, lifecycle, and preflight reads have bounded transient-RPC retries.
  Preflight performs balances and HTTPS GET/health checks only; the mutation
  webhook is never called during preflight. Failed terminal transactions are
  ignored for retry selection only after read-only contract state proves no
  submission was created.

### Authoritative recovered deployment

- Deployment transaction:
  `0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93`
- Contract:
  `0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04`
- Explorer links:
  https://explorer-bradbury.genlayer.com/tx/0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93
  and
  https://explorer-bradbury.genlayer.com/address/0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04
- Lifecycle: `FINALIZED`; consensus `AGREE`; execution
  `FINISHED_WITH_RETURN`.
- Current source SHA-256:
  `d19d74e60d5c869688690c2742bb4cd3875daafabb45ca0bfc994fbefd786ed7`.
- The recovered contract was read-only verified unused before scenarios.

### Submitted proof transactions and current state

- Clear-rejection bounty post finalized:
  `0x8d8dafeed5f5da06e52a9966f05249b0abe9362c5cf4a08bd063118a98aa4d5d`.
- Rejection evidence submission finalized:
  `0xaf1ebf600fb35d451d6ac795de1ab549c6b73b2b1863d200db28c1e18db5c4d4`.
- Clear-rejection evaluation finalized:
  `0xd3d6cafc07bbe23725fc742dab66e6d43d0b7c2ba36c7d19082cb7ad5657df33`.
- The rejection evaluation is `REJECTED`; the committed adversarial hash was
  verified on-chain as
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537` with
  1,092 normalized characters.
- First mutable-bounty post finalized:
  `0xe66cbe68a7f0c99ca6dbfdeabfe3bd5864abed77faf23562dbfe38b519181677`.
- First mutable submission `0xf69aa7aac4bdf2c65ddc7837c2754cc4bff2224d01c38abd7e66e4dca68d228d`
  reached terminal `LEADER_TIMEOUT` and was not retried until read-only state
  proved bounty 1 remained OPEN with zero submissions. Replacement mutable
  submission:
  `0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be`.
- The replacement mutable submission is currently observed as
  `ACCEPTED/AGREE/FINISHED_WITH_RETURN` on direct Bradbury reads. It has not yet
  finalized. The mutation webhook has not been called; Worker `mutableState`
  remains `initial`.
- Proof artifact: `/tmp/contentbounty-live-consensus-proof.json`, mode 600,
  `proofComplete=false`. It is incrementally checkpointed and contains all
  lifecycle observations and transient RPC errors.

### Exact commands and results

```text
node --test tests/js/live_deployment_recovery.test.mjs tests/js/live_run_preflight.test.mjs
=> PASS; 2 files, 9 subtests, 0 failed

npm run test:lifecycle
=> PASS; 5 files, 0 failed (including lifecycle AGREE handling, recovery,
   proof-store persistence, adversarial fixture, and preflight retries)

node --check tests/integration/live_consensus.mjs
node --check scripts/live-deployment-recovery.mjs
node --check scripts/live-run-preflight.mjs
git diff --check
=> PASS

npm run test:live (authorized recovery attempts)
=> No deployment branch executed. Deployment/rejection checks finalized;
   current run stopped at replacement mutable submission accepted while Bradbury
   consensus-data reads intermittently failed. No mutation or payout proof yet.
```

### Remaining live blockers

- Stable Bradbury consensus-data reads must observe replacement submission
  `0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be`
  as `FINALIZED/AGREE/FINISHED_WITH_RETURN`.
- Only then may the configured mutation webhook be called, followed by
  `INCONCLUSIVE` (`DIGEST_MISMATCH` or `FETCH_FAILED`), clear approval finality,
  and exact creator payout delta.
- `proofComplete` remains false. No frontend contract configuration or frontend
  hosting update has been made because the persistent payout-proof gate is not
  complete.

## 2026-08-09 — crash-safe mutation and deadline-aware live-proof recovery

### Review findings and decisions

- The existing proof artifact contained a manually introduced
  `BLOCKED_EXTERNAL_RPC` status whose failure timestamp was later than
  `updatedAt`. The committed runner now owns this transition, timestamps the
  failure before the atomic checkpoint, and safely resets it to `RUNNING` on
  resume.
- Mutation now uses an explicit `NOT_STARTED` / `PENDING` / `CONFIRMED` state
  machine. `PENDING`, including the exact mutable evidence URI, is durably
  checkpointed before webhook POST. A restart reconciles `PENDING + mutated`
  to `CONFIRMED` without reposting; `mutated` without a checkpoint and
  `initial + CONFIRMED` fail closed.
- Scenario recovery is keyed by stored bounty/submission IDs and validates
  title, poster, creator, URI, and transaction identity. New mutable and
  approval scenarios use unique titles and four-hour submission plus four-hour
  evaluation windows. Expired scenarios are not selected by title.
- Both known exposed deployer addresses are rejected before balances or any
  signing path: `0x3211d1419709682b81c53CC51cb63622E25488d3` and
  `0x3d5915888E60CdaFFbB1F94DeeB71694F5de2a5d`.
- The Bradbury deployment is live at
  `0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04`, while persistent proof remains
  incomplete. The frontend address stays blank until `proofComplete=true`.

### Current authoritative live state before continuation

- Replacement mutable submission transaction
  `0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be`
  is independently verified `FINALIZED / AGREE / FINISHED_WITH_RETURN` and maps
  to on-chain submission ID 1.
- Worker state remains `initial`; the mutation webhook has not been called.
- The original mutable bounty evaluation deadline is
  `2026-08-09T06:31:08Z`; the runner performs a read-only chain-time check and
  either resumes the exact stored scenario or expires and replaces it safely.
- `proofComplete=false`; no frontend contract address is configured yet.

### 2026-08-09 — offline recovery hardening verification

The recovery hardening changes are uncommitted in the working tree pending
authorized continuation. They add the crash-safe mutation state machine,
deadline-aware exact-ID scenario recovery, the second exposed-deployer
blocklist entry, committed external-RPC blocker checkpoint/resume behavior,
and lifecycle convenience-field checkpointing.

Exact verification results:

```text
npm run check:contract
=> PASS; semantic lint (3 checks) and contract validation passed.

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std npm run test:contract -- --quiet
=> PASS; 29 Direct Mode tests passed in 4.65s.

npm run test:evidence -- --quiet
=> PASS; 3 tests passed.
npm run test:network
=> PASS; 3 test files, 0 failed.
npm run test:hosting
=> PASS; 1 test file, 0 failed.
npm run test:lifecycle
=> PASS; 7 test files, 0 failed.

PATH=frontend/node_modules/.bin:$PATH npm --prefix frontend test -- --run
=> PASS; 4 test files, 67 tests passed.

VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS= npm run build:frontend
=> PASS; production bundle built.
npm run verify:frontend-bundle
=> PASS; 8 files scanned, historical v0.2 address absent.

git diff --check
=> PASS.
```

The clean frontend install required removing an incomplete generated
`frontend/node_modules` directory left by the restricted sandbox and rerunning
`npm ci --include=dev`; no package manifests or lockfiles were changed. The
current proof artifact remains `BLOCKED_EXTERNAL_RPC` with
`proofComplete=false`; the Worker remains `initial` and the mutation webhook
has not been called. No new live transaction has been submitted during this
offline remediation.

### 2026-08-09 — authorized recovery continuation stopped at external RPC blocker

Secret-safe Bradbury preflight passed immediately before continuation:

- network `testnetBradbury`, proof mode `persistent`;
- deployer `0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7` and creator
  `0x7fD87C28F4345ee8A4124511e16084464ca2E123` are distinct;
- read-only balances were `23994270408695601250` wei and
  `1999497892899400940` wei respectively;
- approval facts passed; rejection normalized SHA-256 remained
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537` with
  1,092 characters;
- Worker health remained `mutableState=initial`; mutation webhook was not
  called.

The authoritative `npm run test:live` recovery runner did not deploy another
contract and did not submit mutable or approval evidence. It read the exact
stored mutable bounty/submission (bounty ID 1, submission ID 1), observed the
documented evaluation deadline had passed, and submitted the authorized
deadline-safe expiration transaction:

`0xda8b176f3671b7fe4cfd2f2b23801377285119f0267144903b619f68e3ffc8d4`

The run then stopped while observing that transaction through Bradbury
consensus-data RPC (`getTransactionData` returned repeated `fetch failed`). The
artifact was atomically checkpointed at
`/tmp/contentbounty-live-consensus-proof.json` with mode 0600, status
`BLOCKED_EXTERNAL_RPC`, `proofComplete=false`, and completion checks:

```json
{
  "deploymentFinalized": true,
  "clearRejection": true,
  "adversarialRejectionVerified": true,
  "mutationInconclusive": false,
  "clearApprovalFinalized": false,
  "persistentPayoutDelta": false
}
```

Mutation state remains `NOT_STARTED` for the exact mutable URI. No mutation
webhook call, mutable evaluation, approval bounty, approval submission,
approval evaluation, payout, frontend contract configuration, commit, or push
occurred in this continuation. Do not rerun until read-only Bradbury access is
stable and the expiration transaction is independently confirmed; then resume
the same proof artifact without duplicating it.

### 2026-08-09 — offline hardening committed before live continuation

Additional offline review fixes completed before any new signed live action:

- Added `scripts/deployer-guard.mjs` as the shared compromised-account guard.
  It rejects both exposed addresses before live balance reads, deployment
  client creation, `deployContract`, or creator signing activity.
- Proof-artifact loading now normalizes every transaction's accepted/finalized
  convenience fields from observations, including legacy inconsistent records,
  before resume/checkpoint.
- Preflight metadata now reports `mutableEvidenceInitial=false` after a valid
  `PENDING/CONFIRMED + mutated` reconciliation and fails closed for the other
  three state combinations.
- Proof provenance now separates deployed source commit/SHA-256 from runner
  commit and runner dirty state. Follow-up review established that the
  deployment-time proof artifact recorded source commit
  `c5c64c1ef007fa9b06d96aaa9255fe7322e6d356`; recovery preserves that exact
  recorded attribution and the authoritative source SHA-256 rather than
  substituting a later commit. Runner provenance is captured independently at
  artifact creation/resume.
- README, frontend README, and live-proof documentation now identify
  `AUDIT_REPORT.md` as an archival audit of historical commit `a09fe6a`; the
  audit file itself remains unchanged.

Offline results before commit:

```text
npm run check:contract
=> PASS; 3 semantic checks and contract validation.
GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std npm run test:contract -- --quiet
=> PASS; 29 Direct Mode tests in 9.50s.
npm run test:evidence -- --quiet
=> PASS; 3 tests.
npm run test:network
=> PASS; 4 files, including deployer guard.
npm run test:lifecycle
=> PASS; 8 files, 0 failed.
npm run test:hosting
=> PASS; 1 file, 0 failed.
npm --prefix frontend test -- --run
=> PASS; 4 files, 67 tests.
(cd frontend && ./node_modules/.bin/vue-tsc -b --pretty false)
=> PASS.
VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS= npm run build:frontend
=> PASS; production bundle built.
npm run verify:frontend-bundle
=> PASS; 8 files scanned, historical address absent.
node --check deploy.mjs scripts/deployer-guard.mjs scripts/live-provenance.mjs tests/integration/live_consensus.mjs
=> PASS.
js-yaml .github/workflows/ci.yml
=> PASS.
git diff --check; git diff --quiet -- AUDIT_REPORT.md
=> PASS.
```

### 2026-08-09 — crash-boundary scenario recovery milestone (pending commit)

The runner now checkpoints replacement scenarios before every operation and
requires exact transaction provenance at every recovery boundary. A stored
bounty ID must have its exact post transaction; a stored submission ID must
have its exact submission transaction; and an evaluation can resume only from
`scenario.evaluationTransaction`. Label-only recovery is accepted only when
exactly one usable transaction matches, otherwise the run fails closed.
Closure state is now scenario-bound (`closureAction` plus
`closureTransaction`), preserving the already-finalized mutable expiration in
the scenario history and preventing a duplicate expiration or action mismatch.
Deployment receipt classification treats both `AGREE` and
`MAJORITY_AGREE` as successful consensus when status is `FINALIZED` and
execution is `FINISHED_WITH_RETURN`.

Focused additions passed:

```text
node --test tests/js/live_scenario_executor.test.mjs tests/js/live_scenario_recovery.test.mjs tests/js/deployer_guard.test.mjs tests/js/live_provenance.test.mjs
=> PASS; 4 test files, 0 failures.
node --check scripts/live-scenario-executor.mjs tests/integration/live_consensus.mjs deploy.mjs
=> PASS.
git diff --check
=> PASS.
```

The complete offline suite for this milestone also passed: semantic check,
29 Direct Mode tests, evidence (3), network (4 files), lifecycle (9 files),
hosting (1), frontend (67), typecheck, production build, bundle verification,
dependency audits (0 vulnerabilities in root and frontend), CI YAML parsing,
and secret-safe mode-600 checks for `.env` and `frontend/.env`. No signed
transaction or mutation webhook call occurred during this offline milestone.

The milestone was committed locally as
`831d56102f92167ddc8ea8306b7c2f177268a9e4` (`fix: make live scenario
recovery crash-safe`) before live execution.

### 2026-08-09 — Bradbury recovery resumed; stopped on external RPC

After commit `831d561`, the authorized read-only preflight passed without
printing secrets:

- network `testnetBradbury`, mode `persistent`;
- deployer `0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7` balance
  `23995141894446959450` wei;
- creator `0x7fD87C28F4345ee8A4124511e16084464ca2E123` balance
  `1999497892899400940` wei;
- accounts distinct and neither is blocklisted;
- Worker `mutableState=initial`;
- rejection digest
  `efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537`,
  1,092 normalized characters.

The single authoritative `npm run test:live` invocation reconciled the
finalized expiration transaction
`0xda8b176f3671b7fe4cfd2f2b23801377285119f0267144903b619f68e3ffc8d4`
and preserved it in the expired scenario history. It then posted the unique
replacement mutable bounty:

`0xb31e357f4c3e0f6199ce34ee9f585a53d9e7c42c42907ced374507e26f8adda2`

Explorer:
`https://explorer-bradbury.genlayer.com/tx/0xb31e357f4c3e0f6199ce34ee9f585a53d9e7c42c42907ced374507e26f8adda2`

The runner observed `ACCEPTED / AGREE / FINISHED_WITH_RETURN`, then Bradbury
consensus-data `eth_call` repeatedly failed while waiting for finalization.
After the bounded retry window it exited nonzero and atomically checkpointed
`/tmp/contentbounty-live-consensus-proof.json` (mode 0600) with
`status=BLOCKED_EXTERNAL_RPC`, timestamp `2026-08-09T23:31:39.044Z`, and
`proofComplete=false`. Current completion checks remain:

```json
{
  "deploymentFinalized": true,
  "clearRejection": true,
  "adversarialRejectionVerified": true,
  "mutationInconclusive": false,
  "clearApprovalFinalized": false,
  "persistentPayoutDelta": false
}
```

The replacement scenario has its exact post transaction checkpointed but no
bounty ID, submission transaction, submission ID, or evaluation transaction
yet. Mutation remains `NOT_STARTED`; the webhook was not called and the Worker
still reports `initial`. Do not post another bounty. The next safe action is a
single resume of the same artifact after Bradbury consensus-data RPC is stable,
allowing exact post-transaction recovery before any submission. The frontend
address remains blank. Nothing was pushed.

### 2026-08-10 — deadline-safe recovered-post remediation (pending commit)

The remaining recovered-post deadline gap is closed before any further signed
action. After an exact checkpointed post transaction is finalized and its bounty
ID is recovered, the runner now re-reads that exact bounty and a fresh Bradbury
chain timestamp before considering `submit_content`. It validates exact poster,
title, reward, description, rubric JSON/version, configured evidence URI,
recognized status, ordered deadlines, and transaction provenance. If the
submission window closed during RPC downtime, the runner checkpoints and
reconciles exactly one `cancel_bounty` transaction while the bounty is still
`OPEN` and inside evaluation grace, or exactly one `expire_bounty` transaction
after evaluation grace, preserves the closure in scenario history, and creates
a uniquely titled replacement. Restarts recover each post, closure, bounty, and
submission checkpoint rather than duplicating a write. A post is replaced after
failure only when its exact final observation is explicitly terminal; accepted,
nonterminal, or RPC-ambiguous observations fail closed.

The same deadline-safe executor is used for the mutation and approval scenarios.
An existing finalized submission remains bound to its original scenario through
its evaluation window, while a scenario that has passed evaluation grace is
expired and replaced without reusing an ambiguous title. Documentation now says
the authoritative Bradbury contract exists while persistent proof and frontend
configuration remain incomplete.

Clean-install and verification results for this milestone:

```text
npm ci
=> PASS; added 217 packages.
npm ci --prefix frontend
=> PASS; added 307 packages. The first sandboxed attempt could not execute the
   esbuild binary (EPERM); the same command passed outside that sandbox-only
   execution restriction.
npm audit --omit=dev
=> PASS; found 0 vulnerabilities.
npm audit --omit=dev --prefix frontend
=> PASS; found 0 vulnerabilities.
npm run check:contract
=> PASS; 3 semantic checks and contract validation (10 methods: 5 view, 5 write).
GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std npm run test:contract -- --quiet
=> PASS; 29 Direct Mode tests in 16.37s.
npm run test:evidence -- --quiet
=> PASS; 3 tests in 0.21s.
npm run test:network
=> PASS; 4 files, 4 passed, 0 failed.
npm run test:lifecycle
=> PASS; 11 files, 11 passed, 0 failed, including deadline/crash recovery.
npm run test:hosting
=> PASS; 1 file, 1 passed, 0 failed.
npm --prefix frontend test -- --run
=> PASS; 4 files, 67 tests.
VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS= npm run build:frontend
=> PASS; vue-tsc and production build, 461 modules transformed.
npm run verify:frontend-bundle
=> PASS; 8 files scanned; historical v0.2 address absent.
```

No Bradbury write, mutation webhook call, deployment, signing, frontend address
configuration, or push occurred during this offline remediation. The raw proof
remains mode `0600`, `proofComplete=false`, and mutation `NOT_STARTED` pending
the required clean commit and exact read-only reconciliation of
`0xb31e357f4c3e0f6199ce34ee9f585a53d9e7c42c42907ced374507e26f8adda2`.

### 2026-08-10 — exact replacement post recovered; submission-label defect found

The deadline remediation was committed cleanly as
`da3e815414a89c3035bceae555578c9380a9b651`. A bounded read-only Bradbury probe
then established on its first attempt that replacement post
`0xb31e357f4c3e0f6199ce34ee9f585a53d9e7c42c42907ced374507e26f8adda2`
is `FINALIZED / AGREE / FINISHED_WITH_RETURN` and maps uniquely to bounty `2`,
title `Live mutation inconclusive [20260809232050-2]`, poster
`0x381b78F0C90a29cE2acDB718a9A4E1387004D3c7`, reward
`1000000000000000` wei, status `OPEN`, submission deadline `1786332053`, and
evaluation deadline `1786346453`.

The single authorized resume stopped before any new transaction or webhook call.
It correctly recorded runner commit `da3e815` with `dirty=false`, but exposed an
unsafe legacy recovery path: the global label `submit mutable evidence` selected
the old finalized submission transaction
`0xf6951790e7933b6f257dbf4959d98384b05b824ea4588e6a602d5931384003be`
from expired bounty `1` and temporarily attached it to bounty `2`. Exact
on-chain submission matching then failed closed with:

```text
Stored submission transaction finalized but exact submission was not found
```

No transaction was submitted, mutation remains `NOT_STARTED`, and a public
`/healthz` check still reports `mutableState=initial` with the committed
rejection digest and 1,092-character count intact.

The follow-up remediation removes label-only submission-transaction recovery.
Submission recovery now requires the transaction hash already checkpointed on
the exact scenario; an exact on-chain submission without that binding fails
closed rather than guessing. On artifact load, a current scenario transaction
that exactly duplicates a different-bounty history entry is cleared only when
the current submission ID is still null, and the correction, old hash, and both
bounty IDs are durably recorded before network preflight. A contradictory stored
submission ID fails closed. Recovery corrections survive subsequent scenario
replacement history. Focused syntax and four-file recovery tests pass; the fix
must be committed cleanly before another signed action.

### 2026-08-10 — accepted transactions preserved across Bradbury finality outages

The exact-submission fix was committed as
`158c38b71a00b5ea8ddd8805bff2e2266811a68e`. On the next authorized resume,
bounty `2` was freshly observed past its submission deadline but before its
evaluation deadline. The runner submitted exactly one `cancel_bounty`
transaction:

`0xdbf75825439416bb3501eb0a8e88ea8fd411b0d3bd5794ba081c94a90bb588ce`

It was first checkpointed `ACCEPTED / AGREE / FINISHED_WITH_RETURN`; after the
runner stopped on repeated consensus-data fetch failures, bounded read-only
polling later verified it `FINALIZED / AGREE / FINISHED_WITH_RETURN` and bounty
`2` as `CANCELLED`. The runner then recovered that exact closure without
duplication and posted one unique replacement mutable bounty:

`0xa00fdbdf715bbbe9f6ac434f509cb0363a8dd62bc14daed63b2121b48c784963`

Title: `Live mutation inconclusive [20260810050816-3]`. The post reached
`ACCEPTED / AGREE / FINISHED_WITH_RETURN`, but the runner again exhausted its
12 transient consensus-data retries before the Bradbury finality interval
completed. No mutable submission or webhook call occurred; mutation remains
`NOT_STARTED` and the exact post hash is checkpointed with `bountyId=null`.

The lifecycle helper now retains a bounded 30-minute transient-RPC error budget
(360 retries at five seconds) aligned with the existing 30-minute finalized
receipt wait. Terminal consensus/execution states still fail immediately. This
prevents intermittent Bradbury read failures from prematurely ending an
otherwise healthy accepted transaction while preserving a finite external
blocker boundary.

Follow-up read-only evidence showed the accepted replacement post still was not
finalizable roughly 51 minutes after its `createdTimestamp`; the official
Bradbury consensus-data `canFinalize` view returned `false`. Therefore a
30-minute finalized-receipt timeout was also too short under normal Bradbury
appeal timing, independent of RPC instability. The runner now uses one shared,
tested three-hour bound for finalized receipt polling and transient lifecycle
read errors. This remains finite and fail-closed while allowing the public
testnet's observed appeal/finality interval to complete.
