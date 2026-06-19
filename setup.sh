#!/usr/bin/env bash
# Vidia Open Studio - environment distributor (plan section 8.1).
# Reads the filled-in root .env and distributes values to each component via its
# native mechanism. Currently handles backend (Cloudflare Worker) secrets via
# `wrangler secret put`. ST1.1 / ST4 extend this for worker + frontend.
#
# Usage:  ./setup.sh
# Prereqs: a filled-in ./.env (copy from .env.example) and `wrangler` logged in.
# Non-secret backend config lives in backend/wrangler.toml, not here.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
BACKEND_DIR="$ROOT_DIR/backend"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi

# Load .env (export every assignment, ignoring comments/blank lines).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Backend secrets pushed via `wrangler secret put`. Add the env var name here when
# a new backend secret is introduced; non-secret config belongs in wrangler.toml.
BACKEND_SECRETS=(
  JWT_SECRET
  RUNPOD_API_KEY
  RUNPOD_CALLBACK_SECRET
  EMAIL_API_KEY
  MAILERLITE_API_KEY
  MAILERLITE_USERS_GROUP_ID
  MAILERLITE_NEWSLETTER_GROUP_ID
  TURNSTILE_SECRET_KEY_LOGIN
  TURNSTILE_SECRET_KEY_NEWSLETTER
  S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET
)

echo "Distributing backend secrets via wrangler (cwd: $BACKEND_DIR)..."
cd "$BACKEND_DIR"
for name in "${BACKEND_SECRETS[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    echo "  skip $name (empty in .env)"
    continue
  fi
  echo "  put  $name"
  printf '%s' "$value" | wrangler secret put "$name"
done

echo "Done. Non-secret backend config: edit backend/wrangler.toml (see wrangler.toml.example)."
