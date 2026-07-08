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

Local mode also unlocks **Build Mode**: when the frontend points at a
localhost app server, a Build Mode button appears in the UI. It scans a
workflow JSON for `{placeholder}` tags and lets you generate the frontend
control definitions visually, writing real files (`manifest.json`,
`workflows/`, `controls/`, `modes.json`) into the working tree so edits are
committable and PR-able. See the "Build Mode (local, ST7)" section in
[`worker/README.md`](worker/README.md) for endpoints and details.

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

## Workflows

The pipeline engine (`worker/src/pipeline/manifest.json`) chains the stages
below. Every workflow JSON in `workflows/` is a native ComfyUI graph: you can
open and run any of them directly in ComfyUI ("embedded native app mode"),
with Vidia parameters visible as `{placeholder}` tags in node titles.

| Workflow | Stage | Triggered by | What it does |
|----------|-------|--------------|--------------|
| `prompt_prep.json` | prompt_prep | Prompt Enhance feature | LLM prompt enhancement via a local LLM (Searge) or optional OpenRouter cloud model; outputs enhanced prompt + negative prompt text |
| `body_replace.json` | body_replace | Full Body Replacement feature | Segments the subject (SAM2), inpaints a clean plate, and re-animates a replacement reference image with MimicMotion pose transfer |
| `generate_wan.json` | generate | Forge method | Wan 2.2 Fun Control video generation guided by OpenPose/Depth/Canny controls, optional style reference |
| `generate_animatediff.json` | generate | Evolve method | AnimateDiff (SDXL) video-to-video restyling with ControlNet, IPAdapter style transfer, and inpaint/outpaint support |
| `generate_reversenoise.json` | generate | Trace method | AnimateDiff variant using reverse noise sampling (flipped sigmas, custom sampler) for closer source adherence |
| `generate_hunyuan.json` | generate | Hunyuan method | HunyuanVideo video-to-video generation with LoRA support |
| `detailer.json` | detailer | Detailer feature | Face detection (Ultralytics + SAM) and per-segment re-detailing across frames, plus ReActor face restore |
| `faceswap.json` | faceswap | Face Swap feature | ReActor face swap from a reference image onto the video |
| `liveportrait.json` | liveportrait | Face Expression Transfer feature | LivePortrait facial expression/motion transfer from the input video onto the generated faces |
| `upscale.json` | upscale | Upscaler feature | Diffusion upscale pass (Wan low-denoise re-sampling) at a configurable multiplier |
| `skin.json` | skin | Skin Improvement feature | Two-pass 1x refiner models to improve skin texture |
| `post.json` | post | Always (final polish) | RIFE frame interpolation and deflickering |
| `audio.json` | audio | Sound Generation feature | MMAudio soundtrack generation from the video plus prompt |
| `output_saver.json` | output | Always (hosted mode) | Applies watermark and uploads the final video via the Vidia saver node (R2 + backend notify) |
| `output_saver_local.json` | output | Always (local mode) | Writes the final h264 mp4 to the ComfyUI output directory |

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

## Links

- GitHub (development, issues, pull requests): https://github.com/federicobuilds/Vidia-Open-Studio
- Codeberg (read-only functional mirror; the GPU worker pulls from here at boot): https://codeberg.org/Vidia/Vidia-Open-Studio
- Custom node pack: https://github.com/federicobuilds/Vidia-Open-Studio-Nodes
- Worker container image on DockerHub: https://hub.docker.com/r/federicobuilds/vidia-open-studio

Contributions go through GitHub only. Codeberg is a downstream mirror that
stays in sync automatically; do not open pull requests or commit against it.
