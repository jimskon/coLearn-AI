import React, { useEffect, useState, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Container, Row, Col, Button, Form, Alert, Modal, Spinner, Tabs, Tab } from 'react-bootstrap';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { API_BASE_URL } from '../config';

export default function ActivityEditor() {
  const { activityId } = useParams();

  const [activity, setActivity] = useState(null);
  const [rawText, setRawText] = useState('');
  const [elements, setElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);
  const [copySuccess, setCopySuccess] = useState('');
  const [previewKey, setPreviewKey] = useState(Date.now());
  const [autoCompileEnabled, setAutoCompileEnabled] = useState(true);

  // Right-side display mode + parse issues
  const [rightPaneMode, setRightPaneMode] = useState('preview'); // 'preview' | 'errors'
  const [parseIssues, setParseIssues] = useState([]);
  const compileReasonRef = useRef('auto'); // 'auto' | 'manual'

  // File contents (for Python blocks)
  const [fileContents, setFileContents] = useState({});
  const fileContentsRef = useRef({});

  // ---- Auto-fix state ----
  const docBeforeAutofixRef = useRef('');

  const autoTimerRef = useRef(null);

  const [autofixOpen, setAutofixOpen] = useState(false);
  const [autofixBusy, setAutofixBusy] = useState(false);
  const [autofixError, setAutofixError] = useState('');

  const [autofixProposedText, setAutofixProposedText] = useState('');
  const [autofixSummary, setAutofixSummary] = useState([]);
  const [autofixWarnings, setAutofixWarnings] = useState([]);

  const [autofixBlocks, setAutofixBlocks] = useState([]);
  const [autofixElements, setAutofixElements] = useState([]);
  const [autofixIssuesAfter, setAutofixIssuesAfter] = useState([]);

  const textareaRef = useRef(null);
  const gutterRef = useRef(null);

  const lineCount = Math.max(1, rawText.split('\n').length);

  const busy = autofixBusy;

  const handleUpdateFileContents = (updaterFn) => {
    setFileContents((prev) => {
      const updated = updaterFn(prev);
      fileContentsRef.current = updated;
      return updated;
    });
  };

  function toGoogleDocEditUrl(url) {
    const s = String(url || '').trim();
    if (!s) return null;

    const m = s.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (m) return `https://docs.google.com/document/d/${m[1]}/edit`;

    const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) return `https://docs.google.com/document/d/${m2[1]}/edit`;

    return s; // fallback
  }

  // ---- Frontend "missing }" checker (before parser runs) ----
  function findUnclosedTagBraces(text) {
    const lines = String(text || '').split(/\r?\n/);

    // ignore braces inside these blocks
    const protectedStack = [];
    const isProtected = () => protectedStack.length > 0;

    const startProt = (t) => {
      if (/^\\python\b/i.test(t)) protectedStack.push('python');
      else if (/^\\cpp\b/i.test(t)) protectedStack.push('cpp');
      else if (/^\\file\{/.test(t)) protectedStack.push('file');
      else if (/^\\block\{/.test(t)) protectedStack.push('block');
    };

    const endProt = (t) => {
      if (/^\\endpython\b/i.test(t) && protectedStack.at(-1) === 'python') protectedStack.pop();
      else if (/^\\endcpp\b/i.test(t) && protectedStack.at(-1) === 'cpp') protectedStack.pop();
      else if (/^\\endfile\b/i.test(t) && protectedStack.at(-1) === 'file') protectedStack.pop();
      else if (/^\\endblock\b/i.test(t) && protectedStack.at(-1) === 'block') protectedStack.pop();
    };

    const isTagLine = (t) => /^\\[A-Za-z]+(?:\*?)\b/.test(t);
    const isBraceTag = (t) => /^\\[A-Za-z]+(?:\*?)\{/.test(t);

    let pending = null; // { line, tag, depth }

    const countBraces = (s) => {
      let d = 0;
      for (const ch of s) {
        if (ch === '{') d++;
        else if (ch === '}') d--;
      }
      return d;
    };

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const raw = lines[i];
      const t = raw.trim();

      startProt(t);
      if (isProtected()) {
        endProt(t);
        continue;
      }

      // If we are inside a pending \tag{... across lines, update depth using THIS line.
      if (pending) {
        pending.depth += countBraces(raw);

        if (pending.depth <= 0) {
          pending = null; // closed
        } else {
          // still open; if a NEW tag starts while still pending, that's an error
          if (isTagLine(t)) {
            return {
              line: pending.line,
              tag: pending.tag,
              message: `Unclosed \\${pending.tag}{...} (missing "}") before next tag at line ${lineNum}.`,
              context: lines[pending.line - 1] ?? '',
            };
          }
        }

        endProt(t);
        continue;
      }

      // Start pending if we see a \tag{ that does not close on the same line
      if (isBraceTag(t)) {
        const m = t.match(/^\\([A-Za-z]+(?:\*?))\{/);
        const tag = m ? m[1] : 'tag';

        // depth from the FIRST '{' onward on this line
        const idx = raw.indexOf('{');
        const rest = idx >= 0 ? raw.slice(idx) : raw;
        const depth = countBraces(rest);

        if (depth > 0) {
          pending = { line: lineNum, tag, depth };
        }
      }

      endProt(t);
    }

    if (pending) {
      return {
        line: pending.line,
        tag: pending.tag,
        message: `Unclosed \\${pending.tag}{...} (missing "}") at end of document.`,
        context: lines[pending.line - 1] ?? '',
      };
    }

    return null;
  }
  useEffect(() => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [rawText]);
  // Load Skulpt
  useEffect(() => {
    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        setSkulptLoaded(true);
      } catch (err) {
        console.error('Skulpt failed to load', err);
      }
    };

    loadSkulpt();
  }, []);

  // Compile handler
  const handleCompile = (sourceText = rawText, reason = 'auto') => {
    compileReasonRef.current = reason;

    // 0) brace sanity check first
    const braceIssue = findUnclosedTagBraces(sourceText);
    if (braceIssue) {
      setParseIssues([{
        severity: 'error',
        line: braceIssue.line,
        message: braceIssue.message,
        context: braceIssue.context,
      }]);

      // DO NOT blank the preview; keep last good render so it doesn't look dead.
      // If you prefer blanking, fine — but then ALWAYS switch to errors.
      // setElements([]);

      localStorage.setItem(`activity-${activityId}`, sourceText);

      // Always show errors (auto or manual) when we *know* it's broken
      setRightPaneMode('errors');
      return;
    }

    try {
      const lines = sourceText.split('\n');

      const parsed = parseSheetToBlocks(lines, { returnIssues: true });

      // ✅ robust: blocks must be an array
      const blocks =
        Array.isArray(parsed?.blocks) ? parsed.blocks :
          Array.isArray(parsed) ? parsed :
            [];

      // ✅ robust: issues must be an array
      const issues =
        Array.isArray(parsed?.issues) ? parsed.issues :
          [];

      setParseIssues(issues);
      if (reason === 'auto' && issues.some(i => i.severity === 'error')) {
        setRightPaneMode('errors');
      }
      // Extract files for Python execution
      const files = {};
      for (const block of blocks) {
        if (block?.type === 'file' && block?.filename) {
          files[block.filename] = block.content ?? '';
        }
      }
      setFileContents(files);
      fileContentsRef.current = files;

      const rendered = renderBlocks(blocks, {
        mode: 'preview',
        editable: true,
        fileContents: files,
        setFileContents: handleUpdateFileContents,
      });

      setElements(rendered);
      setPreviewKey(Date.now());
      localStorage.setItem(`activity-${activityId}`, sourceText);

      // If manual and there are parser errors, show errors pane
      if (reason === 'manual' && issues.some((i) => i.severity === 'error')) {
        setRightPaneMode('errors');
      }

    } catch (e) {
      console.error('[ActivityEditor] handleCompile failed:', e);

      // ✅ show something even if it’s a runtime bug, not a parse issue
      setElements([]);
      setParseIssues([{
        severity: 'error',
        message: `Editor compile crashed: ${e?.message ?? String(e)}`,
        context: '',
      }]);
      setPreviewKey(Date.now());

      // I’d flip to errors even on auto; otherwise it looks “blank and dead”
      setRightPaneMode('errors');
    }
  };

  // Fetch activity and saved text
  useEffect(() => {
    const fetchActivity = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/activities/${activityId}`);
        const activityData = await res.json();
        setActivity(activityData);

        const cached = localStorage.getItem(`activity-${activityId}`);
        if (cached) {
          setRawText(cached); // auto compile will handle it
        } else {
          const docRes = await fetch(
            `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activityData.sheet_url)}`
          );
          const { lines } = await docRes.json();
          const text = lines.join('\n');
          setRawText(text);
          localStorage.setItem(`activity-${activityId}`, text);
          setTimeout(() => handleCompile(text), 0);
        }
      } catch (err) {
        console.error('Failed to fetch activity', err);
      }
    };

    if (skulptLoaded) fetchActivity();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId, skulptLoaded]);

  // Auto-compile on change
  useEffect(() => {
    if (!autoCompileEnabled) return;
    if (!rawText.trim()) return;

    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => {
      handleCompile(rawText, 'auto');
    }, 200);

    return () => clearTimeout(autoTimerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawText, autoCompileEnabled]);

  // "Check" button (manual parse + show errors pane)
  const handleCheck = () => {
    handleCompile(rawText, 'manual');
    setRightPaneMode('errors');
  };

  // Copy handler
  const handleCopy = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(rawText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = rawText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopySuccess('✅ Copied to clipboard!');
      setTimeout(() => setCopySuccess(''), 2000);
    } catch (err) {
      setCopySuccess('❌ Copy failed. Try manually.');
      console.error(err);
    }
  };

  const handleRecover = async () => {
    if (!activity?.sheet_url) return;

    const confirmed = window.confirm(
      'This will discard all unsaved changes and recover the original text from the source document. Are you sure?'
    );
    if (!confirmed) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(activity.sheet_url)}`
      );
      const { lines } = await res.json();
      const recoveredText = lines.join('\n');
      setRawText(recoveredText);
      localStorage.setItem(`activity-${activityId}`, recoveredText);
      handleCompile(recoveredText, 'manual');
    } catch (err) {
      console.error('Failed to recover original text', err);
    }
  };

  const runAutofix = async () => {
    setAutofixError('');

    const parsed = parseSheetToBlocks(rawText.split('\n'), { returnIssues: true });
    const issuesNow = parsed?.issues ?? [];

    if (!issuesNow.length) {
      setAutofixError('No parser issues found — nothing to auto-correct.');
      setAutofixOpen(true);
      return;
    }

    docBeforeAutofixRef.current = rawText;
    setAutofixBusy(true);
    setAutofixOpen(true);

    try {
      const specRes = await fetch('/MarkUp.md', { cache: 'no-store' });
      if (!specRes.ok) throw new Error(`Failed to load MarkUp.md (${specRes.status})`);
      const markupSpec = await specRes.text();

      const res = await fetch(`${API_BASE_URL}/api/ai/code/repair-markup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docText: rawText,
          issues: issuesNow,
          markupSpec,
          options: { mode: 'authoring' },
        }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Autofix request failed (${res.status}). ${txt}`.trim());
      }

      const data = await res.json();
      const proposed = data.proposedDocText || data.proposed || '';
      if (!proposed.trim()) throw new Error('Repair returned an empty proposed document.');

      setAutofixProposedText(proposed);
      setAutofixSummary(Array.isArray(data.summary) ? data.summary : []);
      setAutofixWarnings(Array.isArray(data.warnings) ? data.warnings : []);

      const parsed2 = parseSheetToBlocks(proposed.split('\n'), { returnIssues: true });
      const blocks2 = parsed2?.blocks ?? parsed2;
      const issuesAfter = parsed2?.issues ?? [];

      setAutofixBlocks(blocks2);
      setAutofixIssuesAfter(issuesAfter);

      const files2 = {};
      for (const b of blocks2) {
        if (b.type === 'file' && b.filename) files2[b.filename] = b.content ?? '';
      }

      const rendered2 = renderBlocks(blocks2, {
        mode: 'preview',
        editable: true,
        fileContents: files2,
        setFileContents: handleUpdateFileContents,
      });

      setAutofixElements(rendered2);
    } catch (e) {
      setAutofixError(e?.message || String(e));
    } finally {
      setAutofixBusy(false);
    }
  };

  const acceptAutofix = () => {
    if (!autofixProposedText) return;

    setRawText(autofixProposedText);
    localStorage.setItem(`activity-${activityId}`, autofixProposedText);

    handleCompile(autofixProposedText, 'manual');

    setAutofixOpen(false);
    setAutofixProposedText('');
    setAutofixSummary([]);
    setAutofixWarnings([]);
    setAutofixBlocks([]);
    setAutofixElements([]);
    setAutofixIssuesAfter([]);
    setAutofixError('');
  };

  const closeAutofix = () => {
    setAutofixOpen(false);
  };

  return (
    <Container fluid style={{ height: '100vh', overflow: 'hidden', padding: '1rem' }}>
      <style>{`
        .editor-header {
          position: sticky;
          top: 0;
          background: white;
          z-index: 10;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid #ddd;
        }
        .editor-body {
          height: calc(100vh - 100px);
        }
        .scrollable-pane {
          display: flex;
          flex-direction: column;
          height: 100%;
          overflow-y: auto;
          background: #fafafa;
          padding: 0.5rem;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
.code-editor {
  height: 100%;
  width: 100%;
  border: none;
  resize: none;
  overflow: auto;
  font-family: monospace;
  font-size: 0.9rem;
  background: white;
  padding: 0.5rem;
  box-sizing: border-box;
  line-height: 1.4;
}
        .right-pane-header {
          position: sticky;
          top: 0;
          background: #fafafa;
          z-index: 5;
          padding: 0.25rem 0.25rem 0.5rem 0.25rem;
          border-bottom: 1px solid #ddd;
        }
          .editor-wrap {
  display: flex;
  height: 90vh;
  width: 100%;
  background: white;
  border-radius: 4px;
  border: 1px solid #ccc;
  overflow: hidden;
}

.line-gutter {
  user-select: none;
  flex: 0 0 auto;
  padding: 0.5rem 0.5rem;
  background: #f3f3f3;
  border-right: 1px solid #ddd;
  color: #666;
  font-family: monospace;
  font-size: 0.9rem;
  line-height: 1.4;
  text-align: right;
  overflow: hidden;
}

.line-gutter div {
  height: 1.4em; /* matches textarea line-height */
}

      `}</style>

      <div className="editor-header d-flex justify-content-between align-items-center mb-2">
        <h4>Edit Activity: {activity?.title}</h4>
        <div>
          <Form.Check
            type="switch"
            id="auto-compile-switch"
            label="Auto Compile"
            checked={autoCompileEnabled}
            onChange={() => setAutoCompileEnabled((prev) => !prev)}
            className="ms-3"
          />

          <Button
            variant="outline-secondary"
            className="me-2"
            onClick={handleCheck}
            disabled={busy}
          >
            Check
          </Button>

          <Button
            variant="primary"
            className="me-2"
            onClick={runAutofix}
            disabled={busy}
          >
            Auto Correct
          </Button>

          <Button
            variant="secondary"
            className="me-2"
            onClick={handleCopy}
            disabled={busy}
          >
            Copy
          </Button>

          <Button
            variant="warning"
            className="me-2"
            onClick={handleRecover}
            disabled={busy}
          >
            Reread
          </Button>

          {activity?.sheet_url && (
            <Button
              variant="outline-primary"
              onClick={() => {
                const url = toGoogleDocEditUrl(activity.sheet_url);
                if (url) window.open(url, '_blank', 'noopener,noreferrer');
              }}
              disabled={busy}
            >
              Open Doc
            </Button>
          )}
        </div>
      </div>

      {copySuccess && <Alert variant="info" className="py-1">{copySuccess}</Alert>}

      <Row className="editor-body">
        {/* LEFT: editor + gutter */}
        <Col md={6} className="scrollable-pane">
          <div className="editor-wrap">
            <div className="line-gutter" ref={gutterRef} aria-hidden="true">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>

            <Form.Control
              as="textarea"
              className="code-editor"
              value={rawText}
              ref={textareaRef}
              onScroll={() => {
                if (gutterRef.current && textareaRef.current) {
                  gutterRef.current.scrollTop = textareaRef.current.scrollTop;
                }
              }}
              onChange={(e) => setRawText(e.target.value)}
              spellCheck={false}
            />
          </div>
        </Col>

        {/* RIGHT: preview/errors */}
        <Col md={6} className="scrollable-pane">
          <div className="right-pane-header d-flex justify-content-between align-items-center">
            <div className="text-muted small">
              {rightPaneMode === 'preview' ? 'Preview' : 'Parser issues'}
              {parseIssues?.length ? ` · ${parseIssues.length}` : ''}
            </div>

            <Form.Check
              type="switch"
              id="preview-errors-switch"
              label={rightPaneMode === 'preview' ? 'Showing Preview' : 'Showing Errors'}
              checked={rightPaneMode === 'errors'}
              onChange={() => setRightPaneMode((m) => (m === 'preview' ? 'errors' : 'preview'))}
            />
          </div>

          {rightPaneMode === 'preview' ? (
            elements
          ) : (
            <div className="mt-2">
              {!parseIssues?.length ? (
                <Alert variant="success" className="py-2 mb-2">
                  No parser issues found.
                </Alert>
              ) : (
                <>
                  <Alert variant="warning" className="py-2 mb-2">
                    Showing issues found while parsing. (These are not runtime errors.)
                  </Alert>

                  {parseIssues.map((iss, i) => (
                    <Alert
                      key={`iss-${i}`}
                      variant={iss.severity === 'error' ? 'danger' : (iss.severity === 'warn' ? 'warning' : 'secondary')}
                      className="py-2 mb-2"
                    >
                      <div className="d-flex justify-content-between">
                        <strong>{String(iss.severity || '').toUpperCase()}</strong>
                        <span className="text-muted">
                          {typeof iss.line === 'number' ? `Line ${iss.line}` : ''}
                        </span>
                      </div>
                      <div>{iss.message}</div>
                      {iss.context ? (
                        <div className="mt-1">
                          <code style={{ whiteSpace: 'pre-wrap' }}>{iss.context}</code>
                        </div>
                      ) : null}
                    </Alert>
                  ))}
                </>
              )}
            </div>
          )}
        </Col>
      </Row>
      <Modal
        show={autofixOpen}
        onHide={closeAutofix}
        size="xl"
        backdrop="static"
        keyboard={!autofixBusy}
      >
        <Modal.Header closeButton={!autofixBusy}>
          <Modal.Title>Auto Correct Markup</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          {autofixBusy ? (
            <div className="d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              <div>Asking AI to propose fixes…</div>
            </div>
          ) : null}

          {autofixError ? (
            <Alert variant="danger" className="mt-2">
              {autofixError}
            </Alert>
          ) : null}

          {!autofixBusy && !autofixError && autofixProposedText ? (
            <>
              {autofixSummary?.length ? (
                <Alert variant="info" className="mt-2">
                  <div className="fw-bold mb-1">Summary</div>
                  <ul className="mb-0">
                    {autofixSummary.map((s, i) => <li key={`sum-${i}`}>{s}</li>)}
                  </ul>
                </Alert>
              ) : null}

              {autofixWarnings?.length ? (
                <Alert variant="warning" className="mt-2">
                  <div className="fw-bold mb-1">Warnings</div>
                  <ul className="mb-0">
                    {autofixWarnings.map((w, i) => <li key={`warn-${i}`}>{w}</li>)}
                  </ul>
                </Alert>
              ) : null}

              {autofixIssuesAfter?.length ? (
                <Alert
                  variant={autofixIssuesAfter.some((x) => x.severity === 'error') ? 'danger' : 'warning'}
                  className="mt-2"
                >
                  Remaining issues after fix: <strong>{autofixIssuesAfter.length}</strong>
                </Alert>
              ) : (
                <Alert variant="success" className="mt-2">
                  No parser issues after fix.
                </Alert>
              )}

              <Tabs defaultActiveKey="preview" className="mt-3">
                <Tab eventKey="preview" title="Preview">
                  <div className="mt-3" style={{ background: '#fff', padding: 12, border: '1px solid #ddd', borderRadius: 6 }}>
                    {autofixElements}
                  </div>
                </Tab>

                <Tab eventKey="diff" title="Before / After">
                  <Row className="mt-3">
                    <Col md={6}>
                      <div className="text-muted small mb-1">Before</div>
                      <Form.Control
                        as="textarea"
                        value={docBeforeAutofixRef.current}
                        readOnly
                        style={{ fontFamily: 'monospace', height: '50vh' }}
                      />
                    </Col>
                    <Col md={6}>
                      <div className="text-muted small mb-1">After (proposed)</div>
                      <Form.Control
                        as="textarea"
                        value={autofixProposedText}
                        readOnly
                        style={{ fontFamily: 'monospace', height: '50vh' }}
                      />
                    </Col>
                  </Row>
                </Tab>

                <Tab eventKey="issues" title="Issues After">
                  <div className="mt-3">
                    {!autofixIssuesAfter?.length ? (
                      <Alert variant="success">No issues.</Alert>
                    ) : (
                      autofixIssuesAfter.map((iss, i) => (
                        <Alert
                          key={`af-iss-${i}`}
                          variant={iss.severity === 'error' ? 'danger' : (iss.severity === 'warn' ? 'warning' : 'secondary')}
                          className="py-2 mb-2"
                        >
                          <div className="d-flex justify-content-between">
                            <strong>{String(iss.severity || '').toUpperCase()}</strong>
                            <span className="text-muted">
                              {typeof iss.line === 'number' ? `Line ${iss.line}` : ''}
                            </span>
                          </div>
                          <div>{iss.message}</div>
                          {iss.context ? (
                            <div className="mt-1">
                              <code style={{ whiteSpace: 'pre-wrap' }}>{iss.context}</code>
                            </div>
                          ) : null}
                        </Alert>
                      ))
                    )}
                  </div>
                </Tab>
              </Tabs>
            </>
          ) : null}
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={closeAutofix} disabled={autofixBusy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={acceptAutofix}
            disabled={autofixBusy || !autofixProposedText}
          >
            Accept Fix
          </Button>
        </Modal.Footer>
      </Modal>
    </Container>
  );
}