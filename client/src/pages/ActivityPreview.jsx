// client/src/pages/ActivityPreview.jsx
import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Button, Card, Row, Col, Badge } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { API_BASE_URL } from '../config';
import useRuntimeFeatures from '../hooks/useRuntimeFeatures';
import { createInfoBubbleSession } from '../utils/infoBubbleSession';
import { formatLocalDateTime } from '../utils/time';

function normalizeAuthoredMode(rawMode) {
  const mode = String(rawMode || '').trim().toLowerCase();
  if (mode === 'test') return 'test';
  if (mode === 'demo' || mode === 'playground') return mode;
  if (mode === 'assignment') return 'assignment';
  if (mode === 'group' || mode === 'normal') return 'group';
  return null;
}

function inferAuthoredModeFromLines(lines = [], fallbackIsTest = false) {
  let sawLegacyTest = false;

  for (const line of Array.isArray(lines) ? lines : []) {
    const trimmed = String(line || '').trim();
    if (!trimmed) continue;

    if (trimmed === '\\test') {
      sawLegacyTest = true;
      continue;
    }

    const modeMatch = trimmed.match(/^\\mode\{([\s\S]*?)\}$/i);
    if (modeMatch) {
      const normalized = normalizeAuthoredMode(modeMatch[1]);
      if (normalized) return normalized;
    }
  }

  if (sawLegacyTest || fallbackIsTest) return 'test';
  return 'group';
}

export default function ActivityPreview() {

  const { activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [parseMeta, setParseMeta] = useState(null);

  const params = new URLSearchParams(location.search);
  const returnTo = params.get('returnTo'); // null if missing

  const [activity, setActivity] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [sourceLines, setSourceLines] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [sandboxError, setSandboxError] = useState('');
  const infoBubbleSessionRef = useRef(createInfoBubbleSession());
  const { features: runtimeFeatures } = useRuntimeFeatures();

  // NEW: local state used by renderBlocks / code blocks
  const [codeViewMode, setCodeViewMode] = useState({}); // { responseKey: 'active'|'local' }
  const [localCode, setLocalCode] = useState({});       // { responseKey: string }

  const stripHtml = (s = '') =>
    String(s)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+>/g, '');

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => updaterFn(prev));
  };

  // Toggle between authored / local view for a given code cell
  const toggleCodeViewMode = (responseKey, nextMode) => {
    setCodeViewMode((prev) => ({
      ...prev,
      [responseKey]: nextMode,
    }));
  };

  // Track local edits to code cells (preview is local-only)
  const updateLocalCode = (responseKey, updated) => {
    setLocalCode((prev) => ({
      ...prev,
      [responseKey]: updated,
    }));
  };

  // Called by renderBlocks / Activity*Block when code changes in preview
  const handleCodeChange = (responseKey, updatedCode) => {
    // No backend save in preview. Just keep it locally editable.
    setLocalCode((prev) => ({
      ...prev,
      [responseKey]: updatedCode,
    }));
  };

  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error(`Failed to load script ${src}`));
        document.head.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');

        if (window.Sk) {
          if (!Sk.fs) {
            const files = {};
            Sk.fs = {
              writeFile: (name, content) => {
                files[name] = typeof content === 'string' ? content : content.toString();
              },
              readFile: (name) => {
                if (!(name in files)) throw new Sk.builtin.IOError(`No such file: ${name}`);
                return files[name];
              },
              exists: (name) => name in files,
              deleteFile: (name) => { delete files[name]; },
              listFiles: () => Object.keys(files),
            };
          }
          if (Sk.builtinFiles) {
            setSkulptLoaded(true);
          } else {
            console.warn('Skulpt loaded but builtinFiles missing');
          }
        }
      } catch (err) {
        console.error('Skulpt failed to load', err);
      }
    };

    loadSkulpt();
  }, []);

  useEffect(() => {
    if (!skulptLoaded) return;
    if (!activityId) {
      console.error("[ActivityPreview] Missing activityId param. Check your route param name.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        console.log("[ActivityPreview] fetching activity", { activityId });

        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error(`activity fetch failed ${res.status}`);
        const activityData = await res.json();
        if (cancelled) return;

        activityData.source_updated_at = activityData?.source_updated_at || null;

        console.log("[ActivityPreview] activity loaded", {
          id: activityData?.id,
          sourceType: activityData?.source_type || 'remote',
        });

        const sourceRes = await fetch(
          `${API_BASE_URL}/api/activities/${activityId}/source`,
          { credentials: 'include' }
        );
        if (!sourceRes.ok) throw new Error(`activity source failed ${sourceRes.status}`);

        const body = await sourceRes.json();
        const lines = body?.lines || [];
        activityData.source_updated_at = body?.metadata?.source_updated_at
          ?? body?.source_updated_at
          ?? activityData?.source_updated_at
          ?? null;
        setActivity({ ...activityData });

        console.log("[ActivityPreview] source lines", {
          count: lines.length,
          sourceType: body?.source_type || 'remote',
        });

        const parsedRes = parseSheetToBlocks(lines, { returnIssues: true });
        const parsed = parsedRes.blocks;
        setParseMeta(parsedRes.meta);
        setSourceLines(lines);

        const computedIsTest = parsedRes?.meta?.isTest ? 1 : 0;

        // Persist only if different (avoids spamming)
        const dbIsTest = activityData?.is_test === 1 ? 1 : 0;

        if (computedIsTest !== dbIsTest) {
          try {
            await fetch(`${API_BASE_URL}/api/activities/${activityId}/is-test`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ is_test: computedIsTest }),
            });

            activityData.is_test = computedIsTest;
            setActivity({ ...activityData });
          } catch (e) {
            console.error('[ActivityPreview] Failed to persist is_test', e);
          }
        }

        const files = {};
        for (const block of parsed) {
          if (block.type === 'file' && block.filename) {
            files[block.filename] = block.content || '';
          }
        }

        if (cancelled) return;
        setBlocks(parsed);
        setFileContents(files);
      } catch (err) {
        console.error("[ActivityPreview] Failed to fetch preview data", err);
      }
    })();

    return () => { cancelled = true; };
  }, [activityId, skulptLoaded]);
  useEffect(() => {
    Prism.highlightAll();
  }, [blocks, fileContents, codeViewMode, localCode]);


  const previewHeaders = blocks.filter((block) => block?.type === 'header');
  const previewSections = blocks.filter((block) => block?.type === 'section');
  const contentBlocks = blocks.filter((block) => block?.type !== 'header');

  const headerValue = (tag) =>
    previewHeaders.find((block) => block.tag === tag)?.content || '';

  const modeValue = parseMeta?.isTest
    ? 'test'
    : inferAuthoredModeFromLines(sourceLines, Boolean(parseMeta?.isTest));

  const formattedGuidance = stripHtml(headerValue('aicodeguidance')).trim();
  const formattedContext = stripHtml(headerValue('activitycontext')).trim();
  const formattedStudentLevel = stripHtml(headerValue('studentlevel')).trim();
  const formattedName = stripHtml(headerValue('name')).trim();
  const timedSections = previewSections.filter((block) => Number(block.minutes) > 0);


  const openSandbox = async () => {
    if (!activityId || sandboxBusy) return;

    setSandboxError('');
    setSandboxBusy(true);

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activity-instances/by-activity/${activityId}/sandbox-instance`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.instanceId) {
        throw new Error(data?.error || `Sandbox failed ${res.status}`);
      }

      navigate(`/run/${data.instanceId}?mode=sandbox`, {
        state: { courseName: 'Sandbox' },
      });
    } catch (err) {
      console.error('Failed to open sandbox:', err);
      setSandboxError(err?.message || 'Unable to open sandbox mode.');
    } finally {
      setSandboxBusy(false);
    }
  };

  return (
    <Container>
      <div className="d-flex justify-content-between align-items-center mt-2 mb-2">
        <h2 className="mb-0">Preview: {activity?.title}</h2>
        <div className="d-flex gap-2">
          <Button
            variant="outline-primary"
            onClick={openSandbox}
            disabled={!activity || sandboxBusy}
          >
            {sandboxBusy ? 'Opening...' : 'Sandbox'}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              if (!returnTo) navigate(-1);
              else navigate(returnTo);
            }}
          >
            Back
          </Button>
        </div>
      </div>

      {sandboxError && (
        <div className="alert alert-danger py-2 mb-2">{sandboxError}</div>
      )}

      <Card className="mb-3">
        <Card.Body>
          <Row className="g-3">
            <Col md={6}>
              <div className="small text-muted mb-1">Mode</div>
              <div>
                <Badge
                  bg={
                    modeValue === 'test'
                      ? 'danger'
                      : modeValue === 'playground' || modeValue === 'assignment'
                        ? 'info'
                        : 'secondary'
                  }
                  className="text-uppercase"
                >
                  {modeValue}
                </Badge>
                {parseMeta?.isTest && (
                  <Badge bg="warning" text="dark" className="ms-2">
                    \test enabled
                  </Badge>
                )}
              </div>
            </Col>

            {formattedName && (
              <Col md={6}>
                <div className="small text-muted mb-1">Name</div>
                <div>{formattedName}</div>
              </Col>
            )}

            {formattedStudentLevel && (
              <Col md={6}>
                <div className="small text-muted mb-1">Student Level</div>
                <div>{formattedStudentLevel}</div>
              </Col>
            )}

            <Col md={6}>
              <div className="small text-muted mb-1">Retries</div>
              <div>Sheet default = {parseMeta?.retriesDefault ?? 0}</div>
              <div className="small text-muted mt-1">
                {parseMeta && Object.keys(parseMeta.groupRetries || {}).length
                  ? Object.entries(parseMeta.groupRetries)
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([gid, v]) => `G${gid}=${v}`)
                    .join(' · ')
                  : 'No group overrides'}
              </div>
            </Col>

            <Col md={6}>
              <div className="small text-muted mb-1">Activity Version</div>
              <div>
                {activity?.source_updated_at
                  ? formatLocalDateTime(activity.source_updated_at)
                  : 'Not recorded yet'}
              </div>
            </Col>

            {formattedContext && (
              <Col xs={12}>
                <div className="small text-muted mb-1">Context</div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{formattedContext}</div>
              </Col>
            )}

            <Col xs={12}>
              <div className="small text-muted mb-1">Section Timing</div>
              {timedSections.length ? (
                <div className="d-flex flex-wrap gap-2">
                  {timedSections.map((section) => (
                    <Badge key={section.key || section.title} bg="light" text="dark" className="border">
                      {stripHtml(section.title)}: {section.minutes} min
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-muted">No section timers</div>
              )}
            </Col>

            {formattedGuidance && (
              <Col xs={12}>
                <div className="small text-muted mb-1">AI Code Guidance</div>
                <pre className="mb-0 p-3 bg-light border rounded" style={{ whiteSpace: 'pre-wrap' }}>
                  {formattedGuidance}
                </pre>
              </Col>
            )}
          </Row>
        </Card.Body>
      </Card>

      {!skulptLoaded ? (
        <p>Loading Python engine (Skulpt)...</p>
      ) : (
        renderBlocks(contentBlocks, {
          mode: 'preview',
          editable: true,
          isActive: true,
          isObserver: false,
          allowLocalToggle: true,
          fileContents,
          setFileContents: handleUpdateFileContents,
          codeViewMode,
          onToggleViewMode: toggleCodeViewMode,
          localCode,
          onLocalCodeChange: updateLocalCode,
          onCodeChange: handleCodeChange,
          infoBubbleSession: infoBubbleSessionRef.current,
          runtimeFeatures,
        })
      )}
    </Container>
  );
}
