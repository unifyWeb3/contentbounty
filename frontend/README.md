# ContentBounty — frontend

Vue 3 + Vite + TypeScript single-page app for ContentBounty, talking to the
GenLayer Intelligent Contract via `genlayer-js`.

See the [root README](../README.md) for the full project overview, architecture,
and the evaluation/consensus design.

## Quick start

```bash
npm install
cp .env.example .env      # sets VITE_CONTRACT_ADDRESS
npm run dev               # http://localhost:5173
```

| Variable | Purpose |
|---|---|
| `VITE_CONTRACT_ADDRESS` | Deployed ContentBounty contract address (required) |
| `VITE_ADMIN_ADDRESS` | Optional address that sees the read-only Admin dashboard |
