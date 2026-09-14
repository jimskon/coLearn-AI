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

export default function useRuntimeFeatures() {
  const [features, setFeatures] = useState(DEFAULT_RUNTIME_FEATURES);
  const [defaults, setDefaults] = useState(DEFAULT_RUNTIME_DEFAULTS);
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

  return { features, defaults, loaded };
}
