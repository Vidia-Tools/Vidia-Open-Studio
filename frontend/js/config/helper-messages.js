// Message Store - All Dynamic UI Text
export const MESSAGES = {
    // Helper Text (appears in prompt-helper area)
    HELPER: {
        DEFAULT: "Closeup, focused videos work best. Your prompt should generally describe your uploaded video with the desired changes",
        
        UPLOAD: {
            DEFAULT: "Upload your video (<b>Up to 30 seconds supported, but 5 second clips are recommended. MP4 or MOV format only. 150MB limit</b>)",
            FILE_SELECTED: (filename) => `File selected: ${filename}`,
            UPLOADING: "Uploading file to server...",
            STORING: "Preparing file...",
            FORMAT_ERROR: "Unsupported format. Only MP4 and MOV video files are allowed.",
            SIZE_ERROR: "File too large. Maximum size is 150MB.",
            ERROR: "Error uploading file. Please try again."
        },
        
        PROMPT: {
            MAIN: "This is your <b>main prompt</b>: Use it to describe what you want the subject of your video to transform into. <em>Example: If you upload a video of someone playing soccer and then prompt 'A fuzzy teddy bear playing soccer', then the player will turn into a teddy bear.</em>",
            BACKGROUND: "Your <b>background prompt</b>: The system will try to modify the background of your video using this prompt, but small changes are recommended. It is not advised to attempt a full background replacement.",
            AUTO_IMPROVE: {
                ENABLED: "<b>Prompt enhancement is ON.</b> Your prompt will be enhanced by AI to create better results.",
                DISABLED: (count) => `<b>Prompt enhancement is OFF.</b> Your prompt will be used exactly as is. It has ${count}/225 tokens.`
            },
            TOKEN: {
                WARNING: (count) => `Warning: Your prompt has ${count}/225 tokens. Exceeding the token limit may cause errors.`,
                COUNT: (count) => `Your prompt has ${count}/225 tokens.`
            }
        },

        STYLE: {
            SELECT: "Choose the visual style for your generated video"
        },
        
        LORA: {
            SELECTED: (displayName) => `Selected LoRA: ${displayName}. Adjust strength as needed.`,
            DESELECTED: "LoRA deselected."
        },
        
        GENERATION: {
            PHASES: [
                "Analyzing video content and structure",
                "Mapping visual features and patterns",
                "Generating new frame compositions",
                "Applying style transfer algorithms",
                "Refining generated frames",
                "Synthesizing audio with video",
                "Optimizing output quality"
            ],
            INITIALIZING: "Initializing AI models. <b>This step takes a while the first time</b>, but is faster in consecutive runs.",
            FINALIZING: "Finalizing video reconstruction",
            RESULT_READY: "Click to download or view the generated video",
            UPLOADING_FILES: "Uploading files before generation...",
            UPLOADING_VIDEO: "Uploading video file...",
            UPLOADING_STYLE: "Uploading style image...",
            UPLOADING_FACE: "Uploading face image..."
        },
        SOUND_GEN_TOGGLE: {
            ENABLED: "<b>Sound Generation is ON.</b> A soundscape matching your prompt will be generated with your video.",
            DISABLED: "<b>Sound Generation is OFF.</b> No sound will be generated."
        }
    },

    // Notifications (appears in result notification box)
    NOTIFICATION: {
        GENERATION_TIME: "Previews: ~5 min. Full: ~8 sec/video frame.",
        VIDEO_EXPIRY: "This video link will expire in 7 days",
        ERROR: {
            WORKFLOW: "Something went wrong. Please try again.",
            CONNECTION: "Connection error. Please try again.",
            CONNECTION_LOST: "Connection lost. Please refresh the page.",
            INSUFFICIENT_CREDITS: "Insufficient credits. Please top up.",
            NO_VIDEO: "Please select a video file first.",
            NO_STYLE: "Please select a style.",
            VIDEO_LOAD_ERROR: "Error loading the generated video. Don't worry, we've refunded your credits. Please contact support in our Discord for assistance."
        }
    },

    // Button Text (appears on buttons)
    BUTTON: {
        MORE_OPTIONS: [
            "More Options",
            "Transfer styles",
            "Replace faces",
            "Add effects",
            "Change quality",
            "Add details",
            "Upscale"
        ],
        LORA: {
            SELECT: "Select Effect",
            CHANGE: "Change Effect"
        },
        GENERATION: {
            PREVIEW: "Preview",
            FULL: "Full Generation",
            DISABLED: "Processing..."
        },
        TOGGLE: {
            ON: "On",
            OFF: "Off"
        }
    }
};
