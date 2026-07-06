#!/usr/bin/env bash

# Use libtcmalloc for better memory management if available
TCMALLOC="$(ldconfig -p | grep -Po "libtcmalloc.so.\d" | head -n 1)"
if [ -n "$TCMALLOC" ]; then
    export LD_PRELOAD="${TCMALLOC}"
fi

log() {
    echo "[START.SH] [$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log "--- Vidia Open Studio worker startup ---"

# =================================================================
# RUNTIME HOTFIXES (Apply patches for broken nodes and dependencies)
# =================================================================
log "[Startup] Applying runtime hotfixes..."

# --- Dynamic Patch for GPU compatibility and CUDA runtime matching ---
GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n 1)
log "Detected GPU: $GPU_NAME"

if echo "$GPU_NAME" | grep -iqE "blackwell|b200|b100"; then
    log "  [PATCH] Blackwell GPU detected. Applying PyTorch CUDA 12.8 nightly upgrade and matching llama_cpp..."
    /usr/bin/python3 -m pip uninstall -y torch torchvision torchaudio xformers llama_cpp_python_cuda >/dev/null 2>&1 || true
    /usr/bin/python3 -m pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128 >/dev/null 2>&1 || true
    /usr/bin/python3 -m pip install llama-cpp-python --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cu124 >/dev/null 2>&1 || true
    log "  [PATCH] PyTorch CUDA 12.8 and llama_cpp cu124 applied."
else
    log "  [PATCH] Non-Blackwell GPU detected. Using default PyTorch cu118 and matching llama_cpp..."
    /usr/bin/python3 -m pip uninstall -y llama_cpp_python_cuda >/dev/null 2>&1 || true
    /usr/bin/python3 -m pip install https://github.com/oobabooga/llama-cpp-python-cuBLAS-wheels/releases/download/textgen-webui/llama_cpp_python_cuda-0.2.89+cu118-cp310-cp310-linux_x86_64.whl >/dev/null 2>&1 || true
    log "  [PATCH] llama_cpp cu118 applied."
fi

# Fix for cg-quicknodes pyarrow dependency
/usr/bin/python3 -m pip install -U pyarrow datasets >/dev/null 2>&1 || true

# --- Patch for RES4LYF ---
if grep -q "from utils.install_util import" /ComfyUI/app/frontend_management.py 2>/dev/null; then
    sed -i.bak "s/from utils.install_util import get_missing_requirements_message, requirements_path/# from utils.install_util import get_missing_requirements_message, requirements_path/" /ComfyUI/app/frontend_management.py
    log "  [PATCH] Applied RES4LYF frontend_management.py fix."
else
    log "  [SKIP] RES4LYF already patched or file not found."
fi

# --- Patch for HunyuanVideoWrapper ---
HUNYUAN_TARGET_FILE="/ComfyUI/custom_nodes/comfyui-hunyuanvideowrapper/hyvideo/text_encoder/processing_llava.py"
if grep -q "_validate_images_text_input_order" "$HUNYUAN_TARGET_FILE" 2>/dev/null; then
    sed -i.bak 's/, _validate_images_text_input_order//' "$HUNYUAN_TARGET_FILE"
    log "  [PATCH] Applied HunyuanVideoWrapper transformers fix."
else
    log "  [SKIP] HunyuanVideoWrapper already patched or file not found."
fi

# Universal hotfix for RunPod aiohttp/brotli decompression bug.
# ComfyUI v0.25.1 requires aiohttp 3.10+ (server.py imports AppKey from
# aiohttp.helpers), so we must NOT downgrade aiohttp. The original RunPod bug
# was brotli decompression; removing brotli forces gzip/identity and avoids it
# without touching the aiohttp version.
log "  [PATCH] Removing brotli (aiohttp left at ComfyUI-required 3.10+)..."
/usr/bin/python3 -m pip uninstall -y brotli brotlicffi >/dev/null 2>&1 || true
log "  [PATCH] brotli removed."

log "[Startup] All runtime hotfixes applied."
# =================================================================

# Set paths based on deployment mode
COMFY_PATH=/ComfyUI
if [ "$DEPLOYMENT_MODE" = "pod" ]; then
    BASE_PATH=/workspace
    log "Deployment mode detected: POD"
else
    BASE_PATH=/runpod-volume
    log "Deployment mode detected: SERVERLESS"
fi

# =================================================================
# STORAGE CLEANUP (Clear trash, caches, and temporary files)
# =================================================================
log "[Startup] Cleaning persistent storage at $BASE_PATH..."
find "$BASE_PATH" -name ".DS_Store" -type f -delete 2>/dev/null
find "$BASE_PATH" -name "*Trash*" -type d -exec rm -rf {}/* \; 2>/dev/null
find "$BASE_PATH" -name "*.Trash*" -type d -exec rm -rf {}/* \; 2>/dev/null
find "$BASE_PATH" -name ".trash" -type d -exec rm -rf {}/* \; 2>/dev/null
rm -rf "$BASE_PATH/.local/share/Trash/*" "$BASE_PATH/.Trash-"*/* 2>/dev/null
find "$BASE_PATH" -name "*.tmp" -o -name "*.part" -o -name "*.download" -type f -delete 2>/dev/null
sync
log "[Startup] Storage cleanup complete."
df -h | grep --color=never "$BASE_PATH" || df -h | head -5
# =================================================================

# Debug volume paths to ensure they exist
log "Verifying persistent volume paths..."
for path in "models/checkpoints" "models/clip" "models/clip_vision" "models/configs" "models/controlnet" "models/embeddings" "models/loras" "models/upscale_models" "models/vae" "models/unet" "nodes"; do
    if [ ! -d "$BASE_PATH/$path" ]; then
        log "WARNING: Path not found, creating: $BASE_PATH/$path"
        mkdir -p "$BASE_PATH/$path"
    fi
done
rm -rf "$BASE_PATH/nodes/__MACOSX"
log "Volume paths verified."

# --- ComfyUI runtime version override ---
# ComfyUI is pinned to v0.25.1 at build time. Set COMFY_VERSION to a different
# tag/branch/SHA (or "latest") to re-clone at boot. Runs before symlinks are set
# up because it wipes /ComfyUI.
DEFAULT_COMFY_VERSION="v0.25.1"
COMFY_VERSION="${COMFY_VERSION:-$DEFAULT_COMFY_VERSION}"

if [ "$COMFY_VERSION" != "$DEFAULT_COMFY_VERSION" ]; then
    log "ComfyUI version override requested: $COMFY_VERSION (default $DEFAULT_COMFY_VERSION)"
    pkill -f "python3 $COMFY_PATH/main.py" || true
    rm -rf "$COMFY_PATH"

    if ! git clone https://github.com/Comfy-Org/ComfyUI.git "$COMFY_PATH"; then
        log "ERROR: Failed to clone ComfyUI from Comfy-Org"; exit 1;
    fi

    cd "$COMFY_PATH"
    if [ "$COMFY_VERSION" != "latest" ]; then
        if git rev-parse "v$COMFY_VERSION" >/dev/null 2>&1; then
            git checkout "v$COMFY_VERSION"
        else
            git checkout "$COMFY_VERSION"
        fi
    fi
    /usr/bin/python3 -m pip install -r requirements.txt
    log "ComfyUI version $COMFY_VERSION installed."
    cd /
fi

# --- Install vidia-open-studio-node at runtime (self-update model) ---
# Env-configurable URL/ref so self-hosters can point at their own fork. If the
# clone fails, fall back to a node left on the volume from a previous boot.
VIDIA_NODE_REPO_URL="${VIDIA_NODE_REPO_URL:-https://codeberg.org/Vidia/Vidia-Open-Studio-Nodes.git}"
VIDIA_NODE_REPO_REF="${VIDIA_NODE_REPO_REF:-main}"
VIDIA_NODE_PATH="$BASE_PATH/nodes/vidia-open-studio-node"

log "Installing vidia-open-studio-node from $VIDIA_NODE_REPO_URL @ $VIDIA_NODE_REPO_REF..."
NODE_CLONED=false

if [ -n "${VIDIA_NODE_DEPLOY_KEY:-}" ] && [ -f "$VIDIA_NODE_DEPLOY_KEY" ]; then
    mkdir -p /root/.ssh && chmod 700 /root/.ssh
    cp "$VIDIA_NODE_DEPLOY_KEY" /root/.ssh/vidia_node_deploy_key && chmod 600 /root/.ssh/vidia_node_deploy_key
    export GIT_SSH_COMMAND="ssh -i /root/.ssh/vidia_node_deploy_key -o StrictHostKeyChecking=no"
    log "  vidia-open-studio-node deploy key loaded"
fi

if [ -d "$VIDIA_NODE_PATH/.git" ]; then
    cd "$VIDIA_NODE_PATH" && git fetch --depth=1 origin "$VIDIA_NODE_REPO_REF" \
        && git reset --hard "origin/$VIDIA_NODE_REPO_REF" \
        && NODE_CLONED=true \
        || log "  vidia-open-studio-node update failed"
    cd /
else
    rm -rf "$VIDIA_NODE_PATH"
    if git clone --depth 1 -b "$VIDIA_NODE_REPO_REF" "$VIDIA_NODE_REPO_URL" "$VIDIA_NODE_PATH"; then
        NODE_CLONED=true
    else
        log "  vidia-open-studio-node clone failed"
    fi
fi
unset GIT_SSH_COMMAND

if [ "$NODE_CLONED" = true ] && [ -f "$VIDIA_NODE_PATH/requirements.txt" ]; then
    /usr/bin/python3 -m pip install -r "$VIDIA_NODE_PATH/requirements.txt" >/dev/null 2>&1 \
        && log "  vidia-open-studio-node requirements installed" \
        || log "  vidia-open-studio-node requirements install failed"
elif [ -d "$VIDIA_NODE_PATH" ]; then
    log "  Using existing vidia-open-studio-node from volume (clone failed or skipped)"
else
    log "  WARNING: vidia-open-studio-node not present; output stage may be unavailable"
fi

# Setup symlinks
log "Setting up symlinks for models and custom nodes..."
rm -rf $COMFY_PATH/models $COMFY_PATH/custom_nodes
ln -s "$BASE_PATH/models" "$COMFY_PATH/models"
ln -s "$BASE_PATH/nodes" "$COMFY_PATH/custom_nodes"
log "Symlinks created successfully."

# --- Patch for MimicMotionWrapper polyfit crash (applied after node install/symlink) ---
MIMIC_NODES_FILE="$COMFY_PATH/custom_nodes/comfyui-mimicmotionwrapper/nodes.py"
if [ -f "$MIMIC_NODES_FILE" ]; then
    if grep -q "ref_keypoint_id_all" "$MIMIC_NODES_FILE"; then
        log "  [SKIP] MimicMotion polyfit patch already applied."
    elif patch --dry-run -p1 -d "$COMFY_PATH/custom_nodes/comfyui-mimicmotionwrapper" < /patches/mimicmotion-polyfit.patch >/dev/null 2>&1; then
        patch -p1 -d "$COMFY_PATH/custom_nodes/comfyui-mimicmotionwrapper" < /patches/mimicmotion-polyfit.patch
        log "  [PATCH] Applied MimicMotion polyfit fix."
    else
        log "  [WARN] MimicMotion polyfit patch did not apply cleanly; node source may have changed."
    fi
else
    log "  [SKIP] MimicMotionWrapper not installed."
fi

# --- Patch for VideoHelperSuite Vidia import-CDN downloader (applied after install/symlink) ---
VHS_NODES_FILE="$COMFY_PATH/custom_nodes/comfyui-videohelpersuite-custom/videohelpersuite/utils.py"
if [ -f "$VHS_NODES_FILE" ]; then
    if grep -q "_http_download_to_temp" "$VHS_NODES_FILE"; then
        log "  [SKIP] VHS Vidia-download patch already applied."
    elif patch --dry-run -p1 -d "$COMFY_PATH/custom_nodes/comfyui-videohelpersuite-custom" < /patches/vhs-vidia-download.patch >/dev/null 2>&1; then
        patch -p1 -d "$COMFY_PATH/custom_nodes/comfyui-videohelpersuite-custom" < /patches/vhs-vidia-download.patch
        log "  [PATCH] Applied VHS Vidia-download patch."
    else
        log "  [WARN] VHS Vidia-download patch did not apply cleanly; node source may have changed."
    fi
else
    log "  [SKIP] VideoHelperSuite not installed."
fi

# Start services based on the deployment mode
if [ "$DEPLOYMENT_MODE" = "pod" ]; then
    # --- POD MODE ---
    log "Starting services for POD mode..."
    fuser -k 3000/tcp || true

    log "Setting default shell to bash for Jupyter..."
    export SHELL=/bin/bash

    log "Starting Jupyter Lab in background..."
    jupyter lab --allow-root \
               --notebook-dir=/ \
               --no-browser \
               --port=8888 \
               --ip=0.0.0.0 \
               --NotebookApp.token='' \
               --NotebookApp.password='' \
               --ServerApp.allow_origin='*' \
               --ServerApp.allow_credentials=True \
               --ServerApp.allow_remote_access=True &

    log "Starting ComfyUI in background..."
    COMFY_ATTENTION_ARGS="${COMFY_ATTENTION_ARGS:---force-fp16}"
    log "ComfyUI attention args: $COMFY_ATTENTION_ARGS"
    python3 $COMFY_PATH/main.py --listen 0.0.0.0 \
                  --port 3000 \
                  $COMFY_ATTENTION_ARGS &

    log "Both services are running. Script will now wait."
    wait -n

elif [ "$DEPLOYMENT_MODE" = "serverless" ]; then
    # --- SERVERLESS MODE ---
    log "Starting services for SERVERLESS mode..."
    COMFY_ATTENTION_ARGS="${COMFY_ATTENTION_ARGS:---force-fp16}"
    log "ComfyUI attention args: $COMFY_ATTENTION_ARGS"
    python3 $COMFY_PATH/main.py --disable-auto-launch $COMFY_ATTENTION_ARGS --verbose > /tmp/comfy.log 2>&1 &
    COMFY_PID=$!

    log "Waiting for ComfyUI to be ready (PID: $COMFY_PID)..."

    # Heartbeat + concise logging controls. BACKEND_BASE is required (no Vidia default).
    if [ -z "$BACKEND_BASE" ]; then
        log "WARNING: BACKEND_BASE not set. Startup heartbeats and backend callbacks are disabled."
    fi
    HEARTBEAT_PATH="${HEARTBEAT_PATH:-/api/vidiaGeneration/podHeartbeat}"
    POD_HEARTBEAT_URL="${POD_HEARTBEAT_URL:-$BACKEND_BASE$HEARTBEAT_PATH}"
    CALLBACK_SECRET="${RUNPOD_CALLBACK_SECRET:-}"
    DEBUG="${DEBUG:-false}"
    POD_ID="${RUNPOD_POD_ID:-$HOSTNAME}"
    LAST_HB=0
    LAST_SUMMARY=0
    PRINTED_STARTING=0
    START_EPOCH=$(date +%s)
    HB_COUNT=0

    # Deterministic startup milestones (no timers)
    BASELINE_PERCENT=25    # cleanup + volumes verified
    COMFY_STARTED_PERCENT=50
    HTTP_READY_PERCENT=70
    COMFY_READY_PERCENT=90

    is_http_ready() {
        curl -sf -m 1 "http://127.0.0.1:8188" >/dev/null 2>&1
    }

    send_heartbeat() {
        if [ -n "$BACKEND_BASE" ]; then
            ts_ms=$(($(date +%s%N)/1000000))
            curl -s -X POST -H "Content-Type: application/json" -H "X-Callback-Secret: $CALLBACK_SECRET" \
                 -d "{\"status\":\"starting\",\"timestamp\":$ts_ms,\"podId\":\"$POD_ID\",\"percent\":$1,\"step\":\"$2\"}" \
                 "$POD_HEARTBEAT_URL" >/dev/null 2>&1 || true
            HB_COUNT=$((HB_COUNT+1))
        fi
    }

    CURRENT_PERCENT=$COMFY_STARTED_PERCENT
    CURRENT_STEP="comfy_process_started"

    while true; do
        if ! kill -0 $COMFY_PID 2>/dev/null; then
            log "ComfyUI process died. Dumping log:"; cat /tmp/comfy.log; exit 1;
        fi

        if [ "$CURRENT_PERCENT" -lt "$HTTP_READY_PERCENT" ] && is_http_ready; then
            CURRENT_PERCENT=$HTTP_READY_PERCENT
            CURRENT_STEP="http_ready"
        fi

        if grep -q "All startup tasks have been completed" /tmp/comfy.log 2>/dev/null; then
            send_heartbeat $COMFY_READY_PERCENT "comfy_ready"
            break
        fi

        now=$(date +%s)
        if [ $((now - LAST_HB)) -ge 2 ]; then
            PERCENT=$CURRENT_PERCENT
            if [ $PERCENT -lt $BASELINE_PERCENT ]; then PERCENT=$BASELINE_PERCENT; fi
            send_heartbeat $PERCENT "$CURRENT_STEP"
            LAST_HB=$now
        fi

        if [ "$DEBUG" = "true" ]; then
            log "Still waiting..."
        else
            if [ $PRINTED_STARTING -eq 0 ]; then
                log "[Startup] Worker starting, warming up models (heartbeats every 2s)"
                PRINTED_STARTING=1
            fi
            if [ $((now - LAST_SUMMARY)) -ge 15 ]; then
                log "[Startup] Comfy is starting..."
                LAST_SUMMARY=$now
            fi
        fi

        sleep 2
    done

    READY_EPOCH=$(date +%s)
    DURATION=$((READY_EPOCH - START_EPOCH))
    log "[Startup] Comfy ready in ${DURATION}s, heartbeats_sent=${HB_COUNT}"

    # VIDIA_MODE selects the wrapper: "runpod" (serverless SDK, default) or
    # "local" (thin HTTP server, no RunPod/R2/backend callbacks).
    VIDIA_MODE="${VIDIA_MODE:-runpod}"
    if [ "$VIDIA_MODE" = "local" ]; then
        log "ComfyUI is ready. Launching local app server (VIDIA_MODE=local)."
        # --host 0.0.0.0 required inside the container for Docker port mapping;
        # bare-metal default is loopback (see app_server.py --host).
        cd /src && exec python3 /src/app_server.py --comfy "http://127.0.0.1:8188" --port "${APP_SERVER_PORT:-8189}" --host 0.0.0.0
    else
        log "ComfyUI is ready. Launching serverless handler."
        cd /src && exec python3 /src/rp_handler.py
    fi

else
    log "CRITICAL ERROR: DEPLOYMENT_MODE not set or invalid. Cannot proceed."
    exit 1
fi
