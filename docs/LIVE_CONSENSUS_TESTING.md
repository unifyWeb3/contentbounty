# Live consensus verification

This suite deploys the current contract source and exercises real leader plus
validator consensus. Persistent settlement proof is restricted to
`testnetBradbury`. Studionet is available only as an explicitly named
smoke/demo mode: its balances and transfers are simulated and cannot satisfy
the payout-proof gate. No deployment or live proof exists yet. The suite is
intentionally excluded from CI because it spends funds, calls external
evidence services, and creates persistent network state.

## Required setup

- a reachable selected network; persistent mode requires `testnetBradbury`;
- funded deployer and creator accounts;
- stable UTF-8 raw-text approval and rejection evidence URLs;
- a mutable raw-text URL plus an HTTPS webhook that changes or disables it after
  submission finalizes;
- explicit authorization to deploy and spend funds.

The approval fixture must clearly contain `CONTENT BOUNTY LIVE PASS` and
`https://docs.genlayer.com/`. The rejection fixture must clearly fail at least
one requirement and should include the prompt attacks covered by Direct Mode so
the network run also exercises a real configured model.

```bash
export LIVE_GENLAYER_NETWORK=testnetBradbury
export LIVE_PROOF_MODE=persistent
export LIVE_DEPLOYER_PRIVATE_KEY=0x...
export LIVE_CREATOR_PRIVATE_KEY=0x...
export LIVE_APPROVE_EVIDENCE_URI=https://...
export LIVE_REJECT_EVIDENCE_URI=https://...
export LIVE_MUTABLE_EVIDENCE_URI=https://...
export LIVE_MUTATION_WEBHOOK_URL=https://...
export LIVE_REWARD_WEI=1000000000000000
npm run test:live
```

The script requires an explicit `LIVE_GENLAYER_NETWORK` and
`LIVE_PROOF_MODE`. It safely classifies numeric/camelCase/snake_case receipts,
records every observed lifecycle state with timestamps, and accepts a
transaction that is already successfully `FINALIZED` when first observed. The
proof distinguishes a successful finalization observation from separate
`ACCEPTED` and `FINALIZED` observations. It creates a mode-0600 JSON proof file
before the first transaction and atomically checkpoints deployment metadata,
every lifecycle observation, each completed scenario, and terminal failures
(default: `/tmp/contentbounty-live-consensus-proof.json`). No private key is
written. `proofComplete` is true only when every persistent settlement check
passes.

For a non-persistent Studionet smoke run, use:

```bash
export LIVE_GENLAYER_NETWORK=studionet
export LIVE_PROOF_MODE=studionet-smoke
```

Its output marks `balancesSimulated: true` and
`persistentPayoutProofValid: false`, regardless of the observed simulated
delta.

Public SDK/testnet APIs currently provide no supported way to fabricate a
leader result while retaining real network validators. That scenario remains
blocked until GenLayer supplies or authorizes an appropriate validator harness;
the proof output records the limitation rather than claiming completion.
