import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CloseButton } from 'react-bootstrap';
import { normalizeInfoBubbleTarget } from '../../utils/infoBubbleSession';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function computeInfoBubblePosition(anchorRect, bubbleRect) {
  const margin = 12;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  const bubbleW = bubbleRect?.width || 280;
  const bubbleH = bubbleRect?.height || 120;

  if (anchorRect?.right + margin + bubbleW < viewportW) {
    return {
      placement: 'right',
      top: clamp(
        anchorRect.top + anchorRect.height / 2 - bubbleH / 2,
        margin,
        viewportH - bubbleH - margin
      ),
      left: anchorRect.right + margin,
      width: bubbleW,
    };
  }

  if (anchorRect?.bottom + margin + bubbleH < viewportH) {
    return {
      placement: 'bottom',
      top: anchorRect.bottom + margin,
      left: clamp(anchorRect.left, margin, viewportW - bubbleW - margin),
      width: bubbleW,
    };
  }

  if (anchorRect?.top - margin - bubbleH > margin) {
    return {
      placement: 'top',
      top: anchorRect.top - margin - bubbleH,
      left: clamp(anchorRect.left, margin, viewportW - bubbleW - margin),
      width: bubbleW,
    };
  }

  return {
    placement: 'floating',
    top: viewportH - bubbleH - 24,
    left: viewportW - bubbleW - 24,
    width: bubbleW,
  };
}

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
  infoBubbleSession = null,
  onDismiss,
}) {
  const resolvedMessage = String(info?.message ?? message ?? '').trim();
  const resolvedSeconds = useMemo(() => {
    const raw = info?.seconds ?? seconds;
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    return Number.isFinite(n) && n > 0 ? n : 8;
  }, [info?.seconds, seconds]);
  const resolvedTarget = normalizeInfoBubbleTarget(info?.target);
  const resolvedShowKey = showKey || dismissKey || `${resolvedTarget}:${resolvedMessage}:${resolvedSeconds}`;

  const bubbleRef = useRef(null);
  const timersRef = useRef({ show: null, hide: null, unmount: null });
  const dragStateRef = useRef(null);
  const manualPositionRef = useRef(null);
  const dismissedRef = useRef(false);
  const unregisterRef = useRef(null);
  const [isCurrent, setIsCurrent] = useState(false);
  const [shouldRender, setShouldRender] = useState(false);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  const clearTimers = () => {
    const timers = timersRef.current;
    if (timers.show) window.clearTimeout(timers.show);
    if (timers.hide) window.clearTimeout(timers.hide);
    if (timers.unmount) window.clearTimeout(timers.unmount);
    timers.show = null;
    timers.hide = null;
    timers.unmount = null;
  };

  const markSeen = () => {
    infoBubbleSession?.markTargetSeen?.(resolvedTarget);
  };

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    clearTimers();
    setVisible(false);
    setShouldRender(false);
    setPosition(null);
    infoBubbleSession?.dismissCandidate?.(resolvedShowKey);
    unregisterRef.current?.();
    unregisterRef.current = null;
    markSeen();
    timersRef.current.unmount = window.setTimeout(() => {
      onDismiss?.();
    }, 180);
  };

  useEffect(() => {
    dismissedRef.current = false;
    clearTimers();
    setShouldRender(false);
    setVisible(false);
    setPosition(null);
    dragStateRef.current = null;
    manualPositionRef.current = null;
    setIsDragging(false);
    setIsCurrent(false);

    if (!resolvedMessage || !resolvedTarget || !infoBubbleSession) return undefined;

    const unregister = infoBubbleSession.registerCandidate?.({
      key: resolvedShowKey,
      target: resolvedTarget,
    });
    unregisterRef.current = unregister;

    const syncCurrent = () => {
      const activeKey = infoBubbleSession.getActiveKey?.();
      setIsCurrent(activeKey === resolvedShowKey);
    };

    const unsubscribe = infoBubbleSession.subscribe?.(syncCurrent);
    syncCurrent();

    return () => {
      clearTimers();
      unsubscribe?.();
      unregister?.();
      unregisterRef.current = null;
    };
  }, [infoBubbleSession, resolvedMessage, resolvedShowKey, resolvedTarget]);

  useEffect(() => {
    if (!isCurrent || dismissedRef.current) {
      clearTimers();
      setVisible(false);
      setShouldRender(false);
      return undefined;
    }

    clearTimers();
    setShouldRender(false);
    setVisible(false);
    setPosition(null);

    timersRef.current.show = window.setTimeout(() => {
      if (dismissedRef.current) return;
      if (infoBubbleSession?.getActiveKey?.() !== resolvedShowKey) return;
      setShouldRender(true);
      window.requestAnimationFrame(() => {
        if (dismissedRef.current) return;
        if (infoBubbleSession?.getActiveKey?.() !== resolvedShowKey) return;
        infoBubbleSession?.lockCandidate?.(resolvedShowKey);
        setVisible(true);
      });
    }, 1000);

    timersRef.current.hide = window.setTimeout(() => {
      dismiss();
    }, 1000 + resolvedSeconds * 1000);

    return () => {
      clearTimers();
    };
  }, [infoBubbleSession, isCurrent, resolvedSeconds, resolvedShowKey]);

  useEffect(() => {
    if (!shouldRender || !visible || !bubbleRef.current) return undefined;

    const updatePosition = () => {
      if (!bubbleRef.current) return;

      const node = anchorRef?.current;
      const anchorRect = node?.getBoundingClientRect?.();
      const bubbleRect = bubbleRef.current.getBoundingClientRect?.();
      const mobile = window.innerWidth < 640;

      if (mobile) {
        const width = Math.max(0, window.innerWidth - 24);
        const left = 12;
        const top = Math.max(12, window.innerHeight - (bubbleRect?.height || 120) - 24);
        setPosition({
          placement: 'floating',
          top,
          left,
          width,
        });
        return;
      }

      const computed = computeInfoBubblePosition(anchorRect, bubbleRect);
      setPosition(computed);
    };

    updatePosition();
    const handleScrollOrResize = () => updatePosition();
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [anchorRef, shouldRender, visible]);

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

  useEffect(() => {
    if (!isDragging) return undefined;

    const handlePointerMove = (event) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      const nextLeft = event.clientX - state.offsetX;
      const nextTop = event.clientY - state.offsetY;
      const nextPosition = {
        placement: manualPositionRef.current?.placement || position?.placement || 'floating',
        top: clamp(nextTop, 12, Math.max(12, window.innerHeight - state.height - 12)),
        left: clamp(nextLeft, 12, Math.max(12, window.innerWidth - state.width - 12)),
        width: state.width,
      };
      manualPositionRef.current = nextPosition;
      setPosition(nextPosition);
    };

    const handlePointerUp = (event) => {
      const state = dragStateRef.current;
      if (!state || event.pointerId !== state.pointerId) return;
      dragStateRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [isDragging, position?.placement]);

  if (!shouldRender || !resolvedMessage) return null;

  const outerStyle = {
    position: 'fixed',
    top: position?.top != null ? `${position.top}px` : '12px',
    left: position?.left != null ? `${position.left}px` : '12px',
    right: position?.right != null ? `${position.right}px` : undefined,
    bottom: position?.bottom != null ? `${position.bottom}px` : undefined,
    width: position?.width != null ? `${position.width}px` : '280px',
    zIndex: 2000,
    pointerEvents: 'none',
    visibility: position ? 'visible' : 'hidden',
  };

  const bubbleStyle = {
    position: 'relative',
    pointerEvents: 'auto',
    background: '#eef9ff',
    border: '1px solid #79d2ea',
    borderRadius: 14,
    boxShadow: '0 10px 24px rgba(0, 0, 0, 0.16)',
    padding: '0.65rem 1.9rem 0.7rem 0.8rem',
    maxWidth: 280,
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0) scale(1)' : 'translateY(6px) scale(0.98)',
    transition: 'opacity 180ms ease, transform 180ms ease',
    color: '#17313b',
  };

  const arrowStyle = {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeft: '8px solid transparent',
    borderRight: '8px solid transparent',
  };

  const arrowPlacement = position?.placement || 'floating';

  const arrowPlacementStyle = arrowPlacement === 'bottom'
    ? {
        top: -8,
        left: 24,
        borderBottom: '8px solid #79d2ea',
      }
    : arrowPlacement === 'top'
      ? {
          bottom: -8,
          left: 24,
          borderTop: '8px solid #79d2ea',
        }
      : arrowPlacement === 'right'
        ? {
            left: -8,
            top: 18,
            borderRight: '8px solid #79d2ea',
          }
        : null;

  const startDrag = (event) => {
    if (window.innerWidth < 640) return;
    if (!bubbleRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = bubbleRef.current.getBoundingClientRect();
    manualPositionRef.current = {
      placement: position?.placement || 'floating',
      top: rect.top,
      left: rect.left,
      width: rect.width,
    };
    dragStateRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
    setIsDragging(true);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // ignore
    }
  };

  const dragHandleStyle = {
    cursor: isDragging ? 'grabbing' : 'grab',
    userSelect: 'none',
    touchAction: 'none',
  };

  return createPortal(
    <div style={outerStyle} className={className}>
      <div ref={bubbleRef} style={bubbleStyle} role="status" aria-live="polite">
        <div className="d-flex align-items-start gap-2">
          <span
            className="badge text-dark"
            style={{ background: '#bdefff', border: '1px solid #79d2ea', ...dragHandleStyle }}
            onPointerDown={startDrag}
          >
            Info
          </span>
          <div
            className="flex-grow-1 small"
            style={{ lineHeight: 1.35 }}
            dangerouslySetInnerHTML={{ __html: resolvedMessage }}
          />
          <CloseButton aria-label="Dismiss info bubble" onClick={dismiss} />
        </div>
        {arrowPlacementStyle && <div style={{ ...arrowStyle, ...arrowPlacementStyle }} />}
      </div>
    </div>,
    document.body
  );
}
