<div align="center">

<img src="docs/hero.png" alt="ContentBounty logo" width="150" />

# ContentBounty v2

**Escrow for creative work adjudicated by GenLayer consensus.**

[![Live app](https://img.shields.io/badge/live-Bradbury-14532d)](https://contentbounty.vercel.app)
[![CI](https://github.com/unifyWeb3/contentbounty/actions/workflows/ci.yml/badge.svg)](https://github.com/unifyWeb3/contentbounty/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

</div>

ContentBounty lets a poster define an ordered rubric and escrow a GEN reward for
creative work. A creator submits public evidence, GenLayer validators evaluate
every required criterion, and deterministic contract logic decides whether to
reject, retry, or release the reward.

The application is deployed on the GenLayer Bradbury testnet with a complete
persistent proof covering rejection, evidence mutation, approval, and payout.

## Start here

| Resource | Link |
| --- | --- |
| Live application | [contentbounty.vercel.app](https://contentbounty.vercel.app) |
| Bradbury contract | [View contract](https://explorer-bradbury.genlayer.com/address/0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04) |
| Deployment transaction | [View transaction](https://explorer-bradbury.genlayer.com/tx/0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93) |
| Persistent proof | [View verified proof](docs/proofs/bradbury-persistent-proof-v1.json) |
| Contract specification | [Read the v2 specification](docs/CONTENT_BOUNTY_V2_SPEC.md) |
| Live verification guide | [Read the proof procedure](docs/LIVE_CONSENSUS_TESTING.md) |

## The problem

Traditional smart contracts can enforce objective rules, but they cannot
determine whether creative work satisfies a natural-language brief. Moving that
decision to a platform operator, judge, or private AI service reintroduces a
trusted intermediary.

ContentBounty keeps custody and settlement inside an Intelligent Contract while
GenLayer validators perform the non-deterministic evaluation. The model supplies
observations and criterion judgments. Deterministic code controls the status,
recipient, and payment.

## How it works

```text
Post bounty -> Submit evidence -> Reach consensus -> Settle escrow
```

1. **Post bounty**
   The poster defines a title, description, ordered rubric, deadlines, and GEN
   reward. The reward is escrowed by the contract.
2. **Submit evidence**
   A creator supplies a stable HTTPS URI containing canonical UTF-8 text.
   Submission consensus renders, normalizes, hashes, and commits the evidence.
3. **Reach consensus**
   A leader evaluates the evidence and every required criterion. Validators
   independently repeat the evidence pipeline and compare the fields that
   control settlement.
4. **Settle escrow**
   Approved work receives the full reward. Rejected work remains unpaid.
   Fetch, parser, or digest uncertainty returns an inconclusive result that can
   be retried without misclassifying the creator.

## Why GenLayer

ContentBounty uses GenLayer for work that an ordinary deterministic contract
cannot perform safely:

- `gl.nondet.web.render` retrieves bounded public evidence.
- Submission consensus creates the authoritative evidence commitment.
- `gl.nondet.exec_prompt` extracts observations and evaluates the rubric.
- `gl.vm.run_nondet_unsafe` defines an independent validator policy.
- Exact equivalence fields prevent prose differences from changing settlement.
- Finalized `emit_transfer` messages release rewards or refunds.

Validators must match these payout-controlling fields:

| Field | Purpose |
| --- | --- |
| Evidence SHA-256 | Detects changed rendered evidence |
| Decision | `APPROVE`, `REJECT`, or `INCONCLUSIVE` |
| Criteria bits | Ordered per-criterion results, such as `101` |
| Score bucket | Deterministic integer from 0 to 4 |
| Reason code | Fixed machine-readable outcome |

Feedback is stored for users, but feedback wording never controls payment. The
model never chooses the payout amount or recipient.

## Verified Bradbury deployment

| Item | Value |
| --- | --- |
| Network | `testnetBradbury` |
| Chain ID | `4221` |
| Contract | `0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04` |
| Deployment status | `FINALIZED / AGREE / FINISHED_WITH_RETURN` |
| Proof status | `COMPLETE` |
| Persistent payout proof | `true` |

The tracked proof records deployment and scenario transaction hashes, source
and runner provenance, final lifecycle observations, and payout arithmetic:

[docs/proofs/bradbury-persistent-proof-v1.json](docs/proofs/bradbury-persistent-proof-v1.json)

### Proven outcomes

| Scenario | Bounty | Submission | Result | Reason |
| --- | ---: | ---: | --- | --- |
| Clear rejection | `0` | `0` | `REJECTED` | `CRITERIA_NOT_MET` |
| Mutated evidence | `4` | `2` | `INCONCLUSIVE` | `DIGEST_MISMATCH` |
| Clear approval | `5` | `3` | `APPROVED` | `ALL_REQUIRED_CRITERIA_MET` |

The approved scenario produced an exact finalized recipient balance increase of
`1000000000000000` wei, equal to the escrowed reward. The proof uses
persistent public testnet values and does not simulate balances.

## Contract lifecycle

```text
OPEN -> LOCKED -> FILLED
  |
  +-> CANCELLED
  +-> EXPIRED
```

- `OPEN`: funded and accepting a submission. The poster may cancel before any
  creator locks the bounty.
- `LOCKED`: at least one submission exists. Poster cancellation is disabled.
- `FILLED`: a consensus-approved submission won and the reward was emitted.
- `CANCELLED`: an untouched bounty was refunded.
- `EXPIRED`: evaluation grace ended without a winner and the reward was
  refunded.

Submissions can become `APPROVED`, `REJECTED`, `INCONCLUSIVE`, or
`SUPERSEDED`. Inconclusive evaluations may retry up to three times.

## Safety and finality

- The frontend uses an injected external wallet and never requests or stores a
  private key.
- Unsupported networks, invalid production addresses, and historical contract
  addresses fail closed.
- Before every write, the frontend verifies Bradbury execution state and
  consensus contract identity against the injected provider.
- Evidence mutation produces `DIGEST_MISMATCH` instead of an approval or
  dishonest rejection.
- Transaction status distinguishes submission, processing, acceptance, and
  finalization.
- An accepted transaction is not presented as finalized.
- Payout claims require finalized execution and an independently checked
  recipient balance delta.
- Live runner state, lifecycle observations, and mutation checkpoints are
  persisted for crash-safe recovery.

Bradbury and another GenLayer network share chain ID `4221`. If an injected
wallet cannot be switched automatically, configure its chain-4221 RPC for
Bradbury before attempting a write.

## Quick start

### Requirements

- Node.js and npm
- Python 3.12 for contract validation and Direct Mode tests

Install dependencies:

```bash
npm ci
npm ci --prefix frontend
```

Configure and run the frontend:

```bash
cp frontend/.env.example frontend/.env
npm --prefix frontend run dev
```

The example environment selects Bradbury and the verified v2 contract. The app
opens through the local URL printed by Vite.

### Production build

From the repository root:

```bash
VITE_GENLAYER_NETWORK=testnetBradbury VITE_CONTRACT_ADDRESS=0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04 npm run build:frontend
npm run verify:frontend-bundle
```

The production build rejects missing or incompatible configuration. Bundle
verification requires the verified Bradbury address and rejects the historical
v0.2 address.

## Prepare evidence

Evidence must be UTF-8 raw text at a stable, preferably content-addressed HTTPS
URI. Normalized evidence must contain 1 to 16,000 characters.

The helper reproduces the contract's line-ending and outer-whitespace
normalization:

```bash
.venv/bin/python scripts/prepare_evidence.py --uri https://gateway.example/ipfs/<cid>/evidence.txt --file evidence.txt --write-canonical canonical-evidence.txt
```

Publish the generated canonical file at the supplied URI. Submission consensus
remains authoritative and stores the renderer-derived digest.

## Test and verify

Create the Python environment:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Run the main checks:

```bash
npm run lint:contract
npm run check:contract
npm run test:contract
npm run test:evidence
npm run test:network
npm run test:lifecycle
npm run test:hosting
npm --prefix frontend test
```

Validate the tracked public proof:

```bash
npm run verify:live-proof
npm run verify:live-proof:online
```

The online verifier is read-only. It confirms finalized lifecycle state and
matches the three proven submissions against the public contract.

GitHub Actions runs semantic contract validation, Direct Mode tests, evidence
and recovery tests, frontend tests, type checking, the production build, proof
validation, and generated-file checks.

## Repository structure

```text
contracts/content_bounty.py       Intelligent Contract
frontend/                         Vue application with external wallet signing
hosting/live-evidence/            Public evidence Worker
scripts/                          Deployment, recovery, proof, and safety tools
tests/direct/                     GenLayer Direct Mode contract tests
tests/js/                         Lifecycle, recovery, proof, and network tests
tests/unit/                       Evidence preparation tests
docs/CONTENT_BOUNTY_V2_SPEC.md    Contract and equivalence specification
docs/LIVE_CONSENSUS_TESTING.md    Authorized live-proof procedure
docs/proofs/                      Sanitized persistent public proof
IMPLEMENTATION_LOG.md             Auditable implementation record
```

`AUDIT_REPORT.md` documents the historical pre-v2 commit. It does not
describe the current verified deployment.

## Live operations

Deployment, recovery, and persistent proof execution are intentionally kept out
of the quick-start path. They require explicit authorization, funded accounts,
stable evidence fixtures, and careful lifecycle monitoring.

Use the dedicated procedure:

[docs/LIVE_CONSENSUS_TESTING.md](docs/LIVE_CONSENSUS_TESTING.md)

Do not rerun the completed proof, redeploy the verified contract, or call the
mutation fixture unless a new authorized proof campaign explicitly requires it.
Never commit private keys or mutation credentials.

## Technical documentation

- [ContentBounty v2 specification](docs/CONTENT_BOUNTY_V2_SPEC.md)
- [Live consensus testing and recovery](docs/LIVE_CONSENSUS_TESTING.md)
- [Persistent Bradbury proof](docs/proofs/bradbury-persistent-proof-v1.json)
- [Frontend safety model](frontend/README.md)
- [Evidence Worker](hosting/live-evidence/README.md)
- [Implementation log](IMPLEMENTATION_LOG.md)

## License

[MIT](LICENSE) Copyright 2026 unifyWeb3
