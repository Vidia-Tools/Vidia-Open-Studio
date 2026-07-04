#!/bin/bash
# bootstrap.sh: second link in the self-update chain (updater -> bootstrap -> start).
# Clones the Vidia Open Studio monorepo and refreshes the embedded src/ files
# (start.sh, rp_handler.py, app_server.py, pipeline/), then execs start.sh. If the
# clone fails, falls back to the start.sh baked into the image.

log() {
    echo "[BOOTSTRAP.SH] [$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log "Bootstrap started"

VIDIA_DOCKER_REPO_URL="${VIDIA_DOCKER_REPO_URL:-https://codeberg.org/Vidia/Vidia-Open-Studio.git}"
VIDIA_DOCKER_REPO_REF="${VIDIA_DOCKER_REPO_REF:-main}"

if [ -n "${VIDIA_DOCKER_DEPLOY_KEY:-}" ] && [ -f "$VIDIA_DOCKER_DEPLOY_KEY" ]; then
    mkdir -p /root/.ssh && chmod 700 /root/.ssh
    cp "$VIDIA_DOCKER_DEPLOY_KEY" /root/.ssh/vidia_docker_deploy_key
    chmod 600 /root/.ssh/vidia_docker_deploy_key
    export GIT_SSH_COMMAND="ssh -i /root/.ssh/vidia_docker_deploy_key -o StrictHostKeyChecking=no"
    log "Docker deploy key loaded from $VIDIA_DOCKER_DEPLOY_KEY"
fi

TEMP_DIR=$(mktemp -d)
if git clone --depth 1 -b "$VIDIA_DOCKER_REPO_REF" "$VIDIA_DOCKER_REPO_URL" "$TEMP_DIR" 2>/dev/null; then
    log "Monorepo cloned, refreshing src/ files..."
    echo "[BOOT] repo commit: $(git -C "$TEMP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
    if [ -d "$TEMP_DIR/worker/src" ]; then
        cp -r "$TEMP_DIR/worker/src/." /src/
        [ -f /src/start.sh ] && chmod +x /src/start.sh
        log "  src/ files refreshed"
    else
        log "  worker/src/ not found in repo; keeping embedded copies"
    fi

    # Refresh workflows/ so new/edited workflow JSON files in the repo roll out
    # via self-update without an image rebuild (repo is the source of truth).
    if [ -d "$TEMP_DIR/workflows" ]; then
        cp -r "$TEMP_DIR/workflows/." /workflows/
        log "  workflows/ refreshed"
    else
        log "  workflows/ not found in repo; keeping embedded copies"
    fi
else
    log "Failed to clone monorepo; using embedded src/ files"
    echo "[BOOT] repo commit: baked-image (self-update failed)"
fi
rm -rf "$TEMP_DIR"
unset GIT_SSH_COMMAND

if [ -f /src/start.sh ]; then
    chmod +x /src/start.sh
    exec /src/start.sh
else
    log "CRITICAL: start.sh not found"
    exit 1
fi
