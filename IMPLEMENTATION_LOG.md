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
