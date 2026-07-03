# Vidia Open Studio - Deployment Guide

Step-by-step to deploy your own hosted instance on Cloudflare (backend + frontend)
and RunPod (GPU worker). Local mode (Docker Compose / bare metal) is covered in
`worker/README.md` and needs none of this.

Legend:
- `[HUMAN]` requires your accounts, GPU, DNS, or a paid action. Only you can do it.
- `[DONE]` already in the repo; nothing to do beyond reading.
- `[BLOCKED]` cannot complete until an OPEN (Federico) item is resolved. See section 0.

---

## 0. Prerequisites and OPEN blockers

Resolve these BEFORE the worker can run a real generation:

1. `[DONE]` **Custom node pins (8).** The 8 custom nodes that were previously
   unpinned are now pinned in `worker/dependencies.json` with `repo_url` +
   `commit`: ComfyUI-WanVideoWrapper, comfyui-custom-scripts, comfyui-easy-use,
   comfyui-easyurlloader, comfyui-frameskipping, comfyui-get-meta,
   comfyui-videohelpersuite-custom, and joycaption_comfyui. VHS uses the upstream
   ComfyUI-VideoHelperSuite base commit plus `patches/vhs-vidia-download.patch`
   (applied by `start.sh`); no custom fork is required. No action needed for these
   pins unless a contributor changes a node version.
2. `[BLOCKED]` **Model URLs.** `worker/dependencies.json` model entries with
   `"url": "TODO"` (e.g. `v6.safetensors`, `xlMerges.safetensors`) are skipped by
   `fetch_models.py`. Fill direct downloadable HF/Civitai URLs for every model a
   flow actually uses before populating the volume.
3. `[BLOCKED]` **Non-direct / bundle model sources.** Several model entries point
   at sources `fetch_models.py` cannot consume as-is: GitHub `tree/main` directory
   listings, Civitai model pages (not the direct download file), `openmodeldb.info`
   pages, bundle-level repositories, and note-only sources. Resolve each to a
   direct downloadable file URL (or document the manual fetch step) before relying
   on it.
4. `[BLOCKED]` **Empty `used_by` / license review.** Many models have empty
   `used_by` arrays, so it is unclear which flows need them; a license/usage
   review is also pending for redistributable model files. Populate `used_by` and
   confirm licensing before the volume is considered reproducible.
5. `[BLOCKED]` **Dependency validation / checksum gaps.** `fetch_models.py` does
   not support checksums, bundle traversal/extraction, HF tree traversal,
   OpenModelDB resolution, or validation that required URLs are direct
   downloadable files. Until that lands, model population is not reproducible or
   verified; treat the volume as best-effort.

Tooling you need:
- Cloudflare account with Workers, Pages, R2, KV, Durable Objects enabled.
- `wrangler` CLI logged in (`wrangler login`).
- RunPod account + API key + a serverless endpoint slot, and a network volume.
- Docker with a registry you can push to (for the worker image).
- Node 18+ and Python 3.10+ locally.

---

## 1. `[HUMAN]` Fill the root `.env`

```bash
cp .env.example .env
# edit .env
```

`.env.example` is the canonical list (plan 8.1). Required vars by component:

### Worker (Docker/RunPod env vars)
| Var | Where to get it |
|-----|-----------------|
| `BACKEND_BASE` | Your deployed backend Worker URL (fill AFTER step 4; re-set the endpoint env then). |
| `RUNPOD_CALLBACK_SECRET` | Generate a long random string. MUST match the backend secret of the same name. |
| `EXPORTS_DOMAIN` | R2 exports bucket custom domain (e.g. `exports.example.com`). |
| `VIDIA_BACKEND_URL` | Same as `BACKEND_BASE` (vidia-node output stage). |
| `S3_PUBLIC_URL_PREFIX` | `https://<EXPORTS_DOMAIN>`. |
| `S3_ENDPOINT_URL` | `https://<account-id>.r2.cloudflarestorage.com`. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token (exports bucket write). |
| `S3_BUCKET_NAME` | Exports bucket name (e.g. `exports`). |
| `S3_REGION_NAME` | `auto`. |
| `DEPLOYMENT_MODE` | `serverless`. |
| `HF_TOKEN` / `CIVITAI_TOKEN` | For gated model downloads in `fetch_models.py`. |

### Backend secrets (pushed by `setup.sh` via `wrangler secret put`)
| Var | Where to get it |
|-----|-----------------|
| `JWT_SECRET` | Generate a long random string. |
| `RUNPOD_API_KEY` | RunPod console. |
| `RUNPOD_CALLBACK_SECRET` | Same value as the worker var above. |
| `EMAIL_API_KEY` | Resend API key. |
| `MAILERLITE_API_KEY` / `*_GROUP_ID` | MailerLite (optional). |
| `TURNSTILE_SECRET_KEY_LOGIN` / `_NEWSLETTER` | Cloudflare Turnstile. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | R2 API token (imports bucket presign). |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe. ONLY if payments enabled (out of scope v1; leave empty). |

### Frontend (VITE_* build-time)
| Var | Where to get it |
|-----|-----------------|
| `VITE_API_BASE` | Deployed backend Worker URL (fill after step 4). |
| `VITE_RUNPOD_MODE` | `true`. |
| `VITE_DEV_MODE` | `false`. |
| `VITE_TURNSTILE_SITE_KEY_LOGIN` | Turnstile public site key. |
| `VITE_ADMIN_EMAIL` | Admin email that unlocks admin UI. |
| `VITE_EXPORTS_DOMAIN` | `https://<EXPORTS_DOMAIN>`. |

Non-secret backend config (ALLOWED_ORIGINS, ADMIN_EMAIL, APP_BASE_URL, EMAIL_FROM,
ACCOUNT_ID, bucket names/domains, `RUNPOD_*_ENDPOINT_ID`, `VIDIA_PAYMENTS_ENABLED`)
lives in `backend/wrangler.toml`, NOT in `.env`. See `backend/wrangler.toml.example`.

---

## 2. `[HUMAN]` Distribute secrets

```bash
./setup.sh
```

Reads `.env` and pushes every non-empty backend secret with `wrangler secret put`
(cwd `backend/`). Empty values are skipped. `setup.sh` does NOT yet write the
worker env (you set those on the RunPod endpoint, step 3) or `frontend/.env.local`
(set VITE_* in your Pages build env, step 5).

---

## 3. Worker: build image + RunPod endpoint

3a. `[HUMAN]` Resolve the section 0 OPEN items first (`dependencies.json`).

3b. `[HUMAN]` Build and push the image:
```bash
IMAGE=<registry>/vidia-worker:<tag> ./worker/deploy.sh
```
Runs `docker build` on `worker/` and `docker push`.

3c. `[HUMAN]` Populate the RunPod **network volume** with models + nodes. Attach
the volume to a temporary pod (or run inside the endpoint container) and run:
```bash
python3 worker/scripts/fetch_models.py \
  --nodes-dir  /runpod-volume/nodes \
  --models-dir /runpod-volume/models
```
Note: the script's argument DEFAULTS are `/workspace/...` (pod mode). For a
serverless endpoint the volume mounts at `/runpod-volume`, so pass the dirs
explicitly as above. `start.sh` (serverless) sets `BASE_PATH=/runpod-volume` and
symlinks `/ComfyUI/models` and `/ComfyUI/custom_nodes` to it. `[BLOCKED]` entries
with `url: TODO` or non-direct/bundle sources are skipped with a warning; the flows
that need them will fail until section 0 is done. (Custom node pins are resolved;
node fetch is not a blocker.)

3d. `[HUMAN]` Create the RunPod serverless endpoint pointing at `<IMAGE>`, attach
the network volume, and set endpoint env vars (the worker block from `.env`):
`BACKEND_BASE`, `RUNPOD_CALLBACK_SECRET`, `EXPORTS_DOMAIN`, `VIDIA_BACKEND_URL`,
`S3_*`, `DEPLOYMENT_MODE=serverless`. `VIDIA_MODE` defaults to `runpod`.

3e. `[HUMAN]` Put the endpoint ID into `backend/wrangler.toml`
(`RUNPOD_*_ENDPOINT_ID`).

---

## 4. Backend: wrangler deploy

4a. `[HUMAN]` Copy and fill the non-secret config:
```bash
cp backend/wrangler.toml.example backend/wrangler.toml
# fill [vars], KV namespace IDs, R2 bucket bindings, Durable Object bindings,
# RUNPOD_*_ENDPOINT_ID, ACCOUNT_ID, ALLOWED_ORIGINS, etc.
```
Set `VIDIA_PAYMENTS_ENABLED=false` (payments are out of scope for v1).

4b. `[HUMAN]` Create the bindings referenced by `wrangler.toml`: KV namespace(s),
R2 buckets (imports + exports), and ensure Durable Object classes migrate on
first deploy.

4c. `[HUMAN]` Deploy:
```bash
cd backend && wrangler deploy
```
Copy the deployed Worker URL back into `.env` (`BACKEND_BASE`, `VIDIA_BACKEND_URL`,
`VITE_API_BASE`) and into the RunPod endpoint env (step 3d). Re-run `./setup.sh`
only if a secret changed.

---

## 5. Frontend: build + Pages deploy

```bash
cd frontend
# set VITE_* (from .env) in the Pages build environment or frontend/.env.local
npm ci      # in your CI / build env, NOT required in the repo working tree
npm run build
# deploy dist/ to Cloudflare Pages (dashboard or `wrangler pages deploy dist`)
```
`VITE_API_BASE` MUST point at the deployed backend (step 4). A non-localhost
`VITE_API_BASE` hides Build Mode (local-only contributor tool).

---

## 6. `[HUMAN]` R2 output retention (lifecycle rule)

The backend has NO retention code and NO `VIDIA_OUTPUT_RETENTION_DAYS` variable;
output expiry is pure R2 configuration, configurable per self-hoster. Set an
object-expiry lifecycle rule on the **exports** bucket.

Dashboard: R2 > exports bucket > Settings > Object lifecycle rules > Add rule >
"Delete objects" after N days (choose your N, e.g. 30). Apply to the whole bucket
or a prefix.

Or via wrangler:
```bash
wrangler r2 bucket lifecycle add <exports-bucket> \
  --expire-days <N> --prefix ""
# verify:
wrangler r2 bucket lifecycle list <exports-bucket>
```
(Imports bucket: optionally a shorter expiry for transient uploads.)

---

## 7. `[HUMAN]` Smoke test with the two payloads

Test payloads live in `worker/test-payloads/`:
- `minimal.json` - 3-stage minimal run (prompt_prep -> one generate method ->
  output), all features off.
- `full-feature.json` - all features on, a method selected, files populated with
  placeholder URLs (replace with real reachable URLs before a real GPU run).

Both are verified to pass the worker `validate_input` and backend `validateParams`
edge validators. Send `minimal.json` through the deployed backend first; confirm a
job is queued on RunPod, progress events stream, and an output lands in the
exports bucket. Then `full-feature.json` (with real file URLs).

---

## 8. `[HUMAN]` Parity checklist vs old Vidia

Before cutover, confirm the new stack matches the old Vidia output:
- Each of the 4 methods (forge / evolve / trace / hunyuan) produces equivalent
  output to the old graph for the same prompt + seed.
- Each feature toggle (fullBodyReplace, detailer, faceSwap, liveportrait,
  upscaler, genAudio) behaves as before.
- Progress events, video-ready notifications, and terminal logs reach the
  frontend.
- Auth, history, credits, admin panel behave as on the old frontend.
- Output filenames, exports domain URLs, and email notices match.

---

## 9. `[HUMAN]` Secrets sweep

Confirm no secret leaked into the Open-Studio tree (only `.env.example`
placeholders allowed). Cross-check against the bible secrets table
(`plans/codebase-bible.md` section c). From the Open-Studio root:
```bash
grep -rEn "(sk_live|sk_test|whsec_|AKIA|Bearer |[A-Za-z0-9_-]{32,})" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude=.env.example .
```
Expected: zero real secrets outside `.env.example`. Investigate any hit.

---

## 10. `[HUMAN]` Cutover (only after parity)

Swap DNS / the RunPod endpoint to the new stack only once sections 7-9 pass.
- Point the app domain at the new Cloudflare Pages site.
- Point the backend route / API domain at the new Worker.
- Keep the old stack reachable for rollback.

Rollback: revert DNS / route to the old stack; the old endpoint and old frontend
remain untouched until you decommission them.

---

## 11. `[HUMAN]` Post-parity volume slimming

After parity is confirmed, drop models/nodes not referenced by any flow's
dependencies (`used_by`) to shrink the network volume. Known first candidate:
**MagicAnimate** (full model set present on the dev pod but no current workflow
references it; pod-map section "Discrepancies"). Verify against the `used_by`
mapping in `dependencies.json` before deleting, and keep a backup until a full
generation cycle confirms nothing regressed.

---

## Appendix: known harness limitation (backend tests)

`backend/test/index.spec.js` and `backend/test/middleware/auth.spec.js` currently
fail to load under `@cloudflare/vitest-pool-workers@^0.5.2` (the version pinned in
`backend/package.json`): the pool's CJS shim mis-resolves `semver` as pulled in
transitively by `jsonwebtoken`, so any suite that imports the worker entry (which
imports `jsonwebtoken`) cannot load. Pure-ESM unit suites with no `jsonwebtoken`
import run fine (e.g. `test/utils/validate-params.spec.js`,
`test/utils/response.spec.js`, `test/utils/helpers.spec.js`).

Recommendation: treat this as a known harness limitation for now, NOT a code
defect, and do not weaken the tests. To attempt a fix, align `vitest` and
`@cloudflare/vitest-pool-workers` to a newer matched pair and verify in a
throwaway directory (never `npm install` in the working tree) before adopting:
copy `backend/` to a temp dir, bump both deps together (the pool version must
match the vitest major), `npm install` there, and run `vitest`. If a specific
matched pair resolves the `semver`/CJS shim resolution, bump those two
`devDependencies` in `backend/package.json` in a dedicated PR. Until verified,
ship with the limitation documented here.
