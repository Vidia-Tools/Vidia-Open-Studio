# Stage 1: Base image with common dependencies
FROM nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04 AS base

# Prevents prompts from packages asking for user input during installation
ENV DEBIAN_FRONTEND=noninteractive
# Prefer binary wheels over source distributions for faster pip installations
ENV PIP_PREFER_BINARY=1
# Ensures output from python is printed immediately to the terminal without buffering
ENV PYTHONUNBUFFERED=1
# Speed up some cmake builds
ENV CMAKE_BUILD_PARALLEL_LEVEL=8
# Install Python, git and other necessary tools
RUN apt-get update && apt-get install -y \
    python3.10 \
    python3-pip \
    python3.10-dev \
    build-essential \
    git \
    wget \
    curl \
    psmisc \
    ffmpeg \
    ninja-build \
    libglib2.0-0 \
    libgl1-mesa-glx \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    patch \
    && ln -sf /usr/bin/python3.10 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip

# Clean up to reduce image size
RUN apt-get autoremove -y && apt-get clean -y && rm -rf /var/lib/apt/lists/*

# Install ComfyUI v0.25.1 via direct git clone (no comfy-cli).
# Explicit CUDA torch wheel is required: a bare `pip install -r requirements.txt`
# may pull CPU-only torch. The Blackwell runtime patch in start.sh reinstalls
# torch nightly cu128 for B200/B100, so the base only needs cu118 for non-Blackwell.
RUN pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118 && \
    git clone https://github.com/Comfy-Org/ComfyUI.git /ComfyUI && \
    cd /ComfyUI && git checkout v0.25.1 && \
    pip install -r requirements.txt

# Install runpod and our requirements
COPY worker/requirements.txt ./
# runpod 1.3.6 pins aiohttp<3.9, which downgrades the aiohttp 3.10+ that ComfyUI
# v0.25.1 requires (server.py imports AppKey from aiohttp.helpers, a 3.10+ API).
# Re-pin aiohttp after runpod so the baked version is 3.14.1; otherwise
# ComfyUI-Manager upgrades it in-place at first boot and corrupts the install.
RUN pip install runpod requests && \
    pip install --no-cache-dir -r requirements.txt && \
    pip install "aiohttp==3.14.1" && \
    wget https://github.com/oobabooga/llama-cpp-python-cuBLAS-wheels/releases/download/textgen-webui/llama_cpp_python_cuda-0.2.89+cu121-cp310-cp310-linux_x86_64.whl && \
    pip install llama_cpp_python_cuda-0.2.89+cu121-cp310-cp310-linux_x86_64.whl && \
    rm llama_cpp_python_cuda-0.2.89+cu121-cp310-cp310-linux_x86_64.whl

# Go back to the root
WORKDIR /

# Handler, pipeline engine, patches, workflows, and the self-update boot chain.
# updater.sh -> bootstrap.sh -> start.sh refresh their embedded copies from the
# monorepo at boot (env-configurable URLs); if the clone fails they fall back to
# the scripts baked in here. The vidia-open-studio-node is cloned at runtime by
# start.sh (no vendor/ directory).
COPY worker/src/ /src/
COPY worker/patches/ /patches/
COPY workflows/ /workflows/
COPY worker/updater.sh /updater.sh
COPY worker/bootstrap.sh /bootstrap.sh
ENV WORKFLOWS_BASE=/
RUN chmod +x /src/start.sh /updater.sh /bootstrap.sh

# Expose ports for ComfyUI, Jupyter, and web terminal
EXPOSE 3000 8888 22

CMD ["/updater.sh"]
