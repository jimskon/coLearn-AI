// src/hooks/usePageLogger.js
import { useEffect } from 'react';
export default function usePageLogger(name) {
  useEffect(() => {
    console.log(`📘 Page mounted: ${name}`);
  }, [name]);
}
