// Open Studio: this module no longer fetches or mutates a node graph. It builds
// the semantic params payload (plan section 3) the handler assembles into a
// pipeline. No node IDs, no graph fetch, no graph send.
import { createLogger } from '../utils/logger.js';
import { getSession } from '../session.js';
import * as store from './generation-store.js';

const logDebug = createLogger('Workflow');

// Scalar params that ride in the payload even when no {param} tag drives them
// (plan section 3 schema). cfg/aspect have no workflow tag today; tag-backed
// keys (seed, steps, denoise, frame_divider, ...) are overlaid from controls.
const SCALAR_DEFAULTS = {
  method: 'forge',
  prompt: '', negative_prompt: '',
  seed: -1, steps: 20, cfg: 6.0, denoise: 0.7,
  aspect: '16:9', frame_divider: 2,
};

// Mint the canonical generation id (plan 10.1): gen_<timestamp>_<random>.
export function mintGenerationId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `gen_${Date.now()}_${rand}`;
}

// Build the request payload from the controls store + uploaded file slots.
// Returns { generation_id, user_id, params:{...} } (plan section 3).
export function buildParams(generationId) {
  const generation_id = generationId || mintGenerationId();
  const user_id = getSession()?.user?.userId || null;

  const method = store.getMethod();
  const controlValues = store.getParams();
  const features = store.getFeatures();
  const files = store.getFiles();

  const params = { ...SCALAR_DEFAULTS, ...controlValues, method, features, files };

  logDebug('Built params payload', { generation_id, method,
    paramKeys: Object.keys(controlValues), features, fileSlots: Object.keys(files) });

  return { generation_id, user_id, params };
}
