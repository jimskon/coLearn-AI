import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseButton } from 'react-bootstrap';

export default function InfoBubble({
  info = null,
  message = '',
  seconds = 8,
  showKey = '',
  dismissKey = '',
  anchorRef = null,
  placement = 'top',
  dismissOnTargetInput = false,
  className = '',
  onDismiss,
}) {
  const resolvedMessage = String(info?.message ?? message ?? '').trim();
  const resolvedSeconds = useMemo(() => {
    const raw = info?.seconds ?? seconds;
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }, [info?.seconds, seconds]);

  const resolvedShowKey = showKey || dismissKey || `${resolvedMessage}:${resolvedSeconds}`;

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState(null);
  const timersRef = useRef({ show: null, hide: null, unmount: null });
  const dismissedRef = useRef(false);

  const clearTimers = () => {
    const timers = timersRef.current;
    if (timers.show) window.clearTimeout(timers.show);
    if (timers.hide) window.clearTimeout(timers.hide);
    if (timers.unmount) window.clearTimeout(timers.unmount);
    timers.show = null;
    timers.hide = null;
    timers.unmount = null;
  };

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearTimers();
    setVisible(false);
    timersRef.current.unmount = window.setTimeout(() => {
      setMounted(false);
      onDismiss?.();
    }, 180);
  };

  useEffect(() => {
    dismissedRef.current = false;
    clearTimers();
    setMounted(false);
    setVisible(false);
    setPosition(null);

    if (!resolvedMessage) return undefined;

    timersRef.current.show = window.setTimeout(() => {
      if (dismissedRef.current) return;
      setMounted(true);
      window.requestAnimationFrame(() => {
        if (!dismissedRef.current) setVisible(true);
      });
    }, 1000);

    timersRef.current.hide = window.setTimeout(() => {
      dismiss();
    }, 1000 + resolvedSeconds * 1000);

    return () => {
      clearTimers();
    };
  }, [resolvedShowKey, resolvedMessage, resolvedSeconds]);

  useEffect(() => {
    if (!mounted) return undefined;

    const updatePosition = () => {
      const node = anchorRef?.current;
      const anchor = node?.getBoundingClientRect?.();
      const bubbleWidth = Math.min(360, Math.max(240, window.innerWidth - 24));
      const leftBase = anchor ? anchor.left : 24;
      const topBase = anchor ? anchor.top : 24;
      const bottomBase = anchor ? anchor.bottom : 48;
      let nextPlacement = placement === 'bottom' ? 'bottom' : 'top';
      let top = nextPlacement === 'bottom' ? bottomBase + 12 : topBase - 12;

      if (nextPlacement === 'top' && top < 12) {
        nextPlacement = 'bottom';
        top = bottomBase + 12;
      }

      const maxLeft = Math.max(12, window.innerWidth - bubbleWidth - 12);
      const left = Math.max(12, Math.min(leftBase, maxLeft));

      setPosition({
        top,
        left,
        width: bubbleWidth,
        placement: nextPlacement,
      });
    };

    updatePosition();
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [mounted, anchorRef, placement]);

  useEffect(() => {
    if (!dismissOnTargetInput) return undefined;
    const node = anchorRef?.current;
    if (!node?.addEventListener) return undefined;

    const handleInput = () => dismiss();
    node.addEventListener('input', handleInput);
    node.addEventListener('change', handleInput);
    node.addEventListener('paste', handleInput);

    return () => {
      node.removeEventListener('input', handleInput);
      node.removeEventListener('change', handleInput);
      node.removeEventListener('paste', handleInput);
    };
  }, [dismissOnTargetInput, anchorRef]);

  if (!mounted || !resolvedMessage || !position) return null;

  const outerStyle = {
    position: 'fixed',
    top: `${position.top}px`,
    left: `${position.left}px`,
    width: `${position.width}px`,
    zIndex: 2000,
    pointerEvents: 'none',
  };

  const bubbleStyle = {
    position: 'relative',
    pointerEvents: 'auto',
    background: '#e9f8ff',
    border: '1px solid #7ad4ea',
    borderRadius: 14,
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.18)',
    padding: '0.7rem 2rem 0.7rem 0.85rem',
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.98)',
    transition: 'opacity 180ms ease, transform 180ms ease',
    color: '#17313b',
  };

  const arrowStyle = {
    position: 'absolute',
    left: 24,
    width: 0,
    height: 0,
    borderLeft: '9px solid transparent',
    borderRight: '9px solid transparent',
  };

  const isTopPlacement = position.placement !== 'bottom';
  const arrowPlacementStyle = isTopPlacement
    ? {
        bottom: -9,
        borderTop: '9px solid #7ad4ea',
      }
    : {
        top: -9,
        borderBottom: '9px solid #7ad4ea',
      };

  return createPortal(
    <div style={outerStyle} className={className}>
      <div style={bubbleStyle} role="status" aria-live="polite">
        <div className="d-flex align-items-start gap-2">
          <span
            className="badge text-dark"
            style={{ background: '#bdefff', border: '1px solid #7ad4ea' }}
          >
            Info
          </span>
          <div
            className="flex-grow-1 small"
            style={{ lineHeight: 1.35 }}
            dangerouslySetInnerHTML={{ __html: resolvedMessage }}
          />
          <CloseButton
            aria-label="Dismiss info bubble"
            onClick={dismiss}
          />
        </div>
        <div style={{ ...arrowStyle, ...arrowPlacementStyle }} />
      </div>
    </div>,
    document.body
  );
}
