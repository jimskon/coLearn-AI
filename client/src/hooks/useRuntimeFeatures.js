import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../config';

const DEFAULT_RUNTIME_FEATURES = Object.freeze({
  remoteCpp: true,
  remotePython: true,
});

export default function useRuntimeFeatures() {
  const [features, setFeatures] = useState(DEFAULT_RUNTIME_FEATURES);
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

  return { features, loaded };
}
