<div align="center">

<img src="docs/hero.png" alt="ContentBounty" width="150" />

# ContentBounty v2

**Escrow for creative work adjudicated by substantive GenLayer consensus.**

</div>

ContentBounty lets a poster escrow a GEN reward against a bounded, ordered
rubric. A creator submits an HTTPS evidence URI plus the SHA-256 of its
normalized rendered text. GenLayer leaders and validators independently fetch,
hash, extract observations, and judge every criterion. Deterministic contract
code—not model prose—derives the verdict and controls settlement.

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
- `gl.nondet.exec_prompt` for observation extraction and criterion judgment;
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

## Frontend safety and finality

The Vue frontend uses an injected external signer. It never asks for a private
key and stores no wallet secret. It persists only transaction identifiers and
observed lifecycle states.

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
npm run test:contract
```

Direct Mode may need `GENVM_PY_STD_SOURCE` pointed at an official compatible
GenVM Python runner checkout when its normal cache is unavailable.

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
selector accepts only `studionet`, `testnetAsimov`, or `testnetBradbury`; it
uses the selected official chain object's RPC, explorer, chain ID, and consensus
contracts:

```bash
npm install
GENLAYER_NETWORK=testnetBradbury \
GENLAYER_DEPLOYER_PRIVATE_KEY=0x... \
node deploy.mjs
```

The default selector is `studionet`. Unsupported values and any unsuccessful
receipt return a nonzero exit code. Do not commit the key. After successful
finalization, record the network, contract address, transaction hash, source
commit, and source SHA-256 in `IMPLEMENTATION_LOG.md`.

## License

[MIT](LICENSE) © unifyWeb3
