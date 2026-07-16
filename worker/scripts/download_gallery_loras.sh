#!/bin/bash
# download_gallery_loras.sh: populate the pod loras volume with the Envision
# (LTX-2.3 22B) gallery LoRAs. Section A style LoRAs go to the loras root;
# Section B official Lightricks IC-LoRAs go to ltxv/ltx2/. Community VFX
# IC-LoRAs (Civitai) go to the loras root. All URLs are hard-coded so the pod
# needs no API calls at runtime. Run on the pod only.
#
# Quota probe: before each download we write a 1MB zero file. On this pod an
# EDQUOT (disk quota) failure masks as "No such file or directory" inside wget,
# so we probe explicitly with dd and abort on failure.
#
# Env overrides:
#   LORA_DIR       destination loras dir (default /ComfyUI/models/loras)
#   CIVITAI_TOKEN  optional token appended to Civitai download URLs as ?token=
#   HF_TOKEN       optional Bearer token for gated Lightricks repos
set -e

LORA_DIR="${LORA_DIR:-/ComfyUI/models/loras}"
IC_SUBDIR="ltxv/ltx2"
IC_DIR="${LORA_DIR}/${IC_SUBDIR}"

DOWNLOADED=0
SKIPPED=0
FAILED=0

# download_one <url> <dest_dir> <filename>
download_one() {
    local url="$1"
    local dest_dir="$2"
    local filename="$3"
    local dest="${dest_dir}/${filename}"

    if [ -f "$dest" ]; then
        echo "[skip] ${filename} already present"
        SKIPPED=$((SKIPPED + 1))
        return 0
    fi

    mkdir -p "$dest_dir"

    # Quota probe: EDQUOT masks as ENOENT in wget on this pod.
    if ! dd if=/dev/zero of="${dest_dir}/.quota_test" bs=1M count=1 oflag=direct 2>/dev/null; then
        echo "[abort] disk quota probe failed for ${dest_dir}; cannot write (EDQUOT?). Aborting ${filename}"
        FAILED=$((FAILED + 1))
        return 1
    fi
    rm -f "${dest_dir}/.quota_test"

    # Append Civitai token if provided.
    local final_url="$url"
    if [ -n "${CIVITAI_TOKEN:-}" ] && [[ "$url" == *civitai.com* ]]; then
        final_url="${url}?token=${CIVITAI_TOKEN}"
    fi

    echo "[get]  ${filename} <- ${final_url}"
    local part="${dest}.part"
    local auth_header=()
    if [ -n "${HF_TOKEN:-}" ] && [[ "$url" == *huggingface.co* ]]; then
        auth_header=(--header "Authorization: Bearer ${HF_TOKEN}")
    fi

    if wget -q --show-progress -O "$part" "${auth_header[@]}" "$final_url"; then
        mv "$part" "$dest"
        echo "[ok]   ${filename}"
        DOWNLOADED=$((DOWNLOADED + 1))
    else
        echo "[fail] ${filename} (wget exit $?)"
        rm -f "$part"
        FAILED=$((FAILED + 1))
        return 1
    fi
}

echo "=== Envision gallery LoRA download ==="
echo "LORA_DIR=${LORA_DIR}"
echo "IC_DIR=${IC_DIR}"
echo

# ---------------------------------------------------------------------------
# Section A: style LoRAs (Civitai, loras root)
# ---------------------------------------------------------------------------
echo "--- Section A: style LoRAs ---"
download_one "https://civitai.com/api/download/models/2849716" "$LORA_DIR" "LTX2.3_Crisp_Enhance.safetensors" || true
download_one "https://civitai.com/api/download/models/2849706" "$LORA_DIR" "LTX2.3_Soft_Enhance.safetensors" || true
download_one "https://civitai.com/api/download/models/2855640" "$LORA_DIR" "Fantasy_Realism.safetensors" || true
download_one "https://civitai.com/api/download/models/2850271" "$LORA_DIR" "Pixar_Toon.safetensors" || true
download_one "https://civitai.com/api/download/models/2838795" "$LORA_DIR" "CozyFelt.safetensors" || true
download_one "https://civitai.com/api/download/models/2839415" "$LORA_DIR" "Claymation.safetensors" || true
download_one "https://civitai.com/api/download/models/2898537" "$LORA_DIR" "anime90s-step00053000.comfy.safetensors" || true
download_one "https://civitai.com/api/download/models/2844417" "$LORA_DIR" "AmateurHour_01_rank16.safetensors" || true
download_one "https://civitai.com/api/download/models/2868212" "$LORA_DIR" "phool-realism-ltx-2.3-v1.0.safetensors" || true
download_one "https://civitai.com/api/download/models/2931454" "$LORA_DIR" "FurryenhancerLTX2.3V4.094fused.safetensors" || true
download_one "https://civitai.com/api/download/models/3001143" "$LORA_DIR" "Singularity-LTX-2.3_OmniCine_V1.safetensors" || true

# ---------------------------------------------------------------------------
# Section B: official Lightricks IC-LoRAs (HF, ltxv/ltx2/)
# Triggers: Water-Simulation=ADD WATER, Colorization=COLORIZE confirmed.
# Day-To-Night, Instant-Shave, Cross-Eyed: TODO (repos gated, README not
# fetchable without auth; confirm trigger phrase from the HF repo README).
# ---------------------------------------------------------------------------
echo "--- Section B: official Lightricks IC-LoRAs ---"
download_one "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Water-Simulation/resolve/main/ltx-2.3-22b-ic-lora-water-simulation-0.9.safetensors" "$IC_DIR" "ltx-2.3-22b-ic-lora-water-simulation-0.9.safetensors" || true
download_one "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Day-To-Night/resolve/main/ltx-2.3-22b-ic-lora-day-to-night-0.9.safetensors" "$IC_DIR" "ltx-2.3-22b-ic-lora-day-to-night-0.9.safetensors" || true
download_one "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Instant-Shave/resolve/main/ltx-2.3-22b-ic-lora-instant-shave-0.9.safetensors" "$IC_DIR" "ltx-2.3-22b-ic-lora-instant-shave-0.9.safetensors" || true
download_one "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Cross-Eyed/resolve/main/ltx-2.3-22b-ic-lora-cross-eyed-0.9.safetensors" "$IC_DIR" "ltx-2.3-22b-ic-lora-cross-eyed-0.9.safetensors" || true
download_one "https://huggingface.co/Lightricks/LTX-2.3-22b-IC-LoRA-Colorization/resolve/main/ltx-2.3-22b-ic-lora-colorization-0.9.safetensors" "$IC_DIR" "ltx-2.3-22b-ic-lora-colorization-0.9.safetensors" || true

# ---------------------------------------------------------------------------
# Section B: community VFX IC-LoRAs (Civitai + HF Cseti, loras root)
# ---------------------------------------------------------------------------
echo "--- Section B: community VFX IC-LoRAs ---"
download_one "https://civitai.com/api/download/models/2909707" "$LORA_DIR" "LTX23_Obscura_Remova_v1.safetensors" || true
download_one "https://civitai.com/api/download/models/2869279" "$LORA_DIR" "ltx23_edit_anything_global_rank128_v1_9000steps_adamw.safetensors" || true
download_one "https://civitai.com/api/download/models/3068448" "$LORA_DIR" "LTX2.3-22B_IC-LoRA-Cameraman_v2_14000.safetensors" || true
download_one "https://huggingface.co/Cseti/LTX2.3-22B_IC-LoRA-CrossView-Prompt/resolve/main/LTX2.3-22B_IC-LoRA-CrossView-Prompt_v0.9_13700.safetensors" "$LORA_DIR" "LTX2.3-22B_IC-LoRA-CrossView-Prompt_v0.9_13700.safetensors" || true

echo
echo "=== Summary ==="
echo "downloaded: ${DOWNLOADED}"
echo "skipped:    ${SKIPPED}"
echo "failed:     ${FAILED}"
[ "$FAILED" -eq 0 ]