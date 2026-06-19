#!/usr/bin/env python3
"""Clone/checkout pinned custom nodes and download missing models.

Reads worker/dependencies.json. Used both for RunPod image/volume builds and
local mode. Gated downloads read HF_TOKEN / CIVITAI_TOKEN from the environment.
Entries with url "TODO" (or non-git nodes with source "TODO") are skipped with
a warning.

Usage:
  python3 fetch_models.py --nodes-dir /workspace/nodes --models-dir /workspace/models
"""

import argparse
import json
import os
import subprocess
import sys
import urllib.request

DEPS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dependencies.json")


def fetch_nodes(nodes, nodes_dir):
    os.makedirs(nodes_dir, exist_ok=True)
    for node in nodes:
        name = node["name"]
        if node.get("vendored"):
            print(f"[node] {name}: vendored in repo ({node.get('path')}), skipping")
            continue
        if node.get("source") == "TODO" or not node.get("repo_url"):
            print(f"[node] WARNING: {name} has no resolved source (TODO); skipping")
            continue
        dest = os.path.join(nodes_dir, name)
        if not os.path.isdir(os.path.join(dest, ".git")):
            print(f"[node] cloning {name}...")
            subprocess.run(["git", "clone", node["repo_url"], dest], check=True)
        print(f"[node] {name} -> {node['commit']}")
        subprocess.run(["git", "fetch", "--all"], cwd=dest, check=True)
        subprocess.run(["git", "checkout", node["commit"]], cwd=dest, check=True)


def download(url, dest):
    headers = {}
    if "huggingface.co" in url and os.environ.get("HF_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['HF_TOKEN']}"
    if "civitai.com" in url and os.environ.get("CIVITAI_TOKEN"):
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}token={os.environ['CIVITAI_TOKEN']}"
    req = urllib.request.Request(url, headers=headers)
    tmp = dest + ".part"
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.rename(tmp, dest)


def fetch_models(models, models_root):
    for model in models:
        url = model.get("url", "TODO")
        dest_dir = os.path.join(models_root, model["dest_path"].replace("models/", "", 1))
        dest = os.path.join(dest_dir, model["filename"])
        if url == "TODO":
            print(f"[model] WARNING: no URL for {model['filename']} (TODO); skipping")
            continue
        if os.path.exists(dest):
            print(f"[model] {model['filename']} already present")
            continue
        os.makedirs(dest_dir, exist_ok=True)
        print(f"[model] downloading {model['filename']} from {url}")
        try:
            download(url, dest)
        except Exception as e:
            print(f"[model] ERROR downloading {model['filename']}: {e}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--nodes-dir", default="/workspace/nodes")
    parser.add_argument("--models-dir", default="/workspace/models")
    parser.add_argument("--skip-nodes", action="store_true")
    parser.add_argument("--skip-models", action="store_true")
    args = parser.parse_args()

    with open(DEPS_PATH) as f:
        deps = json.load(f)

    if not args.skip_nodes:
        fetch_nodes(deps["custom_nodes"], args.nodes_dir)
    if not args.skip_models:
        fetch_models(deps["models"], args.models_dir)


if __name__ == "__main__":
    sys.exit(main())
