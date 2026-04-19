// src: client/src/components/activity/ActivityCppBlock.jsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import Prism from 'prismjs';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';

export default function ActivityCppBlock({
  code: initialCode,
  responseKey,
  onCodeChange,
  timeLimit = 50000,        // currently unused but kept for API compatibility
  editable = true,
  blockIndex = 0,
  localOnly = false,       // if true, don't send files / remote sync
  codeFeedbackShown = {},
  fileContents = {},       // { "data.txt": "10 20 30", ... }
  setFileContents,         // fn to update sheet-level file contents
  includeFiles = null,
}) {
  // --- code state ---
  const [code, setCode] = useState(initialCode ?? '');
  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [layoutMode, setLayoutMode] = useState('side'); // 'side' | 'stacked'

  // keep track of last initial to avoid loops
  const lastInitialRef = useRef(initialCode ?? '');
  useEffect(() => {
    const next = initialCode ?? '';
    if (next === lastInitialRef.current) return;
    lastInitialRef.current = next;
    if (!isEditing) {
      setCode(next);
      setSavedCode(next);
      lastSentRef.current = next;
      pendingRemoteRef.current = null;
    } else {
      // if currently editing, queue remote update
      pendingRemoteRef.current = next;
    }
  }, [initialCode, isEditing]);

  // When localOnly toggles true, reset from initial
  useEffect(() => {
    if (localOnly) {
      const base = initialCode ?? '';
      setCode(base);
      setSavedCode(base);
    }
  }, [localOnly, initialCode]);

  // --- terminal + ws refs ---
  const termRef = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const wsRef = useRef(null);
  const wsTimerRef = useRef(null);
  const onDataDisposeRef = useRef(null);
  const inputBufferRef = useRef('');

  // --- Prism / editor refs ---
  const codeId = `cpp-code-${blockIndex}`;
  const codeRef = useRef(null);
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const codeScrollRef = useRef(null);
  const selectionRef = useRef(null);


  // --- debounce plumbing for broadcast / sync ---
  const debounceMs = 300;
  const broadcastTimerRef = useRef(null);
  const lastSentRef = useRef(initialCode ?? '');
  const pendingRemoteRef = useRef(null);


  useEffect(
    () => () => {
      if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    },
    []
  );

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
    if (!onCodeChange || !responseKey) return;
    if (broadcastTimerRef.current) clearTimeout(broadcastTimerRef.current);
    broadcastTimerRef.current = setTimeout(() => {
      sendUpstream(val, { broadcastOnly: true });
      broadcastTimerRef.current = null;
    }, debounceMs);
  };

  const handleKeyDown = (e) => {
    if (!isEditing || !editable) return;

    const el = e.target;
    const value = code;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;

    // TAB → insert indent instead of leaving textarea
    if (e.key === 'Tab') {
      e.preventDefault();
      const indent = '    '; // change to '\t' if you want hard tabs
      const newValue = value.slice(0, start) + indent + value.slice(end);
      const newPos = start + indent.length;

      setCode(newValue);
      if (editable) scheduleBroadcast(newValue);
      selectionRef.current = { start: newPos, end: newPos };
      return;
    }

    // ENTER → auto-indent
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

  const flushPendingRemoteIfAny = () => {
    if (pendingRemoteRef.current != null) {
      const incoming = pendingRemoteRef.current;
      pendingRemoteRef.current = null;
      setCode(incoming);
      setSavedCode(incoming);
      lastSentRef.current = incoming;
    }
  };

  // focus textarea when entering edit mode
  useEffect(() => {
    if (isEditing && taRef.current) {
      requestAnimationFrame(() => {
        try {
          taRef.current.focus();
          const len = taRef.current.value.length;
          taRef.current.setSelectionRange(len, len);
        } catch {
          /* ignore */
        }
      });
    }
  }, [isEditing]);

  // Prism highlight when not editing
  useEffect(() => {
    if (!isEditing && codeRef.current) {
      Prism.highlightElement(codeRef.current);
    }
  }, [isEditing, code]);

  useEffect(() => {
    if (!isEditing || !taRef.current || !selectionRef.current) return;
    const { start, end } = selectionRef.current;
    try {
      taRef.current.setSelectionRange(start, end);
    } catch { }
    selectionRef.current = null;
  }, [code, isEditing]);

  // init terminal once
  useEffect(() => {
    if (!termRef.current) return;

    const t = new Terminal({
      cursorBlink: true,
      scrollback: 1000,
      disableStdin: false,
      convertEol: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 14,
      theme: { background: '#000000' },
    });
    const f = new FitAddon();
    t.loadAddon(f);

    t.open(termRef.current);
    try {
      f.fit();
    } catch { }
    t.focus();

    term.current = t;
    fit.current = f;

    const onResize = () => {
      try {
        fit.current && fit.current.fit();
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      try {
        onDataDisposeRef.current?.dispose();
      } catch { }
      try {
        wsRef.current?.close();
      } catch { }
      try {
        term.current?.dispose();
      } catch { }
      term.current = null;
      fit.current = null;
    };
  }, []);

  // --- line numbers + scroll sync ---
  const LINE_H = 1.45;
  const EOL_SPLIT = /\r\n|\n|\r/;

  const lineNumbers = useMemo(() => {
    const n = Math.max(1, (code ?? '').split(EOL_SPLIT).length);
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

  // --- ws URL helper ---
  const wsUrl = (sid) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/cxx-run/session/ws/${sid}`;
  };

  const [includeText, setIncludeText] = useState(
    Array.isArray(includeFiles) ? includeFiles.join(', ') : ''
  );

  useEffect(() => {
    if (Array.isArray(includeFiles)) {
      setIncludeText(includeFiles.join(', '));
    }
  }, [includeFiles]);

  const parseIncludeList = (text) =>
    text
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

  const buildFilesPayload = () => {
    if (!fileContents) return undefined;
    const entries = Object.entries(fileContents);
    if (!entries.length) return undefined;

    const includeList = parseIncludeList(includeText);

    // If no includes specified: legacy behavior, send everything.
    if (!includeList.length) {
      return { ...fileContents };
    }

    const selected = {};

    // 1) Add explicitly included files if present
    for (const name of includeList) {
      if (fileContents[name] !== undefined) {
        selected[name] = fileContents[name];
      }
    }

    // 2) Always include non-C++ files as data (e.g., data.txt)
    for (const [name, content] of entries) {
      if (!/\.(cpp|cc|cxx|c)$/i.test(name) && selected[name] === undefined) {
        selected[name] = content;
      }
    }

    return Object.keys(selected).length ? selected : undefined;
  };

  // --- terminal output capture for grading ---
  const [terminalOutput, setTerminalOutput] = useState('');

  const appendOutput = (chunk) => {
    setTerminalOutput((prev) => prev + chunk);
  };

  // Derive the output key from the code key, e.g. 1acode1 -> 1aoutput1
  const outputKey = useMemo(() => {
    if (!responseKey) return '';
    return responseKey.replace(/code(\d+)$/, 'output$1');
  }, [responseKey]);

  //const baseQid = useMemo(() => {
  //  if (!responseKey) return '';
  //  // e.g., "1acode1" -> "1a"
  //  return responseKey.replace(/code\d+$/, '');
  //}, [responseKey]);

  // --- unified run: interactive + sheet files ---
  const runInteractive = async () => {
    // close previous session if any
    try {
      wsRef.current?.close();
    } catch { }
    try {
      onDataDisposeRef.current?.dispose();
    } catch { }

    setTerminalOutput('');
    term.current?.clear();
    term.current?.writeln('Compiling...');
    appendOutput('Compiling...\n');
    term.current?.focus();
    setIsRunning(true);

    try {
    const filesPayload = buildFilesPayload();
    const payload = filesPayload ? { code, files: filesPayload } : { code };

      const compileController = new AbortController();
      const compileTimer = setTimeout(() => compileController.abort(), timeLimit);
      const res = await fetch('/cxx-run/session/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: compileController.signal,
        body: JSON.stringify({
          ...payload,
          timeout_ms: timeLimit,
          idle_timeout_ms: timeLimit,
        }),
      });
      clearTimeout(compileTimer);

      const ctype = res.headers.get('content-type') || '';
      if (!ctype.includes('application/json')) {
        const text = await res.text();
        const msg = `\r\nNon-JSON response:\n${text.slice(0, 400)}`;
        term.current.writeln(msg);
        appendOutput(msg + '\n');
        setIsRunning(false);
        return;
      }

      const data = await res.json();
      if (!data.ok) {
        const msg = '\r\nCompile error:\n' + (data.compile_error || data.error || '(no details)');
        term.current.writeln(msg);
        appendOutput(msg + '\n');
        setIsRunning(false);
        return;
      }

      const ws = new WebSocket(wsUrl(data.sessionId));
      wsRef.current = ws;

      ws.onopen = () => {
        const msg = '▶ Program started. Type input; press Enter to send.\n\n';
        term.current.writeln('▶ Program started. Type input; press Enter to send.');
        term.current.writeln('');
        appendOutput(msg);
        term.current.focus();
        inputBufferRef.current = '';

        // Enforce run-time limit for the program
        try {
          clearTimeout(wsTimerRef.current);
        } catch { }
        wsTimerRef.current = setTimeout(() => {
          try {
            ws.send('\u0003');
          } catch { }
          const tmsg = `\r\n⏱️ Program time limit reached (${timeLimit} ms). Sending Ctrl+C...`;
          term.current.writeln(tmsg);
          appendOutput(tmsg + '\n');
          setTimeout(() => {
            try {
              ws.close();
            } catch { }
          }, 250);
        }, timeLimit);

        const onData = (d) => {
          if (ws.readyState !== WebSocket.OPEN) return;

          // ENTER: send buffered line
          if (d === '\r') {
            const line = inputBufferRef.current;
            term.current.write('\r\n');
            ws.send(line + '\n');
            appendOutput(line + '\n');
            inputBufferRef.current = '';
            return;
          }

          // BACKSPACE
          if (d === '\u007F') {
            if (inputBufferRef.current.length > 0) {
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              term.current.write('\b \b');
            }
            return;
          }

          // Ctrl+C
          if (d === '\u0003') {
            ws.send(d);
            inputBufferRef.current = '';
            term.current.write('^C\r\n');
            appendOutput('^C\n');
            return;
          }

          // printable char
          if (d >= ' ' && d !== '\x7f') {
            inputBufferRef.current += d;
            term.current.write(d);
            appendOutput(d);
          }
        };

        try {
          onDataDisposeRef.current?.dispose();
        } catch { }
        onDataDisposeRef.current = term.current.onData(onData);
      };

      ws.onmessage = (ev) => {
        const msg = ev.data;

        if (typeof msg === 'string' && msg.startsWith('[FILES]')) {
          if (setFileContents) {
            try {
              const updated = JSON.parse(msg.slice(7));
              setFileContents((prev) => ({
                ...(prev || {}),
                ...(updated || {}),
              }));
            } catch (e) {
              const warnMsg = '\r\n[Warning] Failed to parse returned files metadata.\r\n';
              term.current.writeln(warnMsg);
              appendOutput(warnMsg + '\n');
            }
          }
          return;
        }

        const text =
          typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
        term.current.write(text);
        appendOutput(text);
      };

      ws.onerror = () => {
        try {
          clearTimeout(wsTimerRef.current);
        } catch { }
        const msg = '\r\n[WebSocket error]';
        term.current.writeln(msg);
        appendOutput(msg + '\n');
      };

      ws.onclose = () => {
        try {
          clearTimeout(wsTimerRef.current);
        } catch { }
        try {
          onDataDisposeRef.current?.dispose();
        } catch { }
        inputBufferRef.current = '';
        const msg = '\r\n[Program finished]';
        term.current.writeln(msg);
        appendOutput(msg + '\n');
        setIsRunning(false);
      };
    } catch (e) {
      if (e?.name === 'AbortError') {
        const msg = `\r\nTimed out during compilation after ${timeLimit} ms`;
        term.current.writeln(msg);
        appendOutput(msg + '\n');
      } else {
        const msg = `\r\nError: ${e.message}`;
        term.current.writeln(msg);
        appendOutput(msg + '\n');
      }
      setIsRunning(false);
    }
  };

  // --- styles ---
  const mono =
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  const styles = {
    controls: {
      display: 'flex',
      gap: 8,
      alignItems: 'center',
      marginBottom: 8,
      flexWrap: 'wrap',
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
      background: '#ffffff',
      color: '#212529',
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

  const terminalSection = (
    <div
      ref={termRef}
      style={{
        height: 420,
        background: '#000',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    />
  );

  const editorSection = (
    <>
      <div style={styles.controls}>
        <small className="text-muted">⏱ Time limit: {timeLimit} ms</small>

        <Button
          variant="secondary"
          onClick={() => {
            setIsEditing((prev) => {
              const next = !prev;
              if (next) {
                flushPendingRemoteIfAny();
              }
              return next;
            });
          }}
        >
          {isEditing ? 'Done Editing' : 'Edit Code'}
        </Button>

        <Button
          variant="secondary"
          onClick={() => {
            if (!onCodeChange || !responseKey) return;
            onCodeChange(responseKey, code);
            setSavedCode(code);
          }}
          disabled={!editable}
        >
          Save
        </Button>

        <Button
          variant="primary"
          onClick={runInteractive}
          disabled={isRunning}
        >
          {isRunning ? 'Running…' : 'Run C++'}
        </Button>

        <Button
          variant="outline-secondary"
          onClick={() =>
            setLayoutMode((m) => (m === 'side' ? 'stacked' : 'side'))
          }
        >
          {layoutMode === 'side' ? 'Above' : 'Beside'}
        </Button>
      </div>

      {!localOnly && (
        <div className="mb-1">
          <small className="text-muted me-1">
            Included files for compile:
          </small>
          <Form.Control
            type="text"
            size="sm"
            value={includeText}
            onChange={(e) => setIncludeText(e.target.value)}
            placeholder="(all .cpp files if left blank)"
            className="d-inline-block"
          />
        </div>
      )}

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
            readOnly={false}
            onChange={(e) => {
              const v = e.target.value;
              setCode(v);
              if (editable) scheduleBroadcast(v);
            }}
            onKeyDown={handleKeyDown}
            onScroll={onTextareaScroll}
            rows={Math.max(16, (code ?? '').split(EOL_SPLIT).length)}
            className="font-monospace mt-0 bg-white text-dark"
            style={{ ...styles.textarea, minHeight: 420 }}
          />
        ) : (


          <div
            ref={codeScrollRef}
            style={{ ...styles.codeView, minHeight: 420 }}
            onScroll={onCodeViewScroll}
          >
            <pre style={styles.codePre}>
              <code
                id={codeId}
                ref={codeRef}
                className="language-cpp"
                style={styles.codeTag}
              >
                {code}
              </code>
            </pre>
          </div>
        )}
      </div>

      {codeFeedbackShown[responseKey] && (
        <div className="mt-2 p-3 border rounded bg-warning-subtle">
          <strong>AI Feedback:</strong>
          <pre className="mb-0">{codeFeedbackShown[responseKey]}</pre>
        </div>
      )}
    </>
  );


  // --- render ---
  return (
    <>
      <Row className="mb-4">
        {/* CODE: full-width in 'stacked', half-width in 'side' */}
        <Col md={layoutMode === 'side' ? 6 : 12}>
          {editorSection}
        </Col>

        {/* TERMINAL: same, but below in stacked mode via mt-3 */}
        <Col
          md={layoutMode === 'side' ? 6 : 12}
          className={layoutMode === 'side' ? '' : 'mt-3'}
        >
          {terminalSection}
        </Col>
      </Row>

      {/* Hidden mirror of code for test grading (independent of edit mode) */}
      {responseKey && (
        <textarea
          style={{ display: 'none' }}
          data-response-key={responseKey}
          readOnly
          value={code}
        />
      )}

      {/* Hidden mirror of terminal output for test grading */}
      {outputKey && (
        <pre
          style={{ display: 'none' }}
          data-output-key={outputKey}
        >
          {terminalOutput}
        </pre>
      )}
    </>
  );
}
