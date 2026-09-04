# ContentBounty v2.2 frontend

Vue 3, Vite, TypeScript, and `genlayer-js` 1.1.8 client for the current v2.2
Intelligent Contract source.

The tracked environment files now point to the current Bradbury v2.2
deployment at `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8` (Bradbury chain 4221,
source commit `2e35764`, SHA `b5e89cf03ae7f79d1c6d0b0c45ee3b8e567fe4fb7f57fea0b370e165a33df36a`,
deployment tx `0x7b5ef343bffa78cc0f735ce0c7e41488b288a9bbe4c72d417a36f70349f18532` FINALIZED/AGREE).
The historical v2.1.1 address `0x0d997CF8E3E8b4b7166ED2e0713F7F6927Ba4c04` is archived.
Historical proof remains at `docs/proofs/bradbury-persistent-proof-v1.json` (v2.1.1 only);
v2.2 deployment proof is at `docs/proofs/bradbury-v22-deployment-proof.json`.
`AUDIT_REPORT.md` is an archival audit of the historical pre-v2 commit and its
Studionet address; it is not an advertisement of the current frontend state.

## Safety model

- Uses an injected external wallet only.
- Never generates, imports, displays, or persists a private key.
- Parses GEN amounts as exact 18-decimal integers.
- Accepts only the evidence URI; submission consensus derives the canonical
  GenLayer-rendered SHA-256 instead of trusting a browser-calculated digest.
- Reads the creator-specific claim tag before submission and warns that an
  immutable post cannot be repaired if the tag was omitted before publishing.
- Mirrors the contract source-host allowlist for immediate feedback while
  leaving the contract as the authoritative URL validator.
- Treats `APPROVED_PENDING` as unpaid, displays the challenge deadline and
  challenge state, and exposes separate review, finalization, timeout, and
  creator claim actions.
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
VITE_GENLAYER_NETWORK=testnetBradbury \
VITE_CONTRACT_ADDRESS=0x7F73e10059D0C669c2d2fe3FA716312587aC87c8 \
npm run build
```

This command proves that the current source type-checks and bundles against the
tracked v2.2 deployment (delayed settlement, claim-tag `cb-` + 20 hex, 48h challenge window,
only `claim_reward` moves creator reward).

Repository-level production verification additionally runs
`npm run verify:frontend-bundle`, which fails if generated assets contain the
historical v0.2 address. The Vite production configuration also rejects that
address before bundling.

## Environment

| Variable | Required | Purpose |
|---|---:|---|
| `VITE_CONTRACT_ADDRESS` | yes | Current deployment address `0x7F73e10059D0C669c2d2fe3FA716312587aC87c8` (Bradbury 4221, v2.2). Historical `0x0d997...` is archived. |
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

The historical v0.2 address and currently configured v2.1.1 address are both
incompatible with the new v2.2 method surface. Production mode fails closed if
the address is missing or the network is not testnetBradbury, but address-format
validation alone cannot prove contract-version compatibility.

Before publishing, select the bounty and wallet, copy the displayed `cb-...`
claim tag, and include that exact token in the source. For immutable publishing
surfaces this must happen before publication; this version has no
post-publication or same-submission repair path. The source must use HTTPS and one
of the contract-supported families: GitHub, raw GitHub, GitHub Gists, Mirror,
HackMD, Medium, or Substack (including valid Substack subdomains). The
normalized rendered text must contain 1-16,000 characters.

The repository helper can reproduce the text normalization for a local file,
but the contract render remains authoritative:

```bash
.venv/bin/python scripts/prepare_evidence.py \
  --uri https://raw.githubusercontent.com/owner/repository/main/evidence.txt \
  --file evidence.txt \
  --write-canonical canonical-evidence.txt
```

## Delayed settlement flow

An `APPROVE` evaluation result is displayed as `APPROVED_PENDING`, not paid.
The local countdown is informational; the GenVM transaction timestamp remains
authoritative. Before the deadline, any eligible non-creator may open one
challenge with a fixed reason, allowlisted HTTPS evidence, and the exact bond
returned by `get_challenge_bond`.

`review_challenge` only records an agreed proposal. `finalize_challenge` applies
an agreed uphold or dismiss result, while `timeout_challenge` clears an eligible
inconclusive or elapsed challenge. The frontend shows these permissionless
actions from the bounty detail and links creator activity records back to that
action surface. Only the creator's separate `claim_reward` transaction releases
the bounty reward after the original challenge deadline and with no active
challenge.
