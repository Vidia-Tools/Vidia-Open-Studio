#!/bin/bash
# updater.sh: first link in the self-update chain (updater -> bootstrap -> start).
# Clones the Vidia Open Studio monorepo at boot and refreshes the embedded
# bootstrap.sh + src/ files, then execs bootstrap.sh. If the clone fails, falls
# back to the bootstrap.sh baked into the image. All URLs/refs are env-configurable
# so self-hosters can point at their own forks.

log() {
    echo "[UPDATER.SH] [$(date +'%Y-%m-%d %H:%M:%S')] $1"
}

log "Updater started"

# RunPod hosts misconfigure the container DNS forwarder (127.0.0.11 -> 127.0.0.1
# with no real resolver), so every host fails to resolve and the self-update clone
# silently fails. Probe a public host; if it does not resolve, override
# /etc/resolv.conf with public resolvers before cloning. No-op on healthy hosts.
if ! getent hosts codeberg.org >/dev/null 2>&1; then
    log "DNS probe failed; overriding /etc/resolv.conf with public resolvers"
    printf "nameserver 8.8.8.8\nnameserver 1.1.1.1\n" > /etc/resolv.conf
fi

VIDIA_DOCKER_REPO_URL="${VIDIA_DOCKER_REPO_URL:-https://codeberg.org/Vidia/Vidia-Open-Studio.git}"
VIDIA_DOCKER_REPO_REF="${VIDIA_DOCKER_REPO_REF:-main}"

# Optional SSH deploy key for private forks (path on the persistent volume).
if [ -n "${VIDIA_DOCKER_DEPLOY_KEY:-}" ] && [ -f "$VIDIA_DOCKER_DEPLOY_KEY" ]; then
    mkdir -p /root/.ssh && chmod 700 /root/.ssh
    cp "$VIDIA_DOCKER_DEPLOY_KEY" /root/.ssh/vidia_docker_deploy_key
    chmod 600 /root/.ssh/vidia_docker_deploy_key
    export GIT_SSH_COMMAND="ssh -i /root/.ssh/vidia_docker_deploy_key -o StrictHostKeyChecking=no"
    log "Docker deploy key loaded from $VIDIA_DOCKER_DEPLOY_KEY"
fi

TEMP_DIR=$(mktemp -d)
if git clone --depth 1 -b "$VIDIA_DOCKER_REPO_REF" "$VIDIA_DOCKER_REPO_URL" "$TEMP_DIR" 2>/dev/null; then
    log "Monorepo cloned, refreshing embedded boot files..."

    if [ -f "$TEMP_DIR/worker/bootstrap.sh" ]; then
        cp "$TEMP_DIR/worker/bootstrap.sh" /bootstrap.sh
        chmod +x /bootstrap.sh
        log "  bootstrap.sh refreshed"
    else
        log "  bootstrap.sh not found in repo; keeping embedded copy"
    fi

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
    log "Failed to clone monorepo; using embedded boot files"
fi
rm -rf "$TEMP_DIR"
unset GIT_SSH_COMMAND

if [ -f /bootstrap.sh ]; then
    chmod +x /bootstrap.sh
    exec /bootstrap.sh
else
    log "CRITICAL: bootstrap.sh not found"
    exit 1
fi
