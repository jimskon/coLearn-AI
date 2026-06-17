import React, { useEffect, useRef, useState } from 'react';
import { Alert, CloseButton } from 'react-bootstrap';

export default function InfoBubble({
  message = '',
  seconds = 8,
  dismissKey = '',
  className = '',
  onDismiss,
}) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef(null);
  const lastDismissKeyRef = useRef(dismissKey);

  useEffect(() => {
    if (lastDismissKeyRef.current !== dismissKey) {
      lastDismissKeyRef.current = dismissKey;
      setVisible(false);
      return;
    }
  }, [dismissKey]);

  useEffect(() => {
    if (!visible) return undefined;

    const timeoutMs = Number.isFinite(Number(seconds)) && Number(seconds) > 0
      ? Number(seconds) * 1000
      : 8000;

    timerRef.current = window.setTimeout(() => {
      setVisible(false);
      onDismiss?.();
    }, timeoutMs);

    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [visible, seconds, message, onDismiss]);

  if (!visible || !message) return null;

  return (
    <Alert
      variant="info"
      className={`py-2 px-3 mb-2 border-info-subtle bg-info-subtle shadow-sm ${className}`.trim()}
    >
      <div className="d-flex align-items-start gap-2">
        <span className="badge bg-info text-dark mt-1">Info</span>
        <div className="flex-grow-1 small" dangerouslySetInnerHTML={{ __html: message }} />
        <CloseButton
          aria-label="Dismiss info bubble"
          onClick={() => {
            setVisible(false);
            onDismiss?.();
          }}
        />
      </div>
    </Alert>
  );
}
