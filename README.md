# Vidia Open Studio

Open-source AI video generation studio. A Vite SPA frontend, a Cloudflare
Worker backend, and a ComfyUI-based GPU worker that runs on RunPod serverless
or entirely on your own machine.

## Two ways to run it

### Local mode (no cloud accounts)

Run the GPU worker and app server on your own hardware with Docker Compose or
bare metal. See [`worker/README.md`](worker/README.md). The app server binds
`127.0.0.1` by default; pass `--host` to `app_server.py` to expose it. Point
the frontend at it with `VITE_API_BASE=http://127.0.0.1:8189` in
`frontend/.env.local` (and delete or override `frontend/.env.production`).

### Hosted mode (Cloudflare + RunPod)

Cloudflare Pages serves the frontend, a Cloudflare Worker handles auth, job
dispatch, websockets, and storage (Durable Objects + KV + R2), and a RunPod
serverless endpoint runs generations. Full setup: [`DEPLOY.md`](DEPLOY.md).

Frontend configuration for hosted deploys lives in the committed
`frontend/.env.production` (public values only: Worker URL, Turnstile site
key, optional GA id). Forks replace those values or delete the file;
dashboard-set Vite vars are not reliably baked into git-connected Pages
builds.

## Repository layout

- `frontend/` - Vite SPA
- `backend/` - Cloudflare Worker (itty-router + Durable Objects)
- `worker/` - GPU worker: Dockerfile, boot scripts, serverless handler,
  local app server, model/node manifest
- `workflows/` - ComfyUI workflow JSON, pulled by the worker at boot
- `controls/` - UI control manifests
- `scripts/release-check.mjs` - release safety guard (secret scan)

Custom ComfyUI nodes live in the separate Vidia-Open-Studio-Nodes repo,
cloned by the worker at boot.

## Configuration

`.env.example` is the canonical list of every environment variable across all
three components. Backend secrets go in via `wrangler secret put` (or
`./setup.sh`); non-secret backend config lives in `backend/wrangler.toml`.

## Known limitations

See [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for deferred items and current
limitations (best-effort rate limiting, decorative payments, local-only
Build Mode, and others).

## License

Vidia Open Studio is licensed under the
[Functional Source License, Version 1.1, Apache 2.0 Future License](LICENSE.md)
(FSL-1.1-Apache-2.0). You are free to use, modify, and self-host it for any
Permitted Purpose. Each release automatically converts to Apache 2.0 two
years after its publication. For commercial licensing inquiries, contact the
maintainer.
