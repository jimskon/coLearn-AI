import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Row, Col, Button, Form } from 'react-bootstrap';
import Prism from 'prismjs';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import 'prismjs/components/prism-python';

export default function ActivityRemotePythonBlock({
  code: initialCode,
  responseKey,
  onCodeChange,
  timeLimit = 50000,
  editable = true,
  blockIndex = 0,
  localOnly = false,
  codeFeedbackShown = {},
  fileContents = {},
  setFileContents,
  includeFiles = null,
}) {
  const [code, setCode] = useState(initialCode ?? '');
  const [savedCode, setSavedCode] = useState(initialCode ?? '');
  const [isEditing, setIsEditing] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [layoutMode, setLayoutMode] = useState('side');

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
      pendingRemoteRef.current = next;
    }
  }, [initialCode, isEditing]);

  useEffect(() => {
    if (localOnly) {
      const base = initialCode ?? '';
      setCode(base);
      setSavedCode(base);
    }
  }, [localOnly, initialCode]);

  const termRef = useRef(null);
  const term = useRef(null);
  const fit = useRef(null);
  const wsRef = useRef(null);
  const wsTimerRef = useRef(null);
  const onDataDisposeRef = useRef(null);
  const inputBufferRef = useRef('');

  const codeId = `pyremote-code-${blockIndex}`;
  const codeRef = useRef(null);
  const taRef = useRef(null);
  const gutterRef = useRef(null);
  const codeScrollRef = useRef(null);
  const selectionRef = useRef(null);

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

    if (e.key === 'Tab') {
      e.preventDefault();
      const indent = '    ';
      const newValue = value.slice(0, start) + indent + value.slice(end);
      const newPos = start + indent.length;

      setCode(newValue);
      if (editable) scheduleBroadcast(newValue);
      selectionRef.current = { start: newPos, end: newPos };
      return;
    }

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
    } catch {
      /* ignore */
    }
    selectionRef.current = null;
  }, [code, isEditing]);

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
    } catch {
      /* ignore */
    }
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
      } catch {
        /* ignore */
      }
      try {
        wsRef.current?.close();
      } catch {
        /* ignore */
      }
      try {
        term.current?.dispose();
      } catch {
        /* ignore */
      }
      term.current = null;
      fit.current = null;
    };
  }, []);

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

  const wsUrl = (sid) => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${window.location.host}/py-run/session/ws/${sid}`;
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
    if (!includeList.length) {
      return { ...fileContents };
    }

    const selected = {};
    for (const name of includeList) {
      if (fileContents[name] !== undefined) {
        selected[name] = fileContents[name];
      }
    }

    for (const [name, content] of entries) {
      if (!/\.py$/i.test(name) && selected[name] === undefined) {
        selected[name] = content;
      }
    }

    return Object.keys(selected).length ? selected : undefined;
  };

  const [terminalOutput, setTerminalOutput] = useState('');
  const appendOutput = (chunk) => {
    setTerminalOutput((prev) => prev + chunk);
  };

  const outputKey = useMemo(() => {
    if (!responseKey) return '';
    return responseKey.replace(/code(\d+)$/, 'output$1');
  }, [responseKey]);

  const runInteractive = async () => {
    try {
      wsRef.current?.close();
    } catch {
      /* ignore */
    }
    try {
      onDataDisposeRef.current?.dispose();
    } catch {
      /* ignore */
    }

    setTerminalOutput('');
    term.current?.clear();
    term.current?.writeln('Starting Python...');
    appendOutput('Starting Python...\n');
    term.current?.focus();
    setIsRunning(true);

    try {
      const filesPayload = buildFilesPayload();
      const payload = filesPayload ? { code, files: filesPayload } : { code };

      const compileController = new AbortController();
      const compileTimer = setTimeout(() => compileController.abort(), timeLimit);
      const res = await fetch('/py-run/session/new', {
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
        const msg = '\r\nRun error:\n' + (data.error || data.compile_error || '(no details)');
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

        try {
          clearTimeout(wsTimerRef.current);
        } catch {
          /* ignore */
        }
        wsTimerRef.current = setTimeout(() => {
          try {
            ws.send('\u0003');
          } catch {
            /* ignore */
          }
          const tmsg = `\r\n⏱️ Program time limit reached (${timeLimit} ms). Sending Ctrl+C...`;
          term.current.writeln(tmsg);
          appendOutput(tmsg + '\n');
          setTimeout(() => {
            try {
              ws.close();
            } catch {
              /* ignore */
            }
          }, 250);
        }, timeLimit);

        const onData = (d) => {
          if (ws.readyState !== WebSocket.OPEN) return;

          if (d === '\r') {
            const line = inputBufferRef.current;
            term.current.write('\r\n');
            ws.send(line + '\n');
            appendOutput(line + '\n');
            inputBufferRef.current = '';
            return;
          }

          if (d === '\u007F') {
            if (inputBufferRef.current.length > 0) {
              inputBufferRef.current = inputBufferRef.current.slice(0, -1);
              term.current.write('\b \b');
            }
            return;
          }

          if (d === '\u0003') {
            ws.send(d);
            inputBufferRef.current = '';
            term.current.write('^C\r\n');
            appendOutput('^C\n');
            return;
          }

          if (d >= ' ' && d !== '\x7f') {
            inputBufferRef.current += d;
            term.current.write(d);
            appendOutput(d);
          }
        };

        try {
          onDataDisposeRef.current?.dispose();
        } catch {
          /* ignore */
        }
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
            } catch {
              const warnMsg = '\r\n[Warning] Failed to parse returned files metadata.\r\n';
              term.current.writeln(warnMsg);
              appendOutput(warnMsg + '\n');
            }
          }
          return;
        }

        const text = typeof msg === 'string' ? msg : new TextDecoder().decode(msg);
        term.current.write(text);
        appendOutput(text);
      };

      ws.onerror = () => {
        try {
          clearTimeout(wsTimerRef.current);
        } catch {
          /* ignore */
        }
        const msg = '\r\n[WebSocket error]';
        term.current.writeln(msg);
        appendOutput(msg + '\n');
      };

      ws.onclose = () => {
        try {
          clearTimeout(wsTimerRef.current);
        } catch {
          /* ignore */
        }
        try {
          onDataDisposeRef.current?.dispose();
        } catch {
          /* ignore */
        }
        inputBufferRef.current = '';
        const msg = '\r\n[Program finished]';
        term.current.writeln(msg);
        appendOutput(msg + '\n');
        setIsRunning(false);
      };
    } catch (e) {
      if (e?.name === 'AbortError') {
        const msg = `\r\nTimed out during startup after ${timeLimit} ms`;
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

  const handleDoneEditing = () => {
    setIsEditing(false);
    if (editable && code !== savedCode) {
      sendUpstream(code, { broadcastOnly: false });
      setSavedCode(code);
    }
    flushPendingRemoteIfAny();
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
      flexWrap: 'wrap',
    },
    editorWrap: {
      display: 'flex',
      border: '1px solid #ddd',
      borderRadius: 6,
      overflow: 'hidden',
      minHeight: 420,
      background: '#fff',
    },
    gutter: {
      width: '3.5em',
      margin: 0,
      padding: '8px 0',
      background: '#f8f9fa',
      color: '#6c757d',
      textAlign: 'right',
      userSelect: 'none',
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
              if (next) flushPendingRemoteIfAny();
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
          {isRunning ? 'Running…' : 'Run Python'}
        </Button>

        <Button
          variant="outline-secondary"
          onClick={() => setLayoutMode((m) => (m === 'side' ? 'stacked' : 'side'))}
        >
          {layoutMode === 'side' ? 'Above' : 'Beside'}
        </Button>
      </div>

      {!localOnly && (
        <div className="mb-1">
          <small className="text-muted me-1">
            Included files for run:
          </small>
          <Form.Control
            type="text"
            size="sm"
            value={includeText}
            onChange={(e) => setIncludeText(e.target.value)}
            placeholder="(all .py files and data if left blank)"
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
                className="language-python"
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

  return (
    <>
      <Row className="mb-4">
        <Col md={layoutMode === 'side' ? 6 : 12}>{editorSection}</Col>
        <Col md={layoutMode === 'side' ? 6 : 12} className={layoutMode === 'side' ? '' : 'mt-3'}>
          {terminalSection}
        </Col>
      </Row>

      {responseKey && (
        <textarea
          style={{ display: 'none' }}
          data-response-key={responseKey}
          readOnly
          value={code}
        />
      )}

      {outputKey && (
        <pre style={{ display: 'none' }} data-output-key={outputKey}>
          {terminalOutput}
        </pre>
      )}
    </>
  );
}
