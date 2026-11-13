import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';

const DEFAULT_RUNTIME_FEATURES = Object.freeze({
  remoteCpp: true,
  remotePython: true,
});

// Used only until /api/runtime/config answers, and if it never does. The
// server is the authority on the deployment default.
const DEFAULT_RUNTIME_DEFAULTS = Object.freeze({
  language: 'English',
});

// AI model menus (AI_BLOCK_MODELS, CREATOR_MODELS in server/.env; the first of
// each is the default). Empty until the server answers: menus then offer only
// "default", and the server picks the model.
const DEFAULT_RUNTIME_MODELS = Object.freeze({
  aiBlock: [],
  creator: [],
});

/**
 * Menu options for a model list from the server. '' stands for the default
 * (the list's first model), so a saved choice never names a model that may be
 * retired later. A current value no longer in the list is shown as such; the
 * server uses the default for it.
 */
export function modelMenuOptions(list = [], current = '') {
  const options = [{ value: '', label: list[0] ? `${list[0]} (default)` : 'Default model' }];
  for (const model of list.slice(1)) options.push({ value: model, label: model });
  const value = String(current || '').trim();
  if (value && !options.some((option) => option.value === value)) {
    options.push({
      value,
      label: list.includes(value) ? value : `${value} (no longer available; the default is used)`,
    });
  }
  return options;
}

export default function useRuntimeFeatures() {
  const [features, setFeatures] = useState(DEFAULT_RUNTIME_FEATURES);
  const [defaults, setDefaults] = useState(DEFAULT_RUNTIME_DEFAULTS);
  const [models, setModels] = useState(DEFAULT_RUNTIME_MODELS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/runtime/config`, {
          credentials: 'include',
        });

        if (!res.ok) {
          throw new Error(`runtime config fetch failed ${res.status}`);
        }

        const body = await res.json();
        if (!cancelled) {
          setFeatures({
            ...DEFAULT_RUNTIME_FEATURES,
            ...(body?.features || {}),
          });
          setDefaults({
            ...DEFAULT_RUNTIME_DEFAULTS,
            ...(body?.defaults || {}),
          });
          setModels({
            aiBlock: Array.isArray(body?.models?.aiBlock) ? body.models.aiBlock : [],
            creator: Array.isArray(body?.models?.creator) ? body.models.creator : [],
          });
        }
      } catch (err) {
        console.warn('[runtime-features] Falling back to defaults', err);
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { features, defaults, models, loaded };
}
