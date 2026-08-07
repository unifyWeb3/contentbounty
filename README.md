<div align="center">

<img src="docs/hero.png" alt="ContentBounty" width="150" />

# ContentBounty v2

**Escrow for creative work adjudicated by substantive GenLayer consensus.**

</div>

ContentBounty lets a poster escrow a GEN reward against a bounded, ordered
rubric. A creator submits a canonical raw-text HTTPS evidence URI. GenLayer
leaders and validators render, normalize, and hash it during submission, then
independently fetch, verify, extract observations, and judge every criterion at
evaluation. Deterministic contract code—not model prose—derives the verdict and
controls settlement.

The historical v0.2 Studionet deployment is not compatible with this contract
or frontend. No v2 deployment is claimed until a finalized address and
transaction hash are recorded in `IMPLEMENTATION_LOG.md`.

## Why GenLayer

Ordinary smart contracts cannot render web evidence or apply a natural-language
rubric. An off-chain evaluator would reintroduce a trusted operator. GenLayer
allows the non-deterministic work to run inside an Intelligent Contract while
independent validators enforce the equivalence principle.

ContentBounty v2 uses:

- `gl.nondet.web.render` for bounded text evidence;
- submission consensus to create the renderer-derived evidence commitment;
- `gl.nondet.exec_prompt` for observation extraction and criterion judgment;
- single-line JSON prompt envelopes for untrusted rubric, evidence, and
  observation values;
- `gl.vm.run_nondet_unsafe` for an explicit independent validator policy;
- deterministic criterion bits, score bucket, decision, and reason code;
- finalized `emit_transfer` messages for payout or refunds.

## Contract model

### Bounty lifecycle

```text
OPEN -> LOCKED -> FILLED
  |
  +-> CANCELLED
  +---------------> EXPIRED
```

- `OPEN`: funded, no submission; the poster may cancel.
- `LOCKED`: at least one submission; cancellation is disabled.
- `FILLED`: the first consensus-approved submission won.
- `CANCELLED`: an untouched bounty was refunded.
- `EXPIRED`: evaluation grace ended without a winner; anyone may trigger the
  refund.

Submissions become `APPROVED`, `REJECTED`, `INCONCLUSIVE`, or `SUPERSEDED`.
Inconclusive evaluations may retry up to three times. Fetch failure, digest
mismatch, excessive evidence, and model/parser failure are inconclusive rather
than dishonest rejections.

### Equivalence principle

The validator independently reruns the entire evidence pipeline and accepts a
leader result only when these payout-controlling fields match exactly:

| Field | Purpose |
|---|---|
| evidence SHA-256 | detects changed rendered evidence |
| decision | `APPROVE`, `REJECT`, or `INCONCLUSIVE` |
| criteria bits | ordered per-criterion result, such as `101` |
| score bucket | deterministic integer from 0–4 |
| reason code | fixed machine-readable outcome |

Feedback wording is bounded and stored for users, but deliberately ignored for
equivalence. The model never chooses a payout amount or recipient.

See [the v2 specification](docs/CONTENT_BOUNTY_V2_SPEC.md) and
[implementation log](IMPLEMENTATION_LOG.md) for the complete design, commands,
versions, results, blockers, and deployments.

## Prepare evidence

Use UTF-8 raw text at a stable, preferably content-addressed HTTPS URI. The
contract derives the authoritative SHA-256 through GenLayer WebRender during
submission, so the frontend never asks users to guess a browser-DOM or normal
HTTP-response digest. The repository helper reproduces the contract's line
ending and outer-whitespace normalization and emits the exact canonical text,
digest, URI, and counts:

```bash
.venv/bin/python scripts/prepare_evidence.py \
  --uri https://gateway.example/ipfs/<cid>/evidence.txt \
  --file evidence.txt \
  --write-canonical canonical-evidence.txt
```

Publish the generated canonical file bytes at the supplied URI. Normalized
evidence must contain 1–16,000 characters; empty, whitespace-only, or oversized
content fails submission before any creator slot is consumed or bounty is
locked. The contract's submission consensus remains authoritative and stores
its renderer-derived digest; later mutation becomes an inconclusive digest
mismatch.

## Frontend safety and finality

The Vue frontend uses an injected external signer. It never asks for a private
key and stores no wallet secret. It persists only transaction identifiers and
observed lifecycle states.

Before every write it fail-closed verifies the injected provider's selected
consensus address, bytecode, and official consensus ABI identity probe.
Bradbury shares chain ID `4221` with another network, and an injected wallet
does not expose its RPC URL, so the app compares both providers at a stable
common block. Identical history, bytecode, and probe output are treated as
equivalent execution state; this is not a cryptographic proof of the wallet's
RPC URL. A wallet that cannot be automatically switched must be manually
configured to Bradbury's chain-4221 RPC; ambiguous identity blocks both
payable and nonpayable writes. The guard permits at most 3 sampled head blocks
of lag and compares a common block 2 confirmations behind both heads.

The UI distinguishes:

1. `SUBMITTED`: a consensus transaction id exists;
2. `PROCESSING`: consensus, appeal, or finalization is still in progress;
3. `ACCEPTED`: status is accepted, a majority agreed, and execution returned
   successfully, but finalization may still be appealable;
4. `FINALIZED`: final status, majority agreement, and successful execution are
   all present.

Even a finalized approved evaluation proves that the contract emitted the
transfer; a recipient balance delta should still be checked before describing
the reward as confirmed paid.

## Repository

```text
contracts/content_bounty.py       ContentBounty v2 Intelligent Contract
tests/direct/                     adversarial GenLayer Direct Mode tests
docs/CONTENT_BOUNTY_V2_SPEC.md    lifecycle and equivalence specification
docs/LIVE_CONSENSUS_TESTING.md    authorized live-proof procedure
frontend/                         external-signer Vue application
deploy.mjs                        validated multi-network deployment helper
IMPLEMENTATION_LOG.md             auditable implementation-session record
AUDIT_REPORT.md                    immutable source audit and handoff
```

## Verify the contract

The pinned Python toolchain is recorded in `requirements.txt` and
`IMPLEMENTATION_LOG.md`.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
npm run lint:contract
npm run check:contract
npm run test:contract
npm run test:evidence
npm run test:network
```

Direct Mode may need `GENVM_PY_STD_SOURCE` pointed at an official compatible
GenVM Python runner checkout when its normal cache is unavailable.
`check:contract` runs full semantic validation with GenVM `v0.2.16`; it is not
the shorter three-check AST-only lint command.

## Run the frontend

```bash
cd frontend
npm install
cp .env.example .env
# select VITE_GENLAYER_NETWORK and set a matching deployed v2 address
npm run dev
```

Production build:

```bash
npm run build
```

## Deploy v2

Deployment uses the root `genlayer-js` dependency and reads the deployer key
from the process environment rather than a command-line argument. The network
selector accepts only `studionet` or `testnetBradbury`; it
uses the selected official chain object's RPC, explorer, chain ID, and consensus
contracts:

```bash
npm install
GENLAYER_NETWORK=testnetBradbury \
GENLAYER_DEPLOY_MODE=persistent \
GENLAYER_DEPLOYER_PRIVATE_KEY=0x... \
node deploy.mjs
```

`GENLAYER_NETWORK` is required. A Studionet deployment is allowed only with
`GENLAYER_DEPLOY_MODE=studionet-smoke` and is simulated, not persistent proof.
Unsupported values and any unsuccessful receipt return a nonzero exit code. Do
not commit the key. After successful finalization, record the network, contract
address, transaction hash, source commit, and source SHA-256 in
`IMPLEMENTATION_LOG.md`.

## Live consensus proof

The opt-in integration runner deploys the current source, observes lifecycle
receipts, exercises clear approval/rejection and mutable evidence failure, and
verifies the finalized winner balance delta. Persistent proof mode accepts only
`testnetBradbury`; Studionet requires the explicit
`LIVE_PROOF_MODE=studionet-smoke` demo mode and is never valid settlement
evidence. The runner checkpoints a mode-0600 proof artifact before the first
transaction and after each lifecycle observation and scenario. Its
`proofComplete` flag is true only after deployment finality, clear rejection,
mutation inconclusive behavior, clear approval finality, and an exact
persistent recipient balance delta. No deployment or live proof exists yet.
It is never run by CI and requires explicit authorization plus funded keys and
external evidence fixtures. See [live consensus verification](docs/LIVE_CONSENSUS_TESTING.md).

## Continuous integration

GitHub Actions installs the commit-pinned Python dependencies, uses the official
GenVM `v0.2.16` source at commit
`387e1a66e920cb2dfadcdce40ab2d28da02efd1e`, and runs full semantic lint,
29 Direct Mode tests, evidence/network/proof-mode/lifecycle tests, 64 frontend
tests, frontend typecheck/build, and diff checks.

## License

[MIT](LICENSE) © unifyWeb3
