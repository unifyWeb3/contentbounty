# ContentBounty v2 frontend

Vue 3, Vite, TypeScript, and `genlayer-js` 1.1.8 client for the v2 Intelligent
Contract.

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

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_CONTRACT_ADDRESS` | yes | Deployed ContentBounty v2 address |
| `VITE_GENLAYER_NETWORK` | no | `studionet` (default), `testnetAsimov`, or `testnetBradbury` |

The selector chooses the complete official `genlayer-js` chain object,
including its RPC, explorer, chain ID, and consensus contract configuration.
Unsupported and differently-cased values fail the application build/startup.
Asimov and Bradbury currently share chain ID `4221`; an injected wallet cannot
distinguish them by chain ID alone, so its configured RPC for chain `4221` must
match the selected network shown in the application.

The historical v0.2 address is incompatible with this frontend.

Prepare evidence as UTF-8 raw text with the repository helper before publishing
it at a stable, preferably content-addressed HTTPS URI:

```bash
.venv/bin/python scripts/prepare_evidence.py \
  --uri https://gateway.example/ipfs/<cid>/evidence.txt \
  --file evidence.txt \
  --write-canonical canonical-evidence.txt
```
