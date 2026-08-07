# ContentBounty v2 implementation log

## 2026-08-06 — audit intake and toolchain selection

### Decisions and assumptions

- Read `AUDIT_REPORT.md` completely, including the implementation-session
  handoff. The file remains unchanged.
- Treat v0.2 and its Studionet address as historical. v2 intentionally breaks
  storage/API compatibility.
- Do not modify the frontend until contract lint and direct/adversarial tests
  pass.
- Adopt the lifecycle and equivalence design in
  `docs/CONTENT_BOUNTY_V2_SPEC.md`.
- Use first consensus-approved submission wins, permissionless evaluation,
  cancellation only before the first submission, and permissionless expiry
  after an explicit evaluation grace period.
- Require an HTTPS evidence URI plus normalized-rendered-text SHA-256. This
  detects mutation but does not guarantee availability; content-addressed HTTPS
  gateways are preferred.
- Do not add contract events yet: the current official Intelligent Contract
  documentation exposes transaction execution events to clients but does not
  document a stable user-defined event declaration API. Store bounded provenance
  in contract state and use transaction hashes externally.

### Official resources inspected

- `AUDIT_REPORT.md` official-source list.
- Current `genlayerlabs/genlayer-project-boilerplate` main at commit
  `e685f1f12c4c357787d48390692a654baf576f03` (2026-06-10).
- Current official full documentation downloaded from
  `https://docs.genlayer.com/full-documentation.txt` on 2026-08-06.
- Relevant current guidance: custom `run_nondet_unsafe`, substantive independent
  validator verification, Direct Mode `run_validator()`, deterministic
  transaction timestamps, finalized value transfers, bounded persistent storage,
  and prompt-injection hardening.

### GenLayer versions selected

- Python: 3.12.3.
- `genlayer-py`: tag `v0.18`, commit
  `a3dc35e04898e3889cbfa855bcaf7d2664675b8f`.
- `genlayer-test`: tag `v0.29`, commit
  `9c09578b143905471fb0657dd53bdaf18da8e35f`; installed package version
  `0.29.2`.
- `genvm-linter`: main commit
  `fa4a4d4536b28fdc2730e13a983ba01b69ccc6f3`; installed package version
  `0.10.0`.
- Direct Mode/semantic SDK source: official GenVM `v0.2.16`, commit
  `387e1a66e920cb2dfadcdce40ab2d28da02efd1e`.
- Official boilerplate JavaScript SDK reference: `genlayer-js` `^1.1.8`.
  Frontend migration has not begun.

### Commands and results

```text
wc -l AUDIT_REPORT.md
=> 728 lines

git status --short --branch
=> clean feat/contentbounty-v2 branch before implementation

git clone --depth 1 https://github.com/genlayerlabs/genlayer-project-boilerplate.git ...
=> PASS; inspected commit e685f1f12c4c357787d48390692a654baf576f03

curl -L --max-time 60 -sS https://docs.genlayer.com/full-documentation.txt
=> PASS; 19,846 lines downloaded and relevant APIs reviewed

python3 -m venv .venv
=> PASS

.venv/bin/pip install -r <official-boilerplate>/requirements.txt
=> PASS; installed genlayer-py 0.18.0, genlayer-test 0.29.2,
genvm-linter 0.10.0

.venv/bin/python -m py_compile contracts/content_bounty.py
=> PASS

.venv/bin/genvm-lint lint contracts/content_bounty.py
=> PASS; 3 AST safety checks

GENVM_SOURCE_MODE=prebuilt GENVM_PREBUILT_DIR=/tmp/contentbounty-genvm-prebuilt-v0.2.16 .venv/bin/genvm-lint check contracts/content_bounty.py --json
=> PASS; lint {"ok":true,"passed":3}, semantic schema validation
{"ok":true,"contract":"ContentBounty","methods":9,"view_methods":4,"write_methods":5,"ctor_params":0}.
The prebuilt source contains the official GenVM v0.2.16 checkout at
387e1a66e920cb2dfadcdce40ab2d28da02efd1e; it avoids downloading the 310 MB
all-runners archive while using the linter's supported prebuilt layout.

GENVM_PY_STD_SOURCE=/tmp/contentbounty-genvm-sparse.PYI8ug/genvm/runners/genlayer-py-std .venv/bin/pytest tests/direct -v
=> PASS; 16 passed in 1.62s. The source checkout is the same official GenVM
v0.2.16 commit noted above. Without this local-only override, genlayer-test
uses its normal versioned runner cache.

git diff --check
=> PASS
```

### Remaining blockers

- Contract architecture, equivalence spec, lint setup, and adversarial Direct
  Mode tests are complete and green.
- Add a smaller Studio/localnet integration matrix and run it when an endpoint
  is available.
- Studio/localnet integration, persistent testnet deployment, finality proof,
  frontend rebuild, and frontend tests are later stages.

### Deployments

| Network | Contract address | Deployment transaction | Source commit | Status |
|---|---|---|---|---|
| Studionet (historical v0.2) | `0xFf546d6B1CD45d2859a705a7FA181807670B9015` | Not verified in this session | `a09fe6a` lineage | Historical only |
| v2 | Not deployed | Not deployed | `015ba57` | Contract gate passed; deployment pending |

## Contract milestone status

- [x] Lifecycle/equivalence specification written.
- [x] Bounded escrow, evidence digest, deadlines, retries, three-way result,
  first-winner settlement, expiry/refund, and paginated reads implemented.
- [x] Shape-only validator removed; validators independently render, hash,
  extract, judge, and compare payout-controlling fields.
- [x] `genvm-lint lint` and full `genvm-lint check` pass.
- [x] 16 adversarial Direct Mode tests pass.
- [x] Contract milestone committed as `015ba57`.
- [ ] Begin frontend rebuild as the next stage.

## 2026-08-07 — final contract gate rerun

```text
npm run lint:contract
=> PASS; 3 checks

GENVM_PY_STD_SOURCE=<official GenVM v0.2.16 source> npm run test:contract -- --quiet
=> PASS; 16 passed in 1.81s

git diff --check
=> PASS

git diff --quiet -- AUDIT_REPORT.md
=> PASS; AUDIT_REPORT.md remains unmodified

git commit -m "feat(contract): rebuild ContentBounty v2 adjudication"
=> PASS; milestone commit 015ba57
```
