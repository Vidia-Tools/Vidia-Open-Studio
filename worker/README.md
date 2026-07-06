# Worker (GPU handler)

Usage notes only. Full project documentation lives in the root README.

The worker runs the pipeline engine (`src/pipeline/`) against a ComfyUI
instance. `VIDIA_MODE` selects the wrapper:

| VIDIA_MODE | Entrypoint | Output stage |
|------------|-----------------|--------------------------------------|
| `runpod` (default) | `rp_handler.py` (RunPod serverless) | `workflows/output_saver.json` (R2 upload + backend notify) |
| `local` | `app_server.py` (thin HTTP server) | `workflows/output_saver_local.json` (h264 mp4 to ComfyUI output dir) |

## Local mode with Docker Compose

```bash
cp ../.env.example ../.env   # fill in values (most are optional for local mode)
docker compose up
```

Requires Docker with the NVIDIA Container Toolkit. ComfyUI is exposed on
`:8188`, the app server on `:8189`. Models go in `worker/models-volume/`
(populate with `scripts/fetch_models.py`).

## Local mode against your own ComfyUI (bare metal)

If you already run ComfyUI, skip Docker entirely:

```bash
cd worker/src
VIDIA_MODE=local python app_server.py --comfy http://127.0.0.1:8188 --port 8189
```

The server binds to `127.0.0.1` by default. Pass `--host 0.0.0.0` to expose it
on all interfaces (Docker does this internally for port mapping). Warning: the
unauthenticated Build Mode endpoints (`/build/*`) write config files into the
repo, so only expose the server on networks you trust.

## Local API

```bash
# Start a generation (section-3 params payload)
curl -X POST http://127.0.0.1:8189/generate \
  -H "Content-Type: application/json" \
  -d '{"client_id": "gen_123", "params": {"method": "forge", "prompt": "...",
       "features": {}, "files": {"in_video": "https://..."}}}'

# Stream stage progress (Server-Sent Events)
curl -N "http://127.0.0.1:8189/progress?id=gen_123"
```

`POST /generate` blocks until the pipeline finishes and returns the output
file path. `/progress` relays the same stage events RunPod mode emits
(`stage_start`, `executing`, `progress`, `executed`, `stage_complete`,
`error`), each tagged with `stageName` / `stageIndex` / `stageTotal`.

## RunPod mode

Build and push the image, point a RunPod serverless endpoint at it, set the
worker env vars from the root `.env.example` (BACKEND_BASE,
RUNPOD_CALLBACK_SECRET, S3_*, ...). `VIDIA_MODE` defaults to `runpod`.

## Image contents and self-update boot chain

The image bakes ComfyUI core (pinned to **v0.25.1** via a build-time git clone,
no comfy-cli), python deps, runtime patches, workflows, the pipeline engine, and
embedded fallback copies of the boot scripts. There is **no `vendor/` directory**:
the vidia-open-studio-node is cloned at runtime.

At boot the container runs a three-link self-update chain:

1. `updater.sh` (CMD) clones the monorepo and refreshes `bootstrap.sh` + `src/`,
   then execs `bootstrap.sh`.
2. `bootstrap.sh` clones the monorepo and refreshes `src/` (start.sh,
   rp_handler.py, app_server.py, pipeline/), then execs `start.sh`.
3. `start.sh` clones `vidia-open-studio-node` into the custom-nodes volume and
   applies the runtime hotfixes/patches before launching ComfyUI.

Every URL and ref is env-configurable so self-hosters can point at their own
forks with no code edits. If a clone fails (no key, no network), the chain falls
back to the scripts baked into the image. Defaults point at the public codeberg
repos on `main` (no tag pinning, so a new image or node version rolls out without
a rebuild). See the self-update vars in `../.env.example`:

| Env var | Default | Purpose |
|---------|---------|---------|
| `VIDIA_DOCKER_REPO_URL` | `https://codeberg.org/Vidia/Vidia-Open-Studio.git` | monorepo for boot scripts + src |
| `VIDIA_DOCKER_REPO_REF` | `main` | ref updater/bootstrap checkout |
| `VIDIA_NODE_REPO_URL` | `https://codeberg.org/Vidia/Vidia-Open-Studio-Nodes.git` | vidia-open-studio-node repo |
| `VIDIA_NODE_REPO_REF` | `main` | ref start.sh checks out |
| `VIDIA_DOCKER_DEPLOY_KEY` | (unset) | optional SSH key path on the volume for private forks |
| `VIDIA_NODE_DEPLOY_KEY` | (unset) | optional SSH key path for private node forks |
| `COMFY_VERSION` | `v0.25.1` | override to re-clone ComfyUI at a different tag/branch/SHA at boot |

## Build Mode (local, ST7)

Build Mode is a contributor editor that runs only in local mode. When the
frontend's `VITE_API_BASE` points at the local `app_server.py` (a `localhost`
URL), a "Build Mode" button appears; it is hidden in every hosted build.

It talks to these local-only endpoints on `app_server.py` (all reads/writes go
through one path-safe config writer in `src/build_mode.py`, which rejects any
target outside the manifest / workflows / controls / modes / dependencies dirs
and writes pretty JSON):

| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | `/build/manifest` | read / write `src/pipeline/manifest.json` (reorder, enable/disable, feature gate, generate method map) |
| GET | `/build/workflows` | list `workflows/*.json` |
| POST | `/build/workflow` | validate a tagged workflow (reuses the dryrun loader contract); on success save to `workflows/` and optionally assign to a manifest slot. Pass `validateOnly: true` to validate without writing |
| GET/PUT | `/build/controls?stage=<name>` | read / write `controls/<stage>.json` |
| GET/PUT | `/build/modes` | read / write `modes.json` |
| GET/PUT | `/build/dependencies` | read / write `worker/dependencies.json` (node pins + model URLs; records deps, does not install) |

Edits are live immediately in local mode (the loader reads files fresh) and
land as real files in the working tree, so they are committable and PR-able.
This is the contributor funnel.

Excluded from v1: node graph editing (cut and tag your graph in ComfyUI, then
upload the JSON here), a hosted write path, and auth. Hosted writes + auth are
deferred to v1.1 (see plan 10.4).

## Deploy after editing (RunPod is immutable)

Local Build Mode edits the working tree. To ship those edits to a RunPod
serverless endpoint you rebuild and push the image, because the container
filesystem is immutable per release. The image is hosted on **DockerHub** (it is
too large for a git repo); any registry works via the `IMAGE` env var:

```bash
# one-command deploy: build + push the worker image
IMAGE=<dockerhub-user>/vidia-worker:<tag> ./worker/deploy.sh
```

`deploy.sh` runs `docker build` on `worker/` and `docker push`. After the push,
point (or roll) the RunPod endpoint at the new tag. Boot-script and node edits
do not require a rebuild: they are picked up by the self-update chain at next
boot (see above).

### No-rebuild hosted edits (v1.1 path, documented only)

Rebuilds are required only for python deps and the base image. For manifest /
workflow / controls / modes changes you can skip the rebuild by mounting a
RunPod **network volume** and setting `VIDIA_CONFIG_DIR` to it (plan 10.3): the
loader then reads `manifest.json` + `workflows/` live from that directory
instead of the baked-in defaults. The admin-gated hosted Build Mode write path
that targets R2 + the network volume is deferred to v1.1 (security surface +
audit logging + validation hardening). Build Mode v1 writes locally only.
