// =============================================================================
// Open Studio app boot (ST5)
// Slim, node-free boot: render data-driven controls + mode picker from
// controls/*.json + modes.json into the existing DOM mount points, seed the
// generation store, and wire upload + generate buttons. No graph, no NODE map,
// no per-feature module imports. Auth/session/theme/upload remain COPY-tier.
// =============================================================================

import { DEBUG_MODE } from '../config/index.js';
import { createLogger } from '../utils/logger.js';
import { initializeDebugIndicator } from '../ui/debug-indicator.js';
import { handleFileUpload } from '../ui/uploads.js';
import { initializeTheme } from '../ui/theme.js';
import { initializeProgressTracking } from '../ui/progress.js';
import { setupHelperText, toggleHint } from '../ui/helpers.js';
import { renderControls } from './controls-renderer.js';
import { handleGeneration } from '../features/generation/lifecycle.js';
import { initBuildMode } from '../build/build-mode.js';
import * as state from './state.js';
import * as store from './generation-store.js';
import { initializeFeatureWarnings } from '../ui/feature-warnings.js';

const logDebug = createLogger('App');

// Mount point ids the renderer injects into. If the index.html markup does not
// yet expose them (COPY-tier markup is being finalized in ST6), create a
// fallback container so controls still render and the data flow works.
const CONTROLS_MOUNT_ID = 'osControls';

function ensureMount(id) {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    const host = document.querySelector('.dashboard') || document.querySelector('main') || document.body;
    host.appendChild(el);
    logDebug(`Created fallback mount #${id}`);
    return el;
}

export class VidiaApp {
    constructor() {
        this.elements = null;
        this.init();
    }

    async init() {
        try {
            this.initializeElements();

            // Render the mode picker + controls from manifests; the renderer
            // seeds the generation store with control defaults + the method.
            ensureMount(CONTROLS_MOUNT_ID);
            await renderControls({
                controlsContainerId: CONTROLS_MOUNT_ID,
            });

            this.initializePromptArea();
            this.setupEventBindings();
            this.initializeFeatures();

            logDebug('App initialized successfully');
        } catch (error) {
            console.error('Error during initialization:', error);
            import('../ui/helpers.js').then(module => {
                module.showErrorNotification(error.message);
            });
            if (this.elements && this.elements.helperText) {
                this.elements.helperText.innerHTML = error.message;
            }
        }
    }

    initializeElements() {
        this.elements = {
            uploadArea: document.getElementById('uploadArea'),
            fileUpload: document.getElementById('fileUpload'),
            resultArea: document.getElementById('resultArea'),
            previewButton: document.getElementById('previewButton'),
            fullGenerationButton: document.getElementById('fullGenerationButton'),
            estimatedCost: document.getElementById('estimatedCost'),
            helperText: document.getElementById('helperText'),
        };
        logDebug('DOM elements initialized');
    }

    /**
     * Wire prod's .prompt-area inputs into the generation store. Subject +
     * background build the combined prompt (prod combinedPrompt shape); style
     * and the auto-improve / replace-audio toggles ride along as params.
     * @returns {void}
     */
    initializePromptArea() {
        const subject = document.getElementById('mediumSubject');
        const background = document.getElementById('background');
        const style = document.getElementById('style');
        const autoImprove = document.getElementById('autoImproveToggle');
        const replaceAudio = document.getElementById('replaceAudioToggle');
        if (!subject) return;
        const sync = () => {
            const bg = background?.value?.trim();
            const prompt = bg ? `${subject.value}, ${bg} in the background` : subject.value;
            store.setParam('prompt', prompt);
            if (style?.value) store.setParam('style', style.value);
            store.setParam('auto_improve', !!autoImprove?.checked);
            // Prompt enhancement is a worker feature gate (manifest prompt_prep
            // stage, feature:"promptEnhance"); the prompt-area toggle drives it.
            store.setFeature('promptEnhance', !!autoImprove?.checked);
            // Sound generation is a worker feature gate (manifest audio stage,
            // feature:"genAudio"); the prompt-area toggle drives it, mirroring
            // prod's single sound-gen toggle. No advanced-panel duplicate.
            store.setFeature('genAudio', !!replaceAudio?.checked);
        };
        subject.addEventListener('input', sync);
        background?.addEventListener('input', sync);
        style?.addEventListener('change', sync);
        autoImprove?.addEventListener('change', sync);
        replaceAudio?.addEventListener('change', sync);
        sync();
        logDebug('Prompt area wired to generation store');
    }

    setupEventBindings() {
        const { uploadArea, fileUpload, previewButton, fullGenerationButton } = this.elements;

        // File upload (COPY-tier upload flow populates params.files.* on submit).
        if (uploadArea && fileUpload) {
            uploadArea.addEventListener('click', () => fileUpload.click());
            fileUpload.addEventListener('change', async (event) => {
                await handleFileUpload(event, {
                    uploadArea,
                    spinner: uploadArea.querySelector('.spinner'),
                    uploadIcon: uploadArea.querySelector('.upload-icon'),
                    checkmarkIcon: uploadArea.querySelector('.checkmark-icon'),
                });
            });
        }

        // Generation handlers.
        if (previewButton) previewButton.addEventListener('click', () => this.handleGeneration('preview'));
        if (fullGenerationButton) fullGenerationButton.addEventListener('click', () => this.handleGeneration('full'));

        // Navigation: "More Options" scrolls to the advanced panel, "Go back"
        // returns to the top (prod app.js smoothScroll on these anchors).
        const advancedButton = document.getElementById('advancedButton');
        const goBackButton = document.getElementById('goBackButton');
        if (advancedButton) advancedButton.addEventListener('click', (e) => {
            e.preventDefault();
            document.getElementById('advanced')?.scrollIntoView({ behavior: 'smooth' });
        });
        if (goBackButton) goBackButton.addEventListener('click', (e) => {
            e.preventDefault();
            // The dashboard scrolls inside an overflow container, not the
            // window, so window.scrollTo is a no-op there. Scrolling the
            // topmost element into view works for both scroll models.
            const top = document.querySelector('.mode-back') || document.body;
            top.scrollIntoView({ behavior: 'smooth', block: 'start' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        // Hint icons: one delegated click handler covers both manifest-rendered
        // controls and the static prompt-area (prod js/ui/hints.js toggleHint).
        document.addEventListener('click', (e) => {
            if (e.target.classList?.contains('hint-icon')) toggleHint(e);
        });

        logDebug('Event bindings set up');
    }

    initializeFeatures() {
        initializeTheme();
        initializeDebugIndicator();
        initializeProgressTracking();
        // Prod helper-text system: data-helper elements drive #helperText on
        // hover/focus (messages from js/config/helper-messages.js).
        window.helperSystem = setupHelperText(
            this.elements.helperText,
            document.querySelectorAll('[data-helper]')
        );
        // Incompatible-feature warnings (prod parity); reads the generation
        // store and anchors warnings under the relevant manifest controls.
        initializeFeatureWarnings();
        initBuildMode();   // local-mode-only contributor editor (ST7); no-op otherwise
        logDebug('Features initialized');
    }

    async handleGeneration(type) {
        const { showErrorNotification } = await import('../ui/helpers.js');
        const cost = parseInt(this.elements.estimatedCost?.textContent || '0', 10) || 0;
        try {
            await handleGeneration(type, { cost });
        } catch (error) {
            console.error(`Error during ${type} generation:`, error);
            showErrorNotification(error.message);
            if (this.elements.helperText) this.elements.helperText.innerHTML = error.message;
        }
    }
}
