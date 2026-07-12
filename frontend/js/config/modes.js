// Contributor modes come from modes.json (Build Mode writes there; a rebuild
// is required for changes to appear). Built-in modes below take priority and
// are left untouched, so existing modes render byte-identical.
import contributorModes from './modes.json';

export const DEFAULT_MODE = 'forge';
// Mode Definitions
export const MODE = {
    trace: {
        title: "Trace",
        description: "Refine and style your video while keeping its essence"
    },
    evolve: {
        title: "Evolve",
        description: "Radically modify your video"
    },
    forge: {
        title: "Forge",
        description: "Create a new video, built on your chosen foundation",
        subModes: {
            envision: {
                title: "Envision",
                description: "Generate a new video from your prompt and reference inputs",
                isDefault: true
            },
            reconstruct: {
                title: "Reconstruct",
                description: "Takes the core of the video and builds a new video using that information",
                isDefault: false
            },
            inspire: {
                title: "Inspire",
                description: "Only 'inspired' by the input video to create the new video from scratch",
                isDefault: false
            }
        }
    }
};

// Merge contributor modes from modes.json. A modes.json entry whose key is
// already a built-in is skipped, so built-in mode objects (and their
// subModes) are never replaced. New keys get { title, description } mapped
// from the entry's label/description, the property names MODE consumers use.
for (const entry of contributorModes) {
    if (entry && entry.key && !MODE[entry.key]) {
        MODE[entry.key] = { title: entry.label, description: entry.description };
    }
}

/**
 * Get the current mode name as a string
 * @returns {string} The current mode name in lowercase
 */
export function getCurrentModeName() {
    // First check if the mode is in the query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const modeParam = urlParams.get('mode');
    if (modeParam) {
        return modeParam.toLowerCase();
    }
    
    // Fall back to the original path-based detection
    const path = window.location.pathname;
    const modeName = path.split('/').pop().replace(/\.html?$/i, '').toLowerCase();
    
    // Only return if it matches a known mode, otherwise use default
    if (modeName && MODE[modeName]) {
        return modeName;
    }
    return DEFAULT_MODE;
}
