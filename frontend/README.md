# ContentBounty v2 frontend

Vue 3, Vite, TypeScript, and `genlayer-js` 1.1.8 client for the v2 Intelligent
Contract.

## Safety model

- Uses an injected external wallet only.
- Never generates, imports, displays, or persists a private key.
- Parses GEN amounts as exact 18-decimal integers.
- Persists transaction identifiers and observed lifecycle states so evidence
  survives reload.
- Separates `SUBMITTED`, `ACCEPTED`, and `FINALIZED`; it does not treat an
  accepted evaluation as a confirmed payout.
- Reads v2 bounties and submissions through bounded paginated views.

## Run

```bash
npm install
cp .env.example .env
npm run dev
```

Production verification:

```bash
npm run build
```

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_CONTRACT_ADDRESS` | yes | Deployed ContentBounty v2 address |
| `VITE_GENLAYER_RPC_URL` | no | Override the Studionet RPC URL |
| `VITE_GENLAYER_NETWORK_LABEL` | no | Display label for the configured network |
| `VITE_GENLAYER_EXPLORER_URL` | no | Override explorer links |

The historical v0.2 address is incompatible with this frontend.
