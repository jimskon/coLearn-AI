import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Form, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import { runSkulptCode } from '../../utils/runSkulptCode';

function createStdinController() {
  let waitingResolve = null;
  const queue = [];

  return {
    pushLine(line) {
      const s = String(line ?? "");
      if (waitingResolve) {
        const r = waitingResolve;
        waitingResolve = null;
        r(s);
      } else {
        queue.push(s);
      }
    },
    readLine() {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => {
        waitingResolve = resolve;
      });
    },
    reset() {
      waitingResolve = null;
      queue.length = 0;
    },
  };
}

export default function ActivityPythonBlock({
  code: initialCode,
  blockIndex,
  responseKey,
  onCodeChange,
  localOnly = false,
  codeFeedbackShown = {},
  fileContents,
  setFileContents,
  timeLimit,
  turtleTargetId,
  turtleWidth = 600,
  turtleHeight = 400,
  editable = true,
  includeFiles = [],
}) {
  const stdinRef = useRef(null);
  if (!stdinRef.current) stdinRef.current = createStdinController();

  const [consoleInput, setConsoleInput] = useState('');
  const [code, setCode] = useState(initialCode ?? '');
  useEffect(() => { if (localOnly) setCode(initialCode ?? ''); }, [initialCode, localOnly]);

  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);

  const codeId = `sk-code-${blockIndex}`;
  const codeRef = useRef(null);
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const codeScrollRef = useRef(null);
  const [outputText, setOutputText] = useState('');
  const selectionRef = useRef(null);

  // --- NEW: outputKey derived from responseKey, same rule as C++ ---
  const outputKey = useMemo(() => {
    if (!responseKey) return '';
    return responseKey.replace(/code(\d+)$/, 'output$1');
  }, [responseKey]);

  // --- live update plumbing (unchanged) ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastInitialRef = useRef(initialCode ?? '');
  const lastSentRef = useRef(initialCode ?? '');
  const pendingRemoteRef = useRef(null);


  useEffect(() => {
    if (!isEditing && codeRef.current) Prism.highlightElement(codeRef.current);
  }, [isEditing, code]);

  useEffect(() => {
    if (!isEditing || !taRef.current || !selectionRef.current) return;
    const { start, end } = selectionRef.current;
    try {
      taRef.current.setSelectionRange(start, end);
    } catch { }
    selectionRef.current = null;
  }, [code, isEditing]);

  useEffect(() => {
    const next = initialCode ?? '';
    if (next === lastInitialRef.current) return;
    lastInitialRef.current = next;
    if (isEditing) pendingRemoteRef.current = next;
    else {
      setCode(next);
      setSavedCode(next);
      lastSentRef.current = next;
      pendingRemoteRef.current = null;
    }
  }, [initialCode, isEditing]);

  useEffect(() => () => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
  }, []);

  const sendUpstream = (val, { broadcastOnly = false } = {}) => {
    if (!onCodeChange || !responseKey) return;
    if (val === lastSentRef.current) return;
    lastSentRef.current = val;
    onCodeChange(
      responseKey,
      val,
      broadcastOnly ? { __broadcastOnly: true } : undefined
    );
  };

  const scheduleBroadcast = (val) => {
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = setTimeout(() => {
      sendUpstream(val, { broadcastOnly: true });
      broadcastTimerRef.current = null;
    }, debounceMs);
  };

  const flushPendingRemoteIfAny = () => {
    if (pendingRemoteRef.current != null) {
      const incoming = pendingRemoteRef.current;
      pendingRemoteRef.current = null;
      setCode(incoming);
      setSavedCode(incoming);
      lastSentRef.current = incoming;
    }
  };

  // --- line numbers + scroll sync ---
  const LINE_H = 1.45;

  const lineNumbers = useMemo(() => {
    const n = (code || '').split('\n').length || 1;
    return Array.from({ length: n }, (_, i) => String(i + 1)).join('\n');
  }, [code]);

  const syncGutterScroll = (top) => {
    if (gutterRef.current) gutterRef.current.scrollTop = top;
  };
  const onTextareaScroll = () => {
    if (taRef.current) syncGutterScroll(taRef.current.scrollTop);
  };
  const onCodeViewScroll = () => {
    if (codeScrollRef.current) syncGutterScroll(codeScrollRef.current.scrollTop);
  };

  const buildMergedCode = () => {
    if (!includeFiles || includeFiles.length === 0) {
      return code;
    }

    let prelude = '';

    includeFiles.forEach((fname) => {
      const src = fileContents?.[fname];
      if (!src) return; // silently skip missing file for now

      prelude += `# ===== BEGIN ${fname} =====\n`;
      prelude += src;
      if (!src.endsWith('\n')) prelude += '\n';
      prelude += `# ===== END ${fname} =====\n\n`;
    });

    return prelude + code;
  };

  const runPython = () => {
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }
    if (!window.Sk || !window.Sk.configure) {
      alert('Skulpt is still loading...');
      return;
    }

    const finalCode = buildMergedCode();        // 👈 merged harness + student code
    //const currentFiles = { ...fileContents };

    runSkulptCode({
      code: finalCode,          // ← use merged code
      fileContents,
      setOutput: setOutputText, // ← FIX: pass the actual setter
      setFileContents,
      execLimit: timeLimit,
      turtleTargetId,
      turtleWidth,
      turtleHeight,
      stdin: stdinRef.current,
    });
  };


  const handleDoneEditing = () => {
    setIsEditing(false);
    if (broadcastTimerRef.current) {
      clearTimeout(broadcastTimerRef.current);
      broadcastTimerRef.current = null;
    }
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }
    flushPendingRemoteIfAny();
  };

  // NEW: Tab + auto-indent handler
  const handleKeyDown = (e) => {
    if (!isEditing || !editable) return;

    const el = e.target;
    const value = code;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;

    // TAB → insert spaces instead of leaving the textarea
    if (e.key === 'Tab') {
      e.preventDefault();
      const indent = '    '; // or '\t' if you prefer
      const newValue = value.slice(0, start) + indent + value.slice(end);
      const newPos = start + indent.length;

      setCode(newValue);
      if (editable) scheduleBroadcast(newValue);
      selectionRef.current = { start: newPos, end: newPos };
      return;
    }

    // ENTER → keep indentation from current line
    if (e.key === 'Enter') {
      e.preventDefault();

      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const match = line.match(/^[\t ]*/);
      const indent = match ? match[0] : '';

      const insert = '\n' + indent;
      const newValue = value.slice(0, start) + insert + value.slice(end);
      const newPos = start + insert.length;

      setCode(newValue);
      if (editable) scheduleBroadcast(newValue);
      selectionRef.current = { start: newPos, end: newPos };
      return;
    }
  };

  const mono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

  const styles = {
    controls: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 8,
      position: 'relative',
      zIndex: 2,
    },
    editorWrap: {
      display: 'flex',
      alignItems: 'stretch',
      width: '100%',
      border: '1px solid #dee2e6',
      borderRadius: '0.375rem',
      overflow: 'hidden',
      background: '#f8f9fa',
      fontFamily: mono,
      fontSize: '0.95rem',
      lineHeight: LINE_H,
      marginTop: '0.25rem',
    },
    gutter: {
      margin: 0,
      padding: '8px 8px 8px 12px',
      minWidth: '3ch',
      maxWidth: '8ch',
      color: '#6c757d',
      textAlign: 'right',
      userSelect: 'none',
      background: '#f1f3f5',
      borderRight: '1px solid #dee2e6',
      overflow: 'hidden',
      whiteSpace: 'pre',
      lineHeight: LINE_H,
      fontFamily: mono,
      fontSize: '0.95rem',
    },
    textarea: {
      flex: 1,
      border: 'none',
      outline: 'none',
      resize: 'vertical',
      padding: '8px 10px',
      background: '#212529',
      color: '#fff',
      minHeight: '160px',
      overflow: 'auto',
      whiteSpace: 'pre',
      lineHeight: LINE_H,
      fontFamily: mono,
      fontSize: '0.95rem',
    },
    codeView: {
      flex: 1,
      overflow: 'auto',
      background: '#fff',
      padding: '8px 10px',
    },
    codePre: {
      margin: 0,
      padding: 0,
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
    },
    codeTag: {
      display: 'block',
      margin: 0,
      padding: 0,
      lineHeight: LINE_H,
      fontSize: '0.95rem',
      fontFamily: mono,
      whiteSpace: 'pre',
    },
  };

  return (
    <div className="mb-4">
      {/* Controls */}
      <div style={styles.controls}>
        <Button
          variant="secondary"
          onClick={
            isEditing
              ? handleDoneEditing
              : () => {
                setIsEditing(true);
                flushPendingRemoteIfAny?.();
              }
          }
        >
          {isEditing ? 'Done Editing' : 'Edit Code'}
        </Button>

        <Button variant="primary" onClick={runPython}>
          Run Python
        </Button>
      </div>

      {/* Editor / Viewer with line-number gutter */}
      <div style={styles.editorWrap}>
        <pre ref={gutterRef} style={styles.gutter} aria-hidden="true">
          {lineNumbers}
        </pre>

        {isEditing ? (
          <Form.Control
            as="textarea"
            ref={taRef}
            id={codeId}
            data-response-key={responseKey}
            value={code}
            readOnly={!isEditing}
            onChange={(e) => {
              const v = e.target.value;
              setCode(v);
              if (editable) scheduleBroadcast(v);
            }}
            onKeyDown={handleKeyDown}
            onBlur={handleDoneEditing}
            onScroll={onTextareaScroll}
            rows={Math.max(6, code.split('\n').length)}
            className="font-monospace mt-0"
            style={styles.textarea}
          />
        ) : (
          <div
            ref={codeScrollRef}
            style={styles.codeView}
            onScroll={onCodeViewScroll}
          >
            <pre style={styles.codePre}>
              <code
                id={codeId}
                ref={codeRef}
                className="language-python"
                style={styles.codeTag}
              >
                {code}
              </code>
            </pre>
          </div>
        )}
      </div>

      {/* Visible output for the student */}
      <pre className="mt-2 bg-light p-2 border">{outputText}</pre>
      <div className="d-flex gap-2 mt-2">
        <Form.Control
          value={consoleInput}
          onChange={(e) => setConsoleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              const line = consoleInput;
              setConsoleInput('');

              // echo typed input to console (optional but feels right)
              setOutputText((prev) => prev + line + '\n');

              // feed Skulpt input() (include newline)
              stdinRef.current.pushLine(line + '\n');
            }
          }}
          placeholder='Type input() here and press Enter'
        />
        <Button
          variant="secondary"
          onClick={() => {
            const line = consoleInput;
            setConsoleInput('');
            setOutputText((prev) => prev + line + '\n');
            stdinRef.current.pushLine(line + '\n');
          }}
        >
          Send
        </Button>
      </div>
      {codeFeedbackShown[responseKey] && (
        <div className="mt-2 p-3 border rounded bg-warning-subtle">
          <strong>AI Feedback:</strong>
          <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
        </div>
      )}

      {/* Hidden mirror of code for test grading */}
      {responseKey && (
        <textarea
          style={{ display: 'none' }}
          data-response-key={responseKey}
          readOnly
          value={code}
        />
      )}

      {/* Hidden mirror of Python output for test grading */}
      {outputKey && (
        <pre
          style={{ display: 'none' }}
          data-output-key={outputKey}
        >
          {outputText}
        </pre>
      )}
    </div>
  );
}
