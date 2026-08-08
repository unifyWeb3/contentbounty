# ContentBounty v2 frontend

Vue 3, Vite, TypeScript, and `genlayer-js` 1.1.8 client for the v2 Intelligent
Contract.

No v2 deployment or live consensus proof exists yet; persistent proof is
restricted to authorized `testnetBradbury` runs.

## Safety model

- Uses an injected external wallet only.
- Never generates, imports, displays, or persists a private key.
- Parses GEN amounts as exact 18-decimal integers.
- Accepts only the evidence URI; submission consensus derives the canonical
  GenLayer-rendered SHA-256 instead of trusting a browser-calculated digest.
- Persists transaction identifiers and observed lifecycle states so evidence
  survives reload.
- Separates `SUBMITTED`, `ACCEPTED`, and `FINALIZED`; it does not treat an
  accepted evaluation as a confirmed payout.
- Requires `MAJORITY_AGREE` and `FINISHED_WITH_RETURN` before displaying an
  accepted or successfully finalized transaction.
- Before every write, verifies the injected provider's chain ID, selected
  consensus contract code, and official consensus ABI probe. Bradbury also
  compares wallet and official RPC block hashes at the latest height both
  providers report, allowing at most 3 sampled head blocks of lag. Bradbury
  bytecode and `VERSION()` output must match at that latest common block; a
  block 2 confirmations behind is additionally checked for continuity.
  Because the wallet RPC URL is unavailable, this
  treats identical execution state as equivalent rather than claiming a
  cryptographic RPC-identity proof.
- Reads v2 bounties, bounty submissions, and wallet activity through bounded
  paginated views; activity uses the contract's creator index rather than a
  whole-market scan.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Production verification:

```bash
npm test
npm run build
```

Repository-level production verification additionally runs
`npm run verify:frontend-bundle`, which fails if generated assets contain the
historical v0.2 address. The Vite production configuration also rejects that
address before bundling.

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_CONTRACT_ADDRESS` | yes | Deployed ContentBounty v2 address |
| `VITE_GENLAYER_NETWORK` | no | `testnetBradbury` (default) or explicit `studionet` smoke/demo |

The selector chooses the complete official `genlayer-js` chain object,
including its RPC, explorer, chain ID, and consensus contract configuration.
Unsupported and differently-cased values fail the application build/startup.
Bradbury shares chain ID `4221` with another network; wallet switching cannot
select between them automatically. If the injected provider's latest-common block,
consensus code, or ABI probe is unavailable or mismatched, every write is
blocked and the UI instructs the user to change the wallet's chain-4221 RPC to
Bradbury. The selected official RPC is used as the identity reference; if it
is unreachable, the app fails closed rather than guessing.

The historical v0.2 address is incompatible with this frontend. Until a
finalized v2.1.1 Bradbury address is supplied, keep
`VITE_CONTRACT_ADDRESS=` empty; the UI remains honestly not configured.

Prepare evidence as UTF-8 raw text with the repository helper before publishing
it at a stable, preferably content-addressed HTTPS URI. The normalized text
must contain 1–16,000 characters; empty/whitespace-only and 16,001-character
submissions fail before a bounty is locked:

```bash
.venv/bin/python scripts/prepare_evidence.py \
  --uri https://gateway.example/ipfs/<cid>/evidence.txt \
  --file evidence.txt \
  --write-canonical canonical-evidence.txt
```
