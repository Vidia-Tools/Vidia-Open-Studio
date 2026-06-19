"""Build Mode config read/write helpers (ST7, local-first).

Every write goes through a single `write_config` function that validates the
target stays inside an allowed config directory and writes pretty JSON. No
write can touch anything outside manifest/workflows/controls/modes/dependencies.
Workflow uploads are validated against the loader tag contract by reusing
loader.load_stage (the same logic scripts/dryrun_loader.py exercises).

Local mode only: app_server.py wraps these; there is no hosted/auth path here
(deferred to v1.1, see README/plan 10.4).
"""

import json
import os
import tempfile

from pipeline import loader

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

# category -> (subdir relative to repo root, fixed filename or None for *.json).
_ALLOWED = {
    "manifest":     ("worker/src/pipeline", "manifest.json"),
    "modes":        ("frontend/js/config", "modes.json"),
    "dependencies": ("worker", "dependencies.json"),
    "controls":     ("controls", None),      # controls/<stage>.json
    "workflow":     ("workflows", None),     # workflows/<name>.json
}


class ConfigError(Exception):
    pass


def _safe_path(category, name=None):
    """Resolve a config target and prove it stays inside its allowed dir."""
    if category not in _ALLOWED:
        raise ConfigError(f"unknown config category: {category}")
    subdir, fixed = _ALLOWED[category]
    base = os.path.realpath(os.path.join(REPO_ROOT, subdir))
    if fixed:
        target = os.path.join(base, fixed)
    else:
        if not name or not name.endswith(".json"):
            raise ConfigError("name must be a .json filename")
        if os.path.basename(name) != name:
            raise ConfigError("name must not contain path separators")
        target = os.path.join(base, name)
    real = os.path.realpath(target)
    if real != base and not real.startswith(base + os.sep):
        raise ConfigError(f"path escapes allowed config dir: {name}")
    return real


def read_config(category, name=None):
    with open(_safe_path(category, name)) as f:
        return json.load(f)


def write_config(category, data, name=None):
    """The single config writer. All Build Mode writes funnel through here."""
    target = _safe_path(category, name)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return target


def list_workflows():
    base = os.path.realpath(os.path.join(REPO_ROOT, "workflows"))
    return sorted(n for n in os.listdir(base) if n.endswith(".json"))


def validate_workflow(graph):
    """Validate a tagged workflow against the loader contract.

    Runs it through loader.load_stage with synthesized dummy params/files (every
    {param} and [in_*] the titles declare), then asserts: all params resolve,
    a terminal [out] exists XOR named [out:*] outputs exist. Returns
    {valid, errors, summary}.
    """
    if not isinstance(graph, dict) or not graph:
        return {"valid": False, "summary": {},
                "errors": ["workflow must be a non-empty JSON object of nodes"]}

    in_slots, params = set(), set()
    for node in graph.values():
        if not isinstance(node, dict):
            return {"valid": False, "summary": {},
                    "errors": ["every node must be a JSON object"]}
        title = node.get("_meta", {}).get("title", "")
        s, _out, p = loader.scan_tags(title)
        in_slots.update(s)
        params.update(p)

    files = {slot: f"/tmp/dummy/{slot}" for slot in in_slots if slot != "in_prev"}
    dummy_params = {k: "x" for k in params}

    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    try:
        json.dump(graph, tmp)
        tmp.close()
        _, info = loader.load_stage(
            tmp.name, "build_validate", "validateGenID", dummy_params, files,
            prev_output="/tmp/dummy/prev", text_output_dir="/tmp/dummy/text",
            final=False)
    except loader.StageLoadError as e:
        return {"valid": False, "summary": {}, "errors": [str(e)]}
    finally:
        os.unlink(tmp.name)

    errors = []
    if info["params_unresolved"]:
        errors.append("unresolved {param} tags: " + ", ".join(
            f"{k} (node {nid})" for nid, k in info["params_unresolved"]))
    if info["output_node"] is None and not info["text_outputs"]:
        errors.append("missing terminal [out] node (and no named [out:*] outputs)")
    if info["output_node"] is not None and info["text_outputs"]:
        errors.append("mixed terminal [out] and named [out:*]; a stage is either "
                      "one terminal [out] or text-only [out:*]")

    summary = {
        "nodes": len(graph),
        "inputs": sorted(info["inputs"].keys()),
        "output_node": info["output_node"],
        "text_outputs": sorted(info["text_outputs"].keys()),
        "params_resolved": sorted({k for _, k in info["params_resolved"]}),
    }
    return {"valid": not errors, "errors": errors, "summary": summary}


def _assign_slot(stage_name, rel_path, method=None):
    """Point a manifest stage (or a select method) at an uploaded workflow."""
    manifest = read_config("manifest")
    for stage in manifest["stages"]:
        if stage.get("name") == stage_name:
            if method:
                stage.setdefault("files", {})[method] = rel_path
            else:
                stage["file"] = rel_path
            write_config("manifest", manifest)
            return {"stage": stage_name, "method": method, "file": rel_path}
    raise ConfigError(f"no manifest stage named {stage_name}")


def _handle_workflow_upload(body):
    name = body.get("name")
    graph = body.get("workflow")
    if not name or not isinstance(name, str):
        return 400, {"saved": False, "errors": ["missing 'name'"]}
    if not name.endswith(".json"):
        name += ".json"
    result = validate_workflow(graph)
    # validateOnly: report the result without writing anything to the tree.
    if body.get("validateOnly"):
        return (200 if result["valid"] else 400), {"saved": False, **result}
    if not result["valid"]:
        return 400, {"saved": False, **result}
    write_config("workflow", graph, name)
    assigned = None
    if body.get("slot"):
        assigned = _assign_slot(body["slot"], f"workflows/{name}", body.get("method"))
    return 200, {"saved": True, "file": f"workflows/{name}",
                 "assigned": assigned, **result}


def dispatch(method, sub, query, body):
    """Route a /build/<sub> request. Returns (status, payload).

    query: dict of lists (parse_qs). body: parsed JSON for PUT/POST or None.
    """
    try:
        if sub == "manifest":
            if method == "GET":
                return 200, read_config("manifest")
            if method == "PUT":
                write_config("manifest", body)
                return 200, {"saved": True}
        elif sub == "modes":
            if method == "GET":
                return 200, read_config("modes")
            if method == "PUT":
                write_config("modes", body)
                return 200, {"saved": True}
        elif sub == "dependencies":
            if method == "GET":
                return 200, read_config("dependencies")
            if method == "PUT":
                write_config("dependencies", body)
                return 200, {"saved": True}
        elif sub == "controls":
            stage = (query.get("stage") or [None])[0]
            if not stage:
                return 400, {"error": "missing ?stage="}
            name = f"{stage}.json"
            if method == "GET":
                return 200, read_config("controls", name)
            if method == "PUT":
                write_config("controls", body, name)
                return 200, {"saved": True}
        elif sub == "workflows" and method == "GET":
            return 200, {"workflows": list_workflows()}
        elif sub == "workflow" and method == "POST":
            return _handle_workflow_upload(body or {})
        return 404, {"error": "not found"}
    except ConfigError as e:
        return 400, {"error": str(e)}
    except FileNotFoundError as e:
        return 404, {"error": f"config file not found: {e}"}
