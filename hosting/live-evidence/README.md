# Bradbury live evidence worker

This Cloudflare Worker serves the three raw-text evidence routes required by
the persistent Bradbury runner and stores mutation state in a SQLite-backed
Durable Object.

It does not contain a deployed URL, account identifier, credential, or mutation
token. Deployment requires an authenticated Cloudflare account with Workers,
workers.dev, static assets, and Durable Objects enabled.

## Routes

| Route | Behavior |
|---|---|
| `GET /approve.txt` | Exact bytes of `tests/fixtures/live/approval_v1.txt` |
| `GET /reject.txt` | Exact bytes of `tests/fixtures/live/adversarial_rejection_v1.txt` |
| `GET /mutable.txt` | Initial bytes until mutation, then permanently changed bytes |
| `POST /mutate?token=...` | Validates `{"uri":"<origin>/mutable.txt"}` and durably mutates state |
| `GET /healthz` | Fixture identity plus current durable mutation state |

The webhook token is a Cloudflare secret. Never commit it, print it, or add it
to proof artifacts. The runner's local `LIVE_MUTATION_WEBHOOK_URL` may contain
the token query parameter and must remain only in the ignored mode-600 root
`.env`.

## Required external deployment action

From this directory, authenticate the Cloudflare account that will own the
public worker:

```bash
npx --yes wrangler@4.120.0 login
npx --yes wrangler@4.120.0 secret put MUTATION_TOKEN
npx --yes wrangler@4.120.0 deploy
```

Enter a strong random token only at Wrangler's secret prompt. Record the actual
HTTPS workers.dev origin printed by the successful deploy; do not substitute a
guessed or placeholder URL.

Before editing `.env`, verify the deployed origin from the repository root.
Do not call the mutation webhook during this preflight:

```bash
curl -fsS "$ACTUAL_WORKER_ORIGIN/healthz"
curl -fsS "$ACTUAL_WORKER_ORIGIN/approve.txt" -o /tmp/contentbounty-approve.txt
curl -fsS "$ACTUAL_WORKER_ORIGIN/reject.txt" -o /tmp/contentbounty-reject.txt
curl -fsS "$ACTUAL_WORKER_ORIGIN/mutable.txt" -o /tmp/contentbounty-mutable.txt

.venv/bin/python scripts/prepare_evidence.py \
  --uri "$ACTUAL_WORKER_ORIGIN/reject.txt" \
  --file /tmp/contentbounty-reject.txt
```

The rejection result must report SHA-256
`efa694452cf28565eb7b59ecf48bc684558dbc45c0eb09de43b4261ed70bf537`
and 1,092 characters. Approval output must contain both
`CONTENT BOUNTY LIVE PASS` and `https://docs.genlayer.com/`. Health must report
`mutableState` as `initial`.

Using a local editor that does not echo values, set the four root `.env`
variables to the actual deployed routes. The mutation webhook value is the
actual `/mutate` URL with its secret `token` query parameter. Keep `.env` mode
600 and Git-ignored. Only after all four HTTPS checks pass should the root live
runner be started.
