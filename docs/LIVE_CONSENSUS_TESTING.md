# Live consensus verification

This suite deploys the current contract source and exercises real leader plus
validator consensus. Persistent settlement proof is restricted to
`testnetBradbury`. Studionet is available only as an explicitly named
smoke/demo mode: its balances and transfers are simulated and cannot satisfy
the payout-proof gate. The authoritative Bradbury v2.1.1 deployment is
finalized at `0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04`, and the persistent
proof is complete. The suite is
intentionally excluded from CI because it spends funds, calls external
evidence services, and creates persistent network state.

`AUDIT_REPORT.md` is retained unchanged as an archival audit of historical
commit `a09fe6a`; it does not describe the current deployed v2.1.1 contract or
the completed proof artifact.

## Completed Bradbury proof

The stable public evidence copy is
[`docs/proofs/bradbury-persistent-proof-v1.json`](proofs/bradbury-persistent-proof-v1.json).
The raw resumable artifact is `/tmp/contentbounty-live-consensus-proof.json`
with mode `0600`; it is never committed. The runner recorded committed
provenance `936864e822c754eaf2bf13432ef38e6a2a7c3d3c` with `dirty=false`,
separate from deployed source commit
`c5c64c1ef007fa9b06d96aaa9255fe7322e6d356` and source SHA-256
`d19d74e60d5c869688690c2742bb4cd3875daafabb45ca0bfc994fbefd786ed7`.

Completion checks are all true: finalized deployment, exact adversarial
rejection commitment, clear rejection, mutation `INCONCLUSIVE/DIGEST_MISMATCH`,
clear approval, and the exact persistent creator payout delta of
`1000000000000000` wei (`1999059535278303440` before to
`2000059535278303440` after). The public proof includes explorer links for the
deployment and every scenario transaction. The public SDK does not expose a
supported fabricated-leader disagreement harness; this limitation is recorded
in the proof rather than treated as a completion gate.

Final scenario transactions:

| Scenario | Post | Submission | Evaluation |
|---|---|---|---|
| Clear rejection | [`0x8d8d…4d5d`](https://explorer-bradbury.genlayer.com/tx/0x8d8dafeed5f5da06e52a9966f05249b0abe9362c5cf4a08bd063118a98aa4d5d) | [`0xaf1e…c4d4`](https://explorer-bradbury.genlayer.com/tx/0xaf1ebf600fb35d451d6ac795de1ab549c6b73b2b1863d200db28c1e18db5c4d4) | [`0xd3d6…7df33`](https://explorer-bradbury.genlayer.com/tx/0xd3d6cafc07bbe23725fc742dab66e6d43d0b7c2ba36c7d19082cb7ad5657df33) |
| Mutable evidence | [`0xd1fd…5243`](https://explorer-bradbury.genlayer.com/tx/0xd1fdcf41b6df3d076c1d4bf83c0ef663dc123d8b7b7a2caac800884569225243) | [`0xfd32…a842`](https://explorer-bradbury.genlayer.com/tx/0xfd320a47cd0cea98008ff91f14334d1d7242e1da13b1fe59a926b07a659ea842) | [`0x0708…b1aa`](https://explorer-bradbury.genlayer.com/tx/0x0708c8cb1c4f287292844b8e4f10ae27f4f45963176692d9031d8dbd3ef0b1aa) |
| Clear approval and payout | [`0xc3ed…9071`](https://explorer-bradbury.genlayer.com/tx/0xc3ed971df471998cb0bdb1de9414f6c2148d98b188174bdc07cb67acf6be9071) | [`0x13df…ce5c`](https://explorer-bradbury.genlayer.com/tx/0x13dfa13fbc51d842426999d030fc5608b4662565e60223cb0697f91aa4ebce5c) | [`0x5eca…c227`](https://explorer-bradbury.genlayer.com/tx/0x5eca4c1ab3d15e7586aca3b32aabf035beba9917c310ad78da442b239ac1c227) |

The deployment is finalized in
[`0x6834…4d93`](https://explorer-bradbury.genlayer.com/tx/0x6834512f8a6ad9bab36c9954477d9911617c6a097f6eaff33315bfddc8384d93).
The exact creator payout was `1999059535278303440` wei before and
`2000059535278303440` wei after, a delta of exactly
`1000000000000000` wei. A read-only verifier rechecked these ten lifecycle
transactions and the three on-chain submissions after the proof run.

For an independent reviewer with the raw artifact available:

```bash
npm run verify:live-proof
npm run export:live-proof -- --check
npm run verify:live-proof:online
```

## Required setup

- a reachable selected network; persistent mode requires `testnetBradbury`;
- funded deployer and creator accounts;
- stable UTF-8 raw-text approval and rejection evidence URLs;
- a mutable raw-text URL plus an HTTPS webhook that changes or disables it after
  submission finalizes;
- explicit authorization to deploy and spend funds.

The approval fixture must clearly contain `CONTENT BOUNTY LIVE PASS` and
`https://docs.genlayer.com/`. The rejection URI must host the exact canonical
bytes from `tests/fixtures/live/adversarial_rejection_v1.txt`. Its committed
manifest is `tests/fixtures/live/adversarial_rejection_v1.json`, with normalized
SHA-256
`efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537`
and 1,092 characters. It clearly fails the live rubric while carrying closing
delimiter attacks, instruction override text, fake JSON/output directives,
role impersonation, propagated observation injection, and a malicious rubric
override.

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

### Resuming a finalized deployment

If deployment has already finalized, supply both recovery values to bypass
deployment submission and resume at the clear-rejection scenario:

```bash
export LIVE_EXISTING_CONTRACT_ADDRESS=0x...
export LIVE_EXISTING_DEPLOYMENT_TRANSACTION=0x...
npm run test:live
```

The runner reads the official Bradbury consensus-data contract through
genlayer-js, and fails closed unless the recovered transaction is `FINALIZED`,
has consensus result `AGREE`, and has execution result `FINISHED_WITH_RETURN`.
It decodes the deployment calldata and requires both the supplied contract
address and the SHA-256 of the current `contracts/content_bounty.py` to match.
The recovered deployment metadata and lifecycle observation are atomically
checkpointed into the proof artifact before any scenario transaction. Recovery
values must be supplied together; a mismatch never triggers a new deployment.

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
passes. In particular, the runner compares the rejection submission's on-chain
`evidence_sha256` with the committed manifest before setting
`adversarialRejectionVerified`. The proof records fixture version, expected
hash, observed on-chain hash, and verification result; a hosted-content mismatch
checkpoints failure and exits nonzero.

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

The runner resumes exact stored bounty and submission IDs and validates their
transaction identity, title, creator, poster, reward, rubric, configured
evidence URI, status, and deadlines. It never reuses a bounty merely because a
title matches. After recovering or finalizing a post, it reads the exact bounty
and current Bradbury chain timestamp again before any new `submit_content`
write. A closed submission window is cancelled while the bounty is `OPEN`, or
expired after evaluation grace, with the exact closure transaction checkpointed
before a uniquely titled replacement is posted. Mutation is crash-safe:
`NOT_STARTED` is checkpointed before the webhook, then `PENDING` before POST and
`CONFIRMED` after a successful response. A Worker state of `mutated` without a
matching checkpoint, or `initial` after `CONFIRMED`, fails closed. Replacement
scenarios use four-hour submission and evaluation windows.

Replacement scenarios are checkpointed before posting, after each submitted
transaction hash, and immediately after recovering bounty/submission IDs.
Restarts first recover the unique exact-title bounty, exact
bounty/creator/evidence submission, and scenario-bound evaluation transaction;
label-only recovery must resolve to exactly one usable transaction. Expiration
or cancellation is also bound to the scenario's stored closure action and
transaction, including in replacement history, so a restart cannot repeat an
already-finalized closure. They do not submit a duplicate write. Deployment
provenance preserves the commit and SHA-256 recorded by the deployment-time
artifact, while runner commit and dirty state are recorded separately.
