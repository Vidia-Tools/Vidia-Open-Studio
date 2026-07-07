# Vidia Open Studio - Deployment Guide

How to deploy your own hosted instance: Cloudflare Pages (frontend), a
Cloudflare Worker (backend), and a RunPod serverless endpoint (GPU worker).
This reflects the tested deployment contract of the maintainer's live stack.

Local mode (Docker Compose or bare metal, no cloud accounts) is covered in
`worker/README.md` and needs none of this. Note the local app server binds
`127.0.0.1` by default; pass `--host` to `app_server.py` to override.

## Architecture

- **Frontend**: Vite SPA deployed to Cloudflare Pages, git-connected. Build
  config comes from the committed `frontend/.env.production`.
- **Backend**: Cloudflare Worker (`backend/`), itty-router + Durable Objects
  (auth, logs, payments, run tracking, websockets, history) + a KV namespace
  (disposable-email blocklist + rate-limit counters) + two R2 buckets
  (`imports`, `exports`). Git-connected Workers Builds deploy on push.
- **GPU worker**: RunPod serverless endpoint running `worker/Dockerfile`.
  Self-updating: at every cold start the pod clones this repo's `main`
  (`worker/updater.sh` -> `bootstrap.sh` -> `worker/src/start.sh`), refreshing
  boot scripts, `worker/src/`, and `workflows/`. `start.sh` also clones the
  separate custom-node repo (Vidia-Open-Studio-Nodes) onto the network volume.
  Net effect: pushing to `main` deploys worker code instantly, no image rebuild.
- **Nodes repo**: `Vidia-Open-Studio-Nodes` (separate repo), cloned by
  `worker/src/start.sh` at boot (`VIDIA_NODE_REPO_URL` / `VIDIA_NODE_REPO_REF`).

## 1. Frontend (Cloudflare Pages)

Connect the repo to Pages (git-connected build):
- Build command: `npm run build` in `frontend/`
- Build output directory: `dist`

Configuration is the committed `frontend/.env.production` file. Replace its
values with your own before deploying (they are public, not secrets):

```
VITE_API_BASE=<your Worker URL>
VITE_TURNSTILE_SITE_KEY_LOGIN=<your Turnstile site key>
VITE_GA_MEASUREMENT_ID=<your GA4 id, or delete this line>
```

Important: Vite variables set in the Pages dashboard are NOT reliably baked
into git-connected builds. The committed `.env.production` file is the
supported mechanism. For local mode, delete the file (or use
`frontend/.env.local` with `VITE_API_BASE=http://127.0.0.1:8189`).

Other optional VITE_* switches are documented in the frontend section of
`.env.example`.

## 2. Backend (Cloudflare Worker)

The Worker deploys git-connected from `backend/` (Workers Builds runs
`npx wrangler deploy`). Alternatively `cd backend && wrangler deploy`.

### wrangler.toml vars to edit

Edit `backend/wrangler.toml` (see `backend/wrangler.toml.example`):
- `name`, `account_id`
- `ALLOWED_ORIGINS` (comma-separated; include your Pages origins)
- `ADMIN_EMAIL`, `APP_BASE_URL`, `EMAIL_FROM`
- `ACCOUNT_ID` (same Cloudflare account id, used for S3 presign)
- `IMPORTS_BUCKET_NAME` / `EXPORTS_BUCKET_NAME` and their `*_DOMAIN` values
- `RUNPOD_BASIC_ENDPOINT_ID` / `RUNPOD_STANDARD_ENDPOINT_ID` /
  `RUNPOD_PRO_ENDPOINT_ID` (your RunPod endpoint id; may all be the same)
- `VIDIA_PAYMENTS_ENABLED=false` (payments are decorative in v1),
  `STRIPE_PRICE_ID`, `CHECKOUT_RETURN_URL`

Bindings (Durable Objects, KV namespace, R2 buckets) also live in
`wrangler.toml`, not in env vars. Create the KV namespace
(`wrangler kv namespace create DISPOSABLE_EMAIL_DOMAINS`) and put its id in the
`kv_namespaces` block; the Durable Object classes migrate on first deploy.

### Required secrets

Set via `wrangler secret put <NAME>` in `backend/` (or run `./setup.sh` with a
filled root `.env`):

| Secret | Purpose |
|--------|---------|
| `JWT_SECRET` | Session token signing (long random string) |
| `RUNPOD_API_KEY` | Starts serverless jobs (RunPod console) |
| `RUNPOD_CALLBACK_SECRET` | Authenticates worker -> backend callbacks; MUST match the RunPod endpoint env var of the same name |
| `EMAIL_API_KEY` | Resend transactional email |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token for presigned upload URLs |
| `TURNSTILE_SECRET_KEY_LOGIN` | Turnstile login widget |
| `TURNSTILE_SECRET_KEY_NEWSLETTER` | Turnstile newsletter widget |
| `MAILERLITE_API_KEY` | Newsletter / user sync (optional) |

## 3. R2 buckets

Create the two buckets:

```bash
wrangler r2 bucket create imports
wrangler r2 bucket create exports
```

Give each a public custom domain (the `*_BUCKET_DOMAIN` vars). The exports
bucket serves finished videos under a public prefix; set an object-lifecycle
expiry rule on it for retention (pure R2 config, no backend code involved).

### Required CORS rules

Browser uploads presign directly against R2, so BOTH buckets need CORS rules
for your Pages origins or uploads fail:

```json
[
  {
    "AllowedOrigins": ["https://<your-pages-site>.pages.dev"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD", "DELETE"],
    "AllowedHeaders": [
      "Content-Type", "Content-Length", "Authorization",
      "x-amz-date", "x-amz-content-sha256"
    ],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

## 4. RunPod serverless endpoint

1. Build and push the worker image: `IMAGE=<registry>/vidia-worker:<tag> ./worker/deploy.sh`
2. Create a serverless endpoint pointing at the image, attach a network volume
   populated with models and nodes (see `worker/README.md` and
   `worker/scripts/fetch_models.py`).
3. Set **Execution Timeout** to `3600` seconds (long video generations).
4. Set endpoint env vars (worker block of `.env.example`):
   - `BACKEND_BASE` and `VIDIA_BACKEND_URL`: your Worker URL. MUST include the
     `https://` prefix; a bare hostname breaks all callbacks.
   - `RUNPOD_CALLBACK_SECRET`: MUST match the Worker secret of the same name.
   - `EXPORTS_DOMAIN`, `S3_PUBLIC_URL_PREFIX`, `S3_ENDPOINT_URL`,
     `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET_NAME=exports`,
     `S3_REGION_NAME=auto`
   - `DEPLOYMENT_MODE=serverless`
5. Put the endpoint id into `backend/wrangler.toml` (`RUNPOD_*_ENDPOINT_ID`)
   and redeploy the Worker.

### Cold-start self-update model

At every cold start the pod clones this repo's `main` and refreshes its boot
scripts, `worker/src/`, and `workflows/` (`updater.sh` -> `bootstrap.sh` ->
`start.sh`), then clones the Nodes repo. Push-to-main therefore deploys worker
code instantly on the next cold start. If a clone fails, the image-baked copies
are used.

For production stability, pin `VIDIA_DOCKER_REPO_REF` and `VIDIA_NODE_REPO_REF`
to a tag or commit SHA in the endpoint env instead of tracking `main`. Forks
set `VIDIA_DOCKER_REPO_URL` / `VIDIA_NODE_REPO_URL` to their own repos; private
forks can set `VIDIA_DOCKER_DEPLOY_KEY` / `VIDIA_NODE_DEPLOY_KEY` to an SSH key
path on the persistent volume.

## 5. Turnstile

Create a Turnstile widget in the Cloudflare dashboard for your Pages domain.
The public site key goes in `frontend/.env.production`
(`VITE_TURNSTILE_SITE_KEY_LOGIN`); the secret key goes in Worker secrets
(`TURNSTILE_SECRET_KEY_LOGIN`, and `TURNSTILE_SECRET_KEY_NEWSLETTER` for the
newsletter widget if used).

## 6. Local mode

No cloud accounts needed. See `worker/README.md` for Docker Compose and
bare-metal setup, and `setup.sh` for secret distribution when moving to hosted
mode later. The local app server (`worker/src/app_server.py`) binds
`127.0.0.1` by default; pass `--host 0.0.0.0` only if you need LAN access
(the Docker Compose setup does this internally for port mapping).

## Verification

- `node scripts/release-check.mjs` guards the release set against secret leaks.
- Smoke-test payloads live in `worker/test-payloads/` (`minimal.json` first,
  then `full-feature.json` with real file URLs).
- Known limitations and deferred items: see `KNOWN_ISSUES.md`.
