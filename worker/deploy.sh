#!/usr/bin/env bash
# One-command deploy for the worker image (ST7 / plan 10.4).
# RunPod containers are immutable per release, so shipping local Build Mode edits
# means rebuilding and pushing the image, then pointing the endpoint at the tag.
#
# The image is hosted on DockerHub (it is too large for a git repo). Any registry
# works: set IMAGE to a DockerHub reference like <dockerhub-user>/vidia-worker:<tag>
# or any other <registry>/vidia-worker:<tag>.
#
# Usage:
#   IMAGE=<dockerhub-user>/vidia-worker:<tag> ./worker/deploy.sh
#
# No-rebuild alternative for manifest/workflow/controls edits: mount a RunPod
# network volume and set VIDIA_CONFIG_DIR to it (plan 10.3). See README.
set -euo pipefail

: "${IMAGE:?set IMAGE=<registry>/vidia-worker:<tag>}"

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"

echo "Building $IMAGE from $REPO_ROOT (Dockerfile: worker/Dockerfile) ..."
docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$REPO_ROOT"

echo "Pushing $IMAGE ..."
docker push "$IMAGE"

echo "Done. Point/roll your RunPod serverless endpoint at $IMAGE."
