#!/usr/bin/env bash
set -euo pipefail

export GENVM_VERSION="${GENVM_VERSION:-v0.2.16}"
export GENVM_SOURCE_MODE="${GENVM_SOURCE_MODE:-release}"
export GENVM_REPO="${GENVM_REPO:-genlayerlabs/genvm}"

exec .venv/bin/genvm-lint check contracts/content_bounty.py --json
