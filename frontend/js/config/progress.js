// Open Studio: progress config re-keyed on pipeline stage names (no node IDs).
// ST5 finalizes per-stage progress display from stageName/stageIndex/stageTotal.

export const GENERATION_MESSAGES = [
    "Analyzing video content and structure",
    "Mapping visual features and patterns",
    "Generating new frame compositions",
    "Applying style transfer algorithms",
    "Refining generated frames",
    "Synthesizing audio with video",
    "Optimizing output quality"
];

// Stage-keyed progress descriptions (mirrors manifest stage names).
export const PROGRESS_CONFIG = {
    stages: [
        { stage: "prompt_prep", description: "Preparing prompt" },
        { stage: "generate", description: "Generating frames" },
        { stage: "detailer", description: "Adding details", condition: "features.detailer" },
        { stage: "upscale", description: "Upscaling resolution", condition: "features.upscaler" },
        { stage: "post", description: "Finalizing video" },
        { stage: "output", description: "Saving output" }
    ],
    preview: { frameLimit: { evolve: 16, default: 8 }, estimatedTime: "~5 min" },
    fullGeneration: { frameLimit: 0, estimatedTime: "~8 sec/frame" }
};

export const NOTIFICATIONS = {
    initialization: "Initializing AI models. <b>This step takes a while the first time</b>, but is faster in consecutive runs.",
    preview: "Generating preview. This takes about 5 minutes.",
    fullGeneration: "Generating full video. This takes about 8 seconds per frame.",
    completion: "Generation complete! Your video will be ready shortly.",
    error: "Something went wrong. Please try again.",
    expiry: "This video link will expire in 7 days",
    errors: {
        upload: "Error uploading file. Please try again.",
        generation: "Generation failed. Please try again.",
        network: "Network error. Please check your connection.",
        timeout: "Operation timed out. Please try again."
    }
};
