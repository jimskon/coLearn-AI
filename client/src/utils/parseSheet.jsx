// parseSheet.jsx

import React, { useState, useEffect, useRef } from 'react';
import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';
import ActivityRemotePythonBlock from '../components/activity/ActivityRemotePythonBlock';
import InfoBubble from '../components/activity/InfoBubble';
import { normalizeInfoBubbleTarget } from './infoBubbleSession';
import {
  parseMultipleChoiceSelections,
  serializeMultipleChoiceSelections,
  validateMultipleChoice,
} from './multipleChoice';
import {
  getMultipleChoiceTestModeIssueMessage,
  getUnsupportedScoreTypeMessage,
  parseScoreCommand,
} from './scoreValidation';
import { makeResponseAttrs } from './responseDom';
import { API_BASE_URL } from '../config';

import { Form, Button, Spinner } from 'react-bootstrap';

import ActivityCppBlock from '../components/activity/ActivityCppBlock';
import { Alert } from 'react-bootstrap';
import { createDisplayCodeBlock, parseDisplayCodeBlockCommand } from './displayCodeBlocks';




// --- helpers ---
const coerceDrive = (url) => {
  // https://drive.google.com/file/d/<ID>/view?usp=...
  const m1 = url.match(/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (m1) return `https://drive.google.com/uc?export=view&id=${m1[1]}`;
  // https://drive.google.com/open?id=<ID>  OR any ?id=<ID>
  const m2 = url.match(/[?&]id=([^&]+)/i);
  if (m2) return `https://drive.google.com/uc?export=view&id=${m2[1]}`;
  return url;
};

const formatTimeLimit = (ms) => {
  if (ms == null) return '';
  if (ms % 60000 === 0) return `${ms / 60000} min`;
  if (ms >= 60000) return `${(ms / 60000).toFixed(1)} min`;
  if (ms % 1000 === 0) return `${ms / 1000} s`;
  return `${ms} ms`;
};

const SUPPORTED_INFO_TARGETS = new Set([
  'questiongroup',
  'question',
  'textresponse',
  'coderesponse',
  'submitbutton',
  'aifeedback',
]);

export const INLINE_AI_DEFAULT_MODEL = 'gpt-5-mini';
export const INLINE_AI_MODEL_OPTIONS = [
  { value: 'gpt-5-mini', label: 'GPT-5 mini — standard' },
  { value: 'gpt-4o-mini', label: 'GPT-4o mini — fast and economical' },
];

const normalizeInlineAiModel = (value) => {
  const model = String(value || '').trim();
  return INLINE_AI_MODEL_OPTIONS.some((option) => option.value === model)
    ? model
    : INLINE_AI_DEFAULT_MODEL;
};

const parseInfoSeconds = (value) => {
  const seconds = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 8;
};

const getInfosForTarget = (block, target) =>
  (block?.infos || []).filter((info) => info?.target === target);

export function collectInfosForTarget(source, target) {
  const out = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }

    if (Array.isArray(node.infos)) {
      node.infos.forEach((info) => {
        if (!target || info?.target === target) {
          out.push(info);
        }
      });
    }

    visit(node.prelude);
    visit(node.content);
    visit(node.blocks);
    visit(node.questions);
  };

  visit(source);
  return out;
}

function ImgWithFallback({ src, alt, widthStyle, captionHtml }) {
  const [errored, setErrored] = useState(false);

  return (
    <figure className="my-3">
      {!errored ? (
        <img
          src={src}
          alt={alt || ''}
          style={{ maxWidth: '100%', height: 'auto', ...(widthStyle ? { width: widthStyle } : {}) }}
          className="img-fluid rounded border"
          onError={() => setErrored(true)}
        />
      ) : (
        <div className="border rounded p-3 bg-light">
          <div>⚠️ <strong>Image failed to load</strong></div>
          <code style={{ wordBreak: 'break-all' }}>{src}</code>
          <div className="mt-2">
            <a href={src} target="_blank" rel="noopener noreferrer">Open image in new tab</a>
          </div>
          {/drive\.google\.com/i.test(src) && (
            <div className="small text-muted mt-1">
              Tip: Make sure the file is shared publicly or use a direct-view link:
              <br />
              <code>https://drive.google.com/uc?export=view&id=&lt;FILE_ID&gt;</code>
            </div>
          )}
        </div>
      )}

      {captionHtml && (
        <figcaption
          className="text-muted small mt-1"
          dangerouslySetInnerHTML={{ __html: captionHtml }}
        />
      )}
    </figure>
  );
}

function InlineAiAssistBlock({
  aiBlock,
  questionBlock,
  runMode,
  selectedPreviewKey,
  onSelectBlock,
}) {
  const [inputValue, setInputValue] = useState('');
  const [responseValue, setResponseValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const aiSelected = runMode === 'preview' && selectedPreviewKey === aiBlock.previewKey;

  const submitPrompt = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/ai/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mode: aiBlock.mode,
          model: aiBlock.model,
          title: aiBlock.title || 'AI Assistant',
          assistantPrompt: aiBlock.prompt || '',
          guardrail: aiBlock.guardrail || '',
          contextSources: aiBlock.contextSources || [],
          questionText: questionBlock?.prompt || '',
          sampleResponse: questionBlock?.samples?.[0] || '',
          studentCode: Array.isArray(questionBlock?.pythonBlocks)
            ? questionBlock.pythonBlocks.map((block) => block.content || '').join('\n\n').trim()
            : '',
          studentInput: trimmed,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'AI help failed.');
      setResponseValue(String(data?.response || '').trim());
    } catch (err) {
      setError(err?.message || 'AI help failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="border rounded p-3 my-3"
      data-preview-key={aiBlock.previewKey}
      onClick={(event) => {
        if (runMode !== 'preview' || typeof onSelectBlock !== 'function') return;
        if (event.target.closest('textarea, input, button, select, a')) return;
        event.stopPropagation();
        onSelectBlock(aiBlock);
      }}
      style={
        runMode === 'preview'
          ? {
            cursor: onSelectBlock ? 'pointer' : 'default',
            borderColor: aiSelected ? '#0d6efd' : '#d9dee3',
            boxShadow: aiSelected ? '0 0 0 3px rgba(13,110,253,0.12)' : 'none',
            background: aiSelected ? 'rgba(13,110,253,0.04)' : '#fcfcfd',
          }
          : {
            background: '#fcfcfd',
          }
      }
    >
      {aiBlock.title ? (
        <h5
          className="mb-2"
          dangerouslySetInnerHTML={{ __html: aiBlock.title }}
        />
      ) : null}
      {aiBlock.prompt ? (
        <div
          className="mb-3"
          dangerouslySetInnerHTML={{ __html: aiBlock.prompt }}
        />
      ) : null}
      <Form.Group>
        <Form.Label className="small text-muted mb-1">Query</Form.Label>
        <Form.Control
          as="textarea"
          rows={Math.max(aiBlock.inputRows || 4, 2)}
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          placeholder="Type your AI query here..."
        />
      </Form.Group>

      <div className="d-flex justify-content-end mt-2">
        <Button size="sm" variant="primary" disabled={busy || !inputValue.trim()} onClick={submitPrompt}>
          {busy ? <Spinner animation="border" size="sm" className="me-2" /> : null}
          Ask AI
        </Button>
      </div>

      {error ? (
        <div className="alert alert-danger mt-2 mb-0 py-2 small">{error}</div>
      ) : null}

      <Form.Group className="mt-2 mb-0">
        <Form.Label className="small text-muted mb-1">Response</Form.Label>
        <Form.Control
          as="textarea"
          rows={Math.max(Math.min((responseValue.split('\n').length || 1) + 1, 8), 3)}
          readOnly
          value={responseValue}
          placeholder="The AI response will appear here."
        />
      </Form.Group>
    </div>
  );
}

// Joins multi-line \tag{...} blocks into single logical lines by balancing braces.
// Keeps everything else as-is. Works for any \SomeTag{ ... } (including section*, link, image, etc.)
function collapseBracedCommands(rawLines) {
  const startsTag = (s) =>
    /^\s*\\(?:title|name|activitycontext|studentlevel|aicodeguidance|mode|text|section\*?|questiongroup|question|responsemode|multiplechoice|choice|sampleresponses|feedbackprompt|followupprompt|info|table|image|link|file|pythonturtle|pythonremote|cpp|include)\{/.test(s);
  const out = [];
  let buf = null;
  let depth = 0;

  const braceDelta = (s) =>
    (s.match(/\{/g)?.length || 0) - (s.match(/\}/g)?.length || 0);

  for (const line of rawLines) {
    if (buf === null) {
      if (startsTag(line)) {
        buf = line;
        depth = braceDelta(line);
        if (depth <= 0) { out.push(buf); buf = null; }
      } else {
        out.push(line);
      }
    } else {
      // keep line breaks so you can render them later
      buf += "\n" + line;
      depth += braceDelta(line);
      if (depth <= 0) { out.push(buf); buf = null; }
    }
  }
  if (buf !== null) out.push(buf); // unclosed—let downstream code surface gracefully
  return out;
}

function parseCommandArgs(line, commandName) {
  const commandMatch = line.match(new RegExp(`^\\\\${commandName}\\*?`));
  if (!commandMatch) return null;

  let i = commandMatch[0].length;
  const args = [];

  while (i < line.length && /\s/.test(line[i])) i += 1;

  while (i < line.length && line[i] === '{') {
    i += 1;
    const start = i;
    let depth = 1;

    while (i < line.length && depth > 0) {
      if (line[i] === '{') depth += 1;
      else if (line[i] === '}') depth -= 1;
      i += 1;
    }

    if (depth !== 0) return null;

    args.push(line.slice(start, i - 1));

    while (i < line.length && /\s/.test(line[i])) i += 1;
  }

  return i === line.length ? args : null;
}

export default function FileBlock({
  filename,
  fileKey,
  initialContent = '',
  fileContents,
  editable,
  setFileContents,
  onFileChange,           // 👈 NEW
}) {
  // Use live value from fileContents if present, otherwise fall back to initialContent
  const effective =
    fileContents && Object.prototype.hasOwnProperty.call(fileContents, filename)
      ? fileContents[filename]
      : initialContent;
  const lineCount = Math.max(1, String(effective || '').split('\n').length);
  const visibleRows = Math.max(4, Math.min(lineCount, 30));
  const shouldScroll = lineCount > 30;

  const [localValue, setLocalValue] = useState(effective);

  // NEW: refs to manage caret position
  const textareaRef = useRef(null);
  const pendingSelectionRef = useRef(null);
  // Marks that the next fileContents change came from THIS textarea
  const localEditRef = useRef(false);

  // Keep local in sync when parent state or initial content changes
  useEffect(() => {
    const next =
      fileContents && Object.prototype.hasOwnProperty.call(fileContents, filename)
        ? fileContents[filename]
        : initialContent;

    if (localEditRef.current) {
      localEditRef.current = false;
      return;
    }

    setLocalValue(next);
  }, [fileContents, filename, initialContent]);

  // Seed fileContents once so the runner sees authored files
  useEffect(() => {
    if (
      setFileContents &&
      initialContent &&
      (!fileContents || !Object.prototype.hasOwnProperty.call(fileContents, filename))
    ) {
      setFileContents(prev => ({
        ...prev,
        [filename]: initialContent,
      }));
    }
  }, [filename, initialContent, fileContents, setFileContents]);

  // After we update localValue due to custom key handling, restore caret
  useEffect(() => {
    if (pendingSelectionRef.current && textareaRef.current) {
      const { start, end } = pendingSelectionRef.current;
      try {
        textareaRef.current.setSelectionRange(start, end);
      } catch {
        // ignore
      }
      pendingSelectionRef.current = null;
    }
  }, [localValue]);

  const handleChange = (e) => {
    if (!editable) return;

    const newValue = e.target.value;

    // mark that the next parent sync is caused by THIS local edit
    localEditRef.current = true;

    setLocalValue(newValue);

    if (setFileContents) {
      setFileContents(prev => ({
        ...prev,
        [filename]: newValue,
      }));
    }

    if (onFileChange) {
      onFileChange(filename, newValue);
    }
  };


  // TAB inserts tab; ENTER auto-indents
  const handleKeyDown = (e) => {
    if (!editable) return;

    const el = e.target;
    const value = localValue;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;

    // Tab: insert a tab instead of leaving the textarea
    if (e.key === 'Tab') {
      e.preventDefault();
      const indent = '\t'; // or '    ' for 4 spaces
      const newValue = value.slice(0, start) + indent + value.slice(end);
      const newPos = start + indent.length;

      setLocalValue(newValue);
      if (setFileContents) {
        setFileContents(prev => ({
          ...prev,
          [filename]: newValue,
        }));
      }

      pendingSelectionRef.current = { start: newPos, end: newPos };
      return;
    }

    // Enter: auto-indent based on current line's leading whitespace
    if (e.key === 'Enter') {
      e.preventDefault();

      const lineStart = value.lastIndexOf('\n', start - 1) + 1;
      const line = value.slice(lineStart, start);
      const indentMatch = line.match(/^[\t ]*/);
      const indent = indentMatch ? indentMatch[0] : '';

      const insert = '\n' + indent;
      const newValue = value.slice(0, start) + insert + value.slice(end);
      const newPos = start + insert.length;

      setLocalValue(newValue);
      if (setFileContents) {
        setFileContents(prev => ({
          ...prev,
          [filename]: newValue,
        }));
      }

      pendingSelectionRef.current = { start: newPos, end: newPos };
      return;
    }
  };

  return (
    <div className="mb-3">
      <strong>
        File: <code>{filename}</code>
      </strong>
      <Form.Control
        as="textarea"
        value={localValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        rows={visibleRows}
        readOnly={!editable}
        className="font-monospace bg-light mt-1"
        style={{ overflowY: shouldScroll ? 'auto' : 'hidden' }}
        ref={textareaRef}
      />
    </div>
  );
}



export function parseSheetToBlocks(lines, options = {}) {
  //console.log("🧑‍💻 parseSheetToBlocks invoked");
  lines = collapseBracedCommands(lines);

  const issues = [];
  const pushIssue = (severity, line, message, context) => {
    issues.push({
      severity,               // 'error' | 'warn' | 'info'
      line,                   // 1-based line number (best-effort)
      message,
      context: context || null
    });
  };
  const normalizeMode = (rawMode) => {
    const mode = String(rawMode || '').trim().toLowerCase();

    if (mode === 'test') return 'test';
    if (mode === 'demo') return 'demo';
    if (mode === 'playground') return 'playground';
    if (mode === 'assignment') return 'assignment';
    if (mode === 'group' || mode === 'normal') return 'group';

    return 'group';
  };
  let isTest = false;
  const legacyTestNumbering = options.legacyTestNumbering === true;
  // default true unless explicitly set to false

  const blocks = [];
  let groupNumber = 0;
  let sectionNumber = 0;
  let questionLetterCode = 97;
  let responseId = 1;
  let globalRetriesRequired = 0;          // ✅ sheet default
  let currentGroupRetriesRequired = 0;    // ✅ current group effective value
  const meta = {
    isTest: false,
    retriesDefault: 0,
    groupRetries: {},
    mode: 'group',
  };
  let currentQuestion = null;
  let currentField = 'prompt';
  let currentBlock = [];
  let inList = false;
  let listType = null;
  let listItems = [];
  let listBelongsToQuestion = false;
  let inFileBlock = false;
  let currentFile = null;
  let inScoreBlock = false;
  let currentScore = null;
  let inGroup = false;
  let currentGroupIntro = null;
  let pendingIncludeFiles = null;
  let currentAiBlock = null;
  let currentMultipleChoice = null;
  let currentDisplayCodeBlock = null;

  // track some structural state to report missing closures
  let openGroupLine = null;
  let openQuestionLine = null;
  let openFileLine = null;
  let openScoreLine = null;
  let openListLine = null;
  let openAiLine = null;
  let openMultipleChoiceLine = null;
  let openDisplayCodeLine = null;

  const finalizeMultipleChoice = (closingLine) => {
    if (!currentMultipleChoice || !currentQuestion) return;

    const choices = currentMultipleChoice.choices;
    const validation = validateMultipleChoice(currentMultipleChoice.correctAnswer, choices);
    for (const message of validation.errors) {
      pushIssue('error', currentMultipleChoice.sourceMeta.multipleChoiceLine, message, null);
    }

    currentMultipleChoice.sourceMeta.endMultipleChoiceLine = closingLine;
    currentQuestion.multipleChoice = {
      correctAnswer: validation.correctAnswer,
      selectionMode: currentMultipleChoice.selectionMode,
      choices,
      hasChoiceScores: validation.hasChoiceScores,
      maxChoicePoints: validation.maxChoicePoints,
      sourceMeta: currentMultipleChoice.sourceMeta,
    };
    currentMultipleChoice = null;
    openMultipleChoiceLine = null;
  };

  // AI panels may be attached to a question (legacy markup) or may stand on
  // their own as a learning-tool block in a question group.
  const finalizeAiBlock = (closingLine) => {
    if (!currentAiBlock) return;

    currentAiBlock.sourceMeta.endAiLine = closingLine;
    if (currentAiBlock.parentQuestionId && currentQuestion) {
      currentQuestion.aiBlocks.push(currentAiBlock);
    } else {
      blocks.push(currentAiBlock);
    }
    currentAiBlock = null;
    openAiLine = null;
  };

  const finalizeDisplayCodeBlock = (closingLine) => {
    if (!currentDisplayCodeBlock) return;

    currentDisplayCodeBlock.sourceMeta.endDisplayLine = closingLine;
    const finalized = {
      ...currentDisplayCodeBlock,
      content: currentDisplayCodeBlock.lines.join('\n'),
    };

    if (currentQuestion) {
      if (!currentQuestion.displayCodeBlocks) currentQuestion.displayCodeBlocks = [];
      currentQuestion.displayCodeBlocks.push(finalized);
    } else {
      blocks.push(finalized);
    }

    currentDisplayCodeBlock = null;
    openDisplayCodeLine = null;
  };


  const flushCurrentBlock = () => {
    if (currentBlock.length > 0) {
      blocks.push({
        type: 'text',
        // lines in currentBlock are ALREADY run through format()
        content: currentBlock.join(' ').trim()
      });
      currentBlock = [];
    }
  };


  const stripHtml = (s = '') =>
    s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[^>]+>/g, '');

  const format = (text = '') => {
    const esc = (s) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    if (!text) return '';

    let s = text;
    const stash = [];
    const push = (html) => {
      const token = `__HTML_${stash.length}__`;
      stash.push(html);
      return token;
    };

    // --- 1) Handle formatted segments by STASHING real HTML ---

    // \mono{...} → monospace, preserve line breaks inside
    s = s.replace(/\\mono\{([\s\S]*?)\}/g, (_, body) =>
      push(
        `<span class="mono">${esc(body)
          .replace(/\\\\/g, '<br>')
          .replace(/\n/g, '<br>')}</span>`
      )
    );

    // \texttt{...} → same as mono
    s = s.replace(/\\texttt\{([\s\S]*?)\}/g, (_, body) =>
      push(
        `<span class="mono">${esc(body)
          .replace(/\\\\/g, '<br>')
          .replace(/\n/g, '<br>')}</span>`
      )
    );

    // \textbf{...}
    s = s.replace(/\\textbf\{([\s\S]+?)\}/g, (_, body) =>
      push(`<strong>${esc(body)}</strong>`)
    );

    // \textit{...}
    s = s.replace(/\\textit\{([\s\S]+?)\}/g, (_, body) =>
      push(`<em>${esc(body)}</em>`)
    );

    // \text{...} → just escaped text, no extra tag
    s = s.replace(/\\text\{([\s\S]+?)\}/g, (_, body) => esc(body));

    // --- 2) Escape everything that remains (plain authored text) ---

    s = esc(s);

    // --- 3) Turn \\ and newlines into <br> ---

    s = s
      .replace(/\\\\/g, '<br>')
      .replace(/\n/g, '<br>');

    // --- 4) Restore stashed HTML snippets (which are already escaped safely) ---

    stash.forEach((html, i) => {
      const token = new RegExp(`__HTML_${i}__`, 'g');
      s = s.replace(token, html);
    });

    return s;
  };


  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const lineNo = idx + 1;
    const trimmed = line.trim();
    // mark this activity as a test
    if (trimmed === '\\test') {
      isTest = true;
      meta.isTest = true;
      meta.mode = 'test';
      continue;
    }
    // --- inside a \score ... \endscore block ---
    if (inScoreBlock && currentScore && currentQuestion) {
      if (trimmed === '\\endscore') {
        if (currentScore.supported) {
          // finalize this score block
          const rawText = currentScore.lines.join('\n').trim();
          const htmlText = format(rawText);

          if (!currentQuestion.scores) currentQuestion.scores = {};
          // type is one of 'response', 'code', 'output'
          currentQuestion.scores[currentScore.type] = {
            points: currentScore.points,
            instructionsHtml: htmlText,   // for display (instructor, preview)
            instructionsRaw: rawText,     // for AI prompt building
          };
        }

        inScoreBlock = false;
        currentScore = null;
        openScoreLine = null;
        continue;
      } else {
        currentScore.lines.push(line);
        continue;
      }
    }
    // \include{file1.cpp,file2.cpp}
    if (trimmed.startsWith('\\include{')) {
      const m = trimmed.match(/^\\include\{([\s\S]+)\}$/);
      if (m) {
        pendingIncludeFiles = m[1]
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
      } else {
        pendingIncludeFiles = null;
      }
      continue;
    }

    if (trimmed.startsWith('\\info{')) {
      const args = parseCommandArgs(trimmed, 'info');
      if (!args || args.length < 2) {
        pushIssue('warn', lineNo, 'Malformed \\info{target,seconds}{message}.', line);
        continue;
      }

      const [targetSpec = '', messageRaw = ''] = args;
      const [rawTarget = '', rawSeconds = ''] = String(targetSpec)
        .split(',')
        .map((part) => part.trim());
      const target = normalizeInfoBubbleTarget(rawTarget);

      if (!SUPPORTED_INFO_TARGETS.has(target)) {
        pushIssue(
          'warn',
          lineNo,
          `Unsupported \\info target "${rawTarget}". Supported targets are questiongroup, question, textresponse, coderesponse, submitbutton, and aifeedback.`,
          line
        );
        continue;
      }

      const info = {
        target,
        seconds: parseInfoSeconds(rawSeconds),
        message: format(String(messageRaw || '').trim()),
      };

      if (currentQuestion?.type === 'question') {
        if (!currentQuestion.infos) currentQuestion.infos = [];
        currentQuestion.infos.push(info);
      } else if (currentGroupIntro?.type === 'groupIntro') {
        if (!currentGroupIntro.infos) currentGroupIntro.infos = [];
        currentGroupIntro.infos.push(info);
      } else {
        pushIssue('warn', lineNo, '\\info found outside a \\questiongroup. Ignoring.', line);
      }

      continue;
    }

    // If we're currently inside a multi-line header, keep collecting lines
    const linkMatch = trimmed.match(/^\\link\{([\s\S]+?)\}\{([\s\S]+?)\}$/);
    if (linkMatch) {
      flushCurrentBlock();
      const url = linkMatch[1].trim();
      const label = linkMatch[2].trim();
      blocks.push({ type: 'link', url, label });
      continue;
    }

    // Image: \image{url}{alt?}{size?}
    // size can be "300" (px) or "50%" (%)
    const imageMatch = trimmed.match(/^\\image\{([^}]+)\}(?:\{([^}]*)\})?(?:\{([^}]*)\})?$/);
    if (imageMatch) {
      flushCurrentBlock();
      let url = imageMatch[1].trim();
      const alt = (imageMatch[2] ?? '').trim();
      const size = (imageMatch[3] ?? '').trim(); // e.g., "300" or "50%"

      // Normalize common Google Drive links
      if (/drive\.google\.com/i.test(url)) {
        url = coerceDrive(url);
      }

      // basic allowlist: http(s) and data:image URIs
      const safe = /^(https?:\/\/|data:image\/)/i.test(url);
      if (safe) {
        blocks.push({
          type: 'image',
          src: url,
          altHtml: format(alt),     // caption (rich)
          alt: stripHtml(alt),      // alt attribute (plain)
          size
        });
      } else {
        // Emit an explicit error block so the UI shows something
        blocks.push({
          type: 'imageError',
          src: url,
          reason: 'unsupported-scheme'
        });
      }
      continue;
    }

    if (trimmed === '\\begin{itemize}' || trimmed === '\\begin{enumerate}') {
      if (inList) {
        pushIssue('warn', lineNo, 'Nested list detected. Nested lists are not supported.', line);
      }
      inList = true;
      openListLine = lineNo;
      listType = trimmed.includes('itemize') ? 'ul' : 'ol';
      listItems = [];
      listBelongsToQuestion = !!currentQuestion;
      continue;
    }

    if (trimmed === '\\end{itemize}' || trimmed === '\\end{enumerate}') {
      if (!inList) {
        pushIssue('error', lineNo, 'List end found without a matching \\begin{itemize}/\\begin{enumerate}.', line);
        continue;
      }
      if (listBelongsToQuestion && currentQuestion) {
        // list lives inside the current question: append HTML directly
        const itemsHtml = listItems
          .map(text => `<li>${format(text)}</li>`)
          .join('');
        const listHtml = `<${listType}>${itemsHtml}</${listType}>`;

        // add a line break before the list to keep spacing reasonable
        currentQuestion.prompt += '<br>' + listHtml;
      } else {
        // plain top-level list block (same behavior as before)
        blocks.push({
          type: 'list',
          listType,
          items: listItems.map(format),
        });
      }
      openListLine = null;
      inList = false;
      listType = null;
      listItems = [];
      listBelongsToQuestion = false;
      continue;
    }

    if (inList && trimmed.startsWith('\\item')) {
      listItems.push(trimmed.replace(/^\\item\s*/, ''));
      continue;
    }

    // --- display-only code blocks ---
    const displayCommand = parseDisplayCodeBlockCommand(trimmed);

    if (displayCommand?.kind === 'open') {
      flushCurrentBlock();

      if (currentDisplayCodeBlock) {
        pushIssue('error', openDisplayCodeLine ?? lineNo, 'New display-only code block started before the previous one was closed.', line);
        finalizeDisplayCodeBlock(lineNo - 1);
      }

      currentField = displayCommand.type;
      currentDisplayCodeBlock = createDisplayCodeBlock({
        type: displayCommand.type,
        language: displayCommand.language,
        displayLine: lineNo,
      });
      openDisplayCodeLine = lineNo;
      continue;
    }

    if (displayCommand?.kind === 'close') {
      if (currentDisplayCodeBlock && currentDisplayCodeBlock.type === displayCommand.type) {
        finalizeDisplayCodeBlock(lineNo);
      } else {
        pushIssue('error', lineNo, `${trimmed} without a matching \\pythondisplay or \\cppdisplay block.`, line);
      }
      currentField = 'prompt';
      continue;
    }

    if (currentDisplayCodeBlock) {
      if (trimmed === '\\endquestion' || trimmed === '\\endquestiongroup') {
        pushIssue('error', openDisplayCodeLine ?? lineNo, 'Unclosed display-only code block: missing matching end tag.', null);
        finalizeDisplayCodeBlock(lineNo - 1);
      } else {
        currentDisplayCodeBlock.lines.push(line);
        continue;
      }
    }

    // --- C++ blocks ---
    const cppMatch = trimmed.match(/^\\cpp(?:\{(\d+)\})?$/);
    if (cppMatch) {
      flushCurrentBlock();
      currentField = 'cpp';
      const timeLimit = cppMatch[1] ? parseInt(cppMatch[1]) : 5000;
      const blockObj = {
        type: 'cpp',
        lines: [],
        timeLimit,
        includeFiles: pendingIncludeFiles || null,
      };
      pendingIncludeFiles = null;
      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.cppBlocks) currentQuestion.cppBlocks = [];
        currentQuestion.cppBlocks.push(blockObj);
        // ALSO append to canonical codeBlocks with a provisional entry (content set on \endcpp)
        const nextIndex =
          (currentQuestion.codeBlocks?.length || 0) + 1;
        if (!currentQuestion.codeBlocks) currentQuestion.codeBlocks = [];
        currentQuestion.codeBlocks.push({
          lang: 'cpp',
          index: nextIndex,
          editable: true,
          content: '',          // fill on \endcpp
          timeLimit,
          includeFiles: blockObj.includeFiles || null,
        });
      } else {
        blocks.push({ ...blockObj, localOnly: !inGroup });
      }
      continue;
    }

    if (trimmed === '\\endcpp') {
      if (currentField === 'cpp') {
        const lastBlock = blocks.at(-1);
        if (lastBlock?.type === 'cpp' && lastBlock.lines) {
          lastBlock.content = lastBlock.lines.join('\n');
          delete lastBlock.lines;
        } else if (currentQuestion?.cppBlocks?.length > 0) {
          const block = currentQuestion.cppBlocks.pop();
          const content = block.lines.join('\n');
          currentQuestion.cppBlocks.push({
            type: 'cpp',
            content,
            timeLimit: block.timeLimit || 5000,
            includeFiles: block.includeFiles || null,
          });
          // mirror the content into the most-recent cpp entry in codeBlocks
          const idx = [...currentQuestion.codeBlocks]
            .reverse()
            .findIndex(cb => cb.lang === 'cpp' && !cb.content);
          if (idx !== -1) {
            const real = currentQuestion.codeBlocks.length - 1 - idx;
            currentQuestion.codeBlocks[real].content = content;
          }
        }
        currentField = 'prompt';
      }
      continue;
    }

    if (currentField === 'cpp') {
      const lastBlock = blocks.at(-1);
      if (lastBlock?.type === 'cpp' && lastBlock.lines) lastBlock.lines.push(line);
      else if (currentQuestion?.cppBlocks?.length > 0)
        currentQuestion.cppBlocks.at(-1).lines.push(line);
      continue;
    }

    const pythonMatch = trimmed.match(/^\\python(?:\{([^}]*)\})?$/);
    const pythonRemoteMatch = trimmed.match(/^\\pythonremote(?:\{([^}]*)\})?$/i);
    const turtleMatch = trimmed.match(/^\\pythonturtle(?:\{([^}]*)\})?$/i);

    if (pythonMatch) {
      flushCurrentBlock();
      currentField = 'python';

      const argStr = pythonMatch[1] ? pythonMatch[1].trim() : '';
      let timeLimit = 50000;
      let imports = null;

      if (argStr) {
        const parts = argStr
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        // If first chunk is purely digits, treat it as timeLimit
        if (parts.length > 0 && /^\d+$/.test(parts[0])) {
          timeLimit = parseInt(parts[0], 10);
          parts.shift();
        }

        // Look for imports=...
        const impPart = parts.find(p => p.toLowerCase().startsWith('imports='));
        if (impPart) {
          const listStr = impPart.slice('imports='.length).trim();
          if (listStr) {
            imports = listStr
              .split(/[;,]/)
              .map(s => s.trim())
              .filter(Boolean);
          }
        }
      }

      const blockObj = { type: 'python', lines: [], timeLimit, imports };

      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push(blockObj);

        const nextIndex = (currentQuestion.codeBlocks?.length || 0) + 1;
        currentQuestion.codeBlocks.push({
          lang: 'python',
          index: nextIndex,
          editable: true,
          content: '',        // fill on \endpython
          timeLimit,
          includeFiles: imports || null,   // not strictly needed, but consistent
        });
      } else {
        blocks.push({ ...blockObj, localOnly: !inGroup });
      }

      continue;
    }
    if (pythonRemoteMatch) {
      flushCurrentBlock();
      currentField = 'pythonremote';

      const argStr = pythonRemoteMatch[1] ? pythonRemoteMatch[1].trim() : '';
      let timeLimit = 50000;
      let imports = null;

      if (argStr) {
        const parts = argStr
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        if (parts.length > 0 && /^\d+$/.test(parts[0])) {
          timeLimit = parseInt(parts[0], 10);
          parts.shift();
        }

        const impPart = parts.find(p => p.toLowerCase().startsWith('imports='));
        if (impPart) {
          const listStr = impPart.slice('imports='.length).trim();
          if (listStr) {
            imports = listStr
              .split(/[;,]/)
              .map(s => s.trim())
              .filter(Boolean);
          }
        }
      }

      const blockObj = { type: 'pythonremote', lines: [], timeLimit, imports };

      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push(blockObj);

        const nextIndex = (currentQuestion.codeBlocks?.length || 0) + 1;
        currentQuestion.codeBlocks.push({
          lang: 'python',
          runner: 'remote',
          index: nextIndex,
          editable: true,
          content: '',
          timeLimit,
          includeFiles: imports || null,
        });
      } else {
        blocks.push({ ...blockObj, localOnly: !inGroup });
      }

      continue;
    }
    if (turtleMatch) {
      flushCurrentBlock();
      currentField = 'pythonturtle';

      const argStr = (turtleMatch[1] || '').trim();

      let timeLimit = 50000;
      let w = 600;
      let h = 400;

      if (argStr) {
        const parts = argStr
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);

        // Find a WxH token anywhere (e.g., "900x700")
        const dimToken = parts.find(p => /^\d+\s*[xX]\s*\d+$/.test(p));
        if (dimToken) {
          const m = dimToken.match(/^(\d+)\s*[xX]\s*(\d+)$/);
          w = parseInt(m[1], 10);
          h = parseInt(m[2], 10);
        }

        // Find a pure numeric token anywhere (e.g., "100000") and treat it as timeout
        // If there are multiple numeric tokens, pick the first one that is NOT part of WxH.
        const tlToken = parts.find(p => /^\d+$/.test(p));
        if (tlToken) {
          timeLimit = parseInt(tlToken, 10);
        }
      }

      const blockObj = { type: 'pythonturtle', lines: [], width: w, height: h, timeLimit };

      if (currentQuestion && currentQuestion.type === 'question') {
        if (!currentQuestion.pythonBlocks) currentQuestion.pythonBlocks = [];
        currentQuestion.pythonBlocks.push(blockObj);

        const nextIndex = (currentQuestion.codeBlocks?.length || 0) + 1;
        currentQuestion.codeBlocks.push({
          lang: 'python',          // turtle is still python
          index: nextIndex,
          editable: true,
          content: '',             // fill on \endpythonturtle
          timeLimit,
          width: w,
          height: h
        });
      } else {
        blocks.push({ ...blockObj, localOnly: !inGroup });
      }

      continue;
    }

    if (trimmed === '\\endpython' || trimmed === '\\endpythonturtle' || trimmed === '\\endpythonremote') {
      if (currentField === 'python' || currentField === 'pythonturtle' || currentField === 'pythonremote') {
        const lastBlock = blocks.at(-1);
        if ((lastBlock?.type === 'python' || lastBlock?.type === 'pythonturtle' || lastBlock?.type === 'pythonremote') && lastBlock.lines) {
          lastBlock.content = lastBlock.lines.join('\n');
          delete lastBlock.lines;
        } else if (currentQuestion?.pythonBlocks?.length > 0) {
          const block = currentQuestion.pythonBlocks.pop();
          const content = block.lines.join('\n');
          currentQuestion.pythonBlocks.push({
            type: currentField,
            content,
            timeLimit: block.timeLimit || 50000,
            width: block.width,
            height: block.height,
            imports: block.imports || null,   // 👈 preserve imports
          });

          // mirror into latest python/turtle entry in codeBlocks
          const idx = [...currentQuestion.codeBlocks]
            .reverse()
            .findIndex(cb => cb.lang === 'python' && !cb.content);
          if (idx !== -1) {
            const real = currentQuestion.codeBlocks.length - 1 - idx;
            currentQuestion.codeBlocks[real].content = content;
            // carry over turtle dimensions if present
            if (currentField === 'pythonturtle') {
              currentQuestion.codeBlocks[real].width = block.width;
              currentQuestion.codeBlocks[real].height = block.height;
            }
            if (currentField === 'pythonremote') {
              currentQuestion.codeBlocks[real].runner = 'remote';
            }
          }
        }
        currentField = 'prompt';
      }
      continue;
    }

    if (currentField === 'python' || currentField === 'pythonturtle' || currentField === 'pythonremote') {
      const lastBlock = blocks.at(-1);
      if ((lastBlock?.type === 'python' || lastBlock?.type === 'pythonturtle' || lastBlock?.type === 'pythonremote') && lastBlock.lines) {
        lastBlock.lines.push(line);
      } else if (currentQuestion?.pythonBlocks?.length > 0) {
        const lastQuestionBlock = currentQuestion.pythonBlocks.at(-1);
        lastQuestionBlock.lines.push(line);
      }
      continue;
    }

    // Start of a header (now always single logical line thanks to collapseBracedCommands)
    const headerStart = trimmed.match(/^\\(title|name|activitycontext|studentlevel|aicodeguidance|mode)\{([\s\S]*?)\}$/);
    if (headerStart) {
      flushCurrentBlock();
      const tag = headerStart[1];
      const content = headerStart[2];

      if (tag === 'mode') {
        meta.mode = normalizeMode(content);

        if (meta.mode === 'test') {
          meta.isTest = true;
        }

        blocks.push({ type: 'header', tag, content: format(meta.mode) });
        continue;
      }

      blocks.push({ type: 'header', tag, content: format(content) });
      continue;
    }

    const textArgs = parseCommandArgs(trimmed, 'text');
    if (textArgs) {
      flushCurrentBlock();
      const [content = ''] = textArgs;
      const formatted = format(content);

      if (currentQuestion) {
        currentQuestion.prompt += (currentQuestion.prompt ? ' ' : '') + formatted;
      } else {
        blocks.push({
          type: 'text',
          content: formatted,
        });
      }
      continue;
    }

    // Backward-compatible section timing:
    // \section{Title} or \section{Title}{10}
    const sectionArgs = parseCommandArgs(trimmed, 'section');
    if (sectionArgs) {
      flushCurrentBlock();
      const [title, minutesRaw] = sectionArgs;

      if (sectionArgs.length === 1) {
        sectionNumber += 1;
        blocks.push({
          type: 'section',
          key: `section-${sectionNumber}`,
          title: format(title),
          minutes: null,
        });
        continue;
      }

      if (sectionArgs.length === 2 && /^\d+$/.test((minutesRaw || '').trim())) {
        sectionNumber += 1;
        blocks.push({
          type: 'section',
          key: `section-${sectionNumber}`,
          title: format(title),
          minutes: Math.max(1, parseInt(minutesRaw.trim(), 10) || 0),
        });
        continue;
      }
    }

    const sectionPrefixMatch = trimmed.match(/^\\section\*?\{/);
    if (sectionPrefixMatch) {
      flushCurrentBlock();
      pushIssue('error', lineNo, 'Malformed \\section command. Use \\section{Title} or \\section{Title}{10}.', line);
      blocks.push({
        type: 'text',
        content: format(trimmed),
      });
      continue;
    }

    // questiongroup: \questiongroup{...}
    if (trimmed.startsWith('\\questiongroup{')) {
      flushCurrentBlock();

      if (inGroup) {
        pushIssue('warn', lineNo, 'Nested \\questiongroup encountered. Did you forget \\endquestiongroup?', line);
      }

      const m = trimmed.match(/\\questiongroup\{([\s\S]+?)\}/);
      const contentRaw = m ? m[1] : '';
      const content = format(contentRaw.trimStart());

      groupNumber++;
      inGroup = true;
      openGroupLine = lineNo;

      questionLetterCode = 97;

      // ✅ reset per group
      currentGroupRetriesRequired = globalRetriesRequired;

      blocks.push({
        type: 'groupIntro',
        groupId: groupNumber,
        previewKey: `group:${groupNumber}`,
        content,
        infos: [],
        retriesRequired: currentGroupRetriesRequired, // ✅ include it
        sourceMeta: {
          groupLine: lineNo,
          endGroupLine: null,
          retriesLine: null,
        },
      });
      currentGroupIntro = blocks.at(-1);
      meta.groupRetries[groupNumber] = currentGroupRetriesRequired;
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      if (!inGroup) {
        pushIssue('error', lineNo, '\\endquestiongroup without a matching \\questiongroup', line);
      }
      if (currentAiBlock) {
        pushIssue('error', lineNo, 'Closing group while an \\ai block is still open. Missing \\endai before \\endquestiongroup.', line);
        finalizeAiBlock(lineNo - 1);
      }
      if (currentQuestion) {
        pushIssue('error', lineNo, 'Closing group while a \\question is still open. Missing \\endquestion before \\endquestiongroup.', line);
      }
      if (currentMultipleChoice) {
        pushIssue('error', openMultipleChoiceLine ?? lineNo, 'Unclosed \\multiplechoice block: missing \\endmultiplechoice before \\endquestiongroup.', null);
        finalizeMultipleChoice(lineNo - 1);
      }
      if (currentDisplayCodeBlock) {
        pushIssue('error', openDisplayCodeLine ?? lineNo, 'Unclosed display-only code block: missing matching end tag before \\endquestiongroup.', null);
        finalizeDisplayCodeBlock(lineNo - 1);
      }
      if (currentGroupIntro?.sourceMeta) {
        currentGroupIntro.sourceMeta.endGroupLine = lineNo;
      }
      blocks.push({
        type: 'endGroup',
        groupId: groupNumber,
        sourceMeta: { endGroupLine: lineNo },
      });
      inGroup = false;
      openGroupLine = null;
      currentGroupIntro = null;
      continue;
    }

    if (trimmed.startsWith('\\retries')) {
      const match = trimmed.match(/^\\retries\{(\d+)\}\s*$/);

      if (!match) {
        pushIssue('error', lineNo, 'Malformed \\retries{n}. Expected \\retries{<nonnegative integer>}.', line);
        continue;
      }

      const n = Math.max(0, parseInt(match[1], 10) || 0);

      // ✅ If not in a group, this is the sheet-global default
      if (!inGroup) {
        globalRetriesRequired = n;
        meta.retriesDefault = n;
        // also update currentGroupRetriesRequired only if we haven't started a group yet (optional)
        continue;
      }

      // ✅ If in a group but inside a question, ignore (keep your rule)
      if (currentQuestion) {
        pushIssue('warn', lineNo, '\\retries{n} found inside a \\question. Put it before questions. Ignoring.', line);
        continue;
      }

      // ✅ Group-level override
      currentGroupRetriesRequired = n;
      meta.groupRetries[groupNumber] = n;

      // patch groupIntro so render/run can see it
      const gi = [...blocks].reverse().find(b => b.type === 'groupIntro' && b.groupId === groupNumber);
      if (gi) {
        gi.retriesRequired = n;
        if (gi.sourceMeta) gi.sourceMeta.retriesLine = lineNo;
      }

      continue;
    }
    if (trimmed.startsWith('\\question{')) {
      if (!inGroup) {
        pushIssue('error', lineNo, '\\question found outside of any \\questiongroup. (All interactive content must be inside a group.)', line);
      }
      if (currentQuestion) {
        pushIssue('error', lineNo, 'New \\question started before previous \\question was closed. Missing \\endquestion.', line);
      }

      const open = trimmed.indexOf('{');
      const close = trimmed.lastIndexOf('}');
      const raw = (open >= 0 && close > open)
        ? trimmed.slice(open + 1, close)
        : trimmed.slice(open + 1);

      const id = String.fromCharCode(questionLetterCode++);
      const rawClean = raw.trimStart();

      currentQuestion = {
        type: 'question',
        id,
        groupId: groupNumber,
        previewKey: `question:${groupNumber}:${id}`,
        label: `${id}.`,
        responseId: responseId++,
        prompt: format(rawClean),
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: [],
        responseMode: 'answer',
        aiBlocks: [],
        infos: [],
        codeBlocks: [],
        displayCodeBlocks: [],
        scores: {},
        retriesRequired: currentGroupRetriesRequired,
        sourceMeta: {
          questionLine: lineNo,
          responseModeLine: null,
          responseMode: 'answer',
          textResponseLine: null,
          sampleLines: [],
          feedbackLines: [],
          followupLines: [],
          endQuestionLine: null,
        },
      };

      openQuestionLine = lineNo;
      continue;
    }

    if (currentMultipleChoice) {
      if (trimmed === '\\endmultiplechoice') {
        finalizeMultipleChoice(lineNo);
        continue;
      }

      // Accept a legacy/escaped point delimiter (\\{2}) as well as the documented {2}
      // form, then store only the option text and numeric point value.
      const choiceMatch = trimmed.match(/^\\choice\{([\s\S]*?)\}(?:\\?\{(\d+)\})?\s*$/);
      if (choiceMatch) {
        const value = String(choiceMatch[1] || '').trim();
        if (!value) {
          pushIssue('error', lineNo, '\\choice{value} requires a non-empty value.', line);
        } else {
          currentMultipleChoice.choices.push({
            value,
            content: format(value),
            points: choiceMatch[2] === undefined ? null : Number.parseInt(choiceMatch[2], 10),
            line: lineNo,
          });
          currentMultipleChoice.sourceMeta.choiceLines.push(lineNo);
        }
        continue;
      }

      if (trimmed === '\\endquestion' || trimmed === '\\endquestiongroup') {
        pushIssue('error', openMultipleChoiceLine ?? lineNo, 'Unclosed \\multiplechoice block: missing \\endmultiplechoice.', null);
        finalizeMultipleChoice(lineNo - 1);
      } else {
          pushIssue('error', lineNo, 'Only \\choice{value} or \\choice{value}{points}, or \\endmultiplechoice is allowed inside a \\multiplechoice block.', line);
        continue;
      }
    }

    if (trimmed.startsWith('\\multiplechoice')) {
      if (!currentQuestion) {
        pushIssue('error', lineNo, '\\multiplechoice found outside of a \\question.', line);
        continue;
      }
      if (currentMultipleChoice || currentQuestion.multipleChoice) {
        pushIssue('error', lineNo, 'A question can contain only one \\multiplechoice block.', line);
        continue;
      }

      const match = trimmed.match(/^\\multiplechoice\{([\s\S]*?)\}\s*$/);
      if (!match) {
        pushIssue('error', lineNo, 'Malformed \\multiplechoice. Use \\multiplechoice{correct answer}.', line);
        continue;
      }

      currentMultipleChoice = {
        correctAnswer: String(match[1] || '').trim().toLowerCase() === 'multiple'
          ? ''
          : String(match[1] || '').trim(),
        selectionMode: String(match[1] || '').trim().toLowerCase() === 'multiple'
          ? 'multiple'
          : 'single',
        choices: [],
        sourceMeta: {
          multipleChoiceLine: lineNo,
          choiceLines: [],
          endMultipleChoiceLine: null,
        },
      };
      openMultipleChoiceLine = lineNo;
      continue;
    }

    if (trimmed === '\\endmultiplechoice') {
      pushIssue('error', lineNo, '\\endmultiplechoice without a matching \\multiplechoice{...}.', line);
      continue;
    }

    if (trimmed.startsWith('\\choice')) {
      pushIssue('error', lineNo, '\\choice{value} found outside of a \\multiplechoice block.', line);
      continue;
    }

    if (trimmed === '\\endquestion') {
      if (!currentQuestion) {
        pushIssue('error', lineNo, '\\endquestion without a matching \\question{...}', line);
        continue;
      }

      if (currentAiBlock) {
        pushIssue('error', lineNo, 'Closing question while an \\ai block is still open. Missing \\endai before \\endquestion.', line);
        finalizeAiBlock(lineNo - 1);
      }

      if (currentMultipleChoice) {
        pushIssue('error', openMultipleChoiceLine ?? lineNo, 'Unclosed \\multiplechoice block: missing \\endmultiplechoice before \\endquestion.', null);
        finalizeMultipleChoice(lineNo - 1);
      }

      const multipleChoiceScoreIssue = getMultipleChoiceTestModeIssueMessage({
        isTest,
        hasMultipleChoice: !!currentQuestion.multipleChoice,
        correctAnswer: currentQuestion.multipleChoice?.correctAnswer,
        hasResponseScore: !!currentQuestion.scores?.response,
        hasChoiceScores: !!currentQuestion.multipleChoice?.hasChoiceScores,
      });
      if (multipleChoiceScoreIssue) {
        pushIssue('error', openQuestionLine ?? lineNo, multipleChoiceScoreIssue, line);
      }

      if (currentQuestion.multipleChoice?.hasChoiceScores && !currentQuestion.scores?.response) {
        currentQuestion.scores.response = {
          points: currentQuestion.multipleChoice.maxChoicePoints,
          instructionsHtml: '',
          instructionsRaw: '',
          derivedFromChoices: true,
        };
      }

      // finalize as you already do
      const hasAnyCode =
        (currentQuestion.codeBlocks?.length || 0) > 0 ||
        (currentQuestion.pythonBlocks?.length || 0) > 0 ||
        (currentQuestion.cppBlocks?.length || 0) > 0;
      const hasTable = !!currentQuestion.hasTableResponse;

      currentQuestion.hasPython = !!(currentQuestion.pythonBlocks && currentQuestion.pythonBlocks.length);
      currentQuestion.hasCpp = !!(currentQuestion.cppBlocks && currentQuestion.cppBlocks.length);
      currentQuestion.hasPythonOnly = currentQuestion.hasPython && !currentQuestion.hasTextResponse;
      currentQuestion.hasCodeOnly = hasAnyCode && !currentQuestion.hasTextResponse && !hasTable;
      if (currentQuestion.sourceMeta) {
        currentQuestion.sourceMeta.endQuestionLine = lineNo;
      }

      currentQuestion._initialCode =
        (currentQuestion.codeBlocks?.map(cb => cb.content || '') || []).filter(x => x !== undefined);

      blocks.push(currentQuestion);
      currentQuestion = null;
      openQuestionLine = null;
      continue;
    }

    if (trimmed.startsWith('\\responsemode{')) {
      if (!currentQuestion) {
        pushIssue('error', lineNo, '\\responsemode found outside of a \\question.', line);
        continue;
      }

      const match = trimmed.match(/^\\responsemode\{([\s\S]*?)\}\s*$/);
      const responseMode = String(match?.[1] || '').trim().toLowerCase();
      if (!responseMode) {
        pushIssue('error', lineNo, '\\responsemode must be \\responsemode{answer} or \\responsemode{questions}.', line);
        continue;
      }

      if (!['answer', 'questions'].includes(responseMode)) {
        pushIssue('error', lineNo, `Unsupported \\responsemode{${responseMode}}. Use \\responsemode{answer} or \\responsemode{questions}.`, line);
        continue;
      }

      currentQuestion.responseMode = responseMode;
      currentQuestion.sourceMeta.responseMode = responseMode;
      currentQuestion.sourceMeta.responseModeLine = lineNo;
      continue;
    }

    if (trimmed.startsWith('\\ai{')) {
      if (!inGroup) {
        pushIssue('error', lineNo, '\\ai found outside of a \\questiongroup. Put AI blocks inside a question group.', line);
        continue;
      }

      if (currentAiBlock) {
        pushIssue('error', lineNo, 'New \\ai block started before the previous \\ai block was closed. Missing \\endai.', line);
        finalizeAiBlock(lineNo - 1);
      }

      const match = trimmed.match(/^\\ai\{([\s\S]*?)\}\s*$/);
      const mode = String(match?.[1] || 'explain').trim().toLowerCase() || 'explain';
      const isQuestionAttached = !!currentQuestion;
      const aiIndex = isQuestionAttached
        ? (currentQuestion.aiBlocks?.length || 0) + 1
        : blocks.filter((block) => block?.type === 'ai' && block?.groupId === groupNumber).length + 1;

      currentAiBlock = {
        type: 'ai',
        parentQuestionId: isQuestionAttached ? currentQuestion.id : null,
        groupId: isQuestionAttached ? currentQuestion.groupId : groupNumber,
        previewKey: isQuestionAttached
          ? `ai:${currentQuestion.groupId}:${currentQuestion.id}:${aiIndex}`
          : `ai:${groupNumber}:standalone:${aiIndex}`,
        mode,
        model: INLINE_AI_DEFAULT_MODEL,
        title: format('AI Coach'),
        prompt: '',
        guardrail: '',
        contextSources: [],
        inputRows: 4,
        sourceMeta: {
          aiLine: lineNo,
          modelLine: null,
          titleLine: null,
          promptLine: null,
          guardrailLine: null,
          contextLine: null,
          inputLine: null,
          endAiLine: null,
        },
      };
      openAiLine = lineNo;
      continue;
    }

    if (trimmed === '\\endai') {
      if (!currentAiBlock) {
        pushIssue('error', lineNo, '\\endai without a matching \\ai{...}', line);
        continue;
      }

      finalizeAiBlock(lineNo);
      continue;
    }

    if (currentAiBlock) {
      const modelMatch = trimmed.match(/^\\aimodel\{([\s\S]*?)\}\s*$/);
      if (modelMatch) {
        const requestedModel = String(modelMatch[1] || '').trim();
        currentAiBlock.model = normalizeInlineAiModel(requestedModel);
        currentAiBlock.sourceMeta.modelLine = lineNo;
        if (requestedModel && requestedModel !== currentAiBlock.model) {
          pushIssue('warn', lineNo, `Unsupported AI model "${requestedModel}"; using ${INLINE_AI_DEFAULT_MODEL}.`, line);
        }
        continue;
      }

      const titleMatch = trimmed.match(/^\\aititle\{([\s\S]*?)\}\s*$/);
      if (titleMatch) {
        currentAiBlock.title = format(titleMatch[1] || '');
        currentAiBlock.sourceMeta.titleLine = lineNo;
        continue;
      }

      const promptMatch = trimmed.match(/^\\aiprompt\{([\s\S]*?)\}\s*$/);
      if (promptMatch) {
        currentAiBlock.prompt = format(promptMatch[1] || '');
        currentAiBlock.sourceMeta.promptLine = lineNo;
        continue;
      }

      const guardrailMatch = trimmed.match(/^\\aiguardrail\{([\s\S]*?)\}\s*$/);
      if (guardrailMatch) {
        currentAiBlock.guardrail = format(guardrailMatch[1] || '');
        currentAiBlock.sourceMeta.guardrailLine = lineNo;
        continue;
      }

      const contextMatch = trimmed.match(/^\\aicontext\{([\s\S]*?)\}\s*$/);
      if (contextMatch) {
        currentAiBlock.contextSources = String(contextMatch[1] || '')
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean);
        currentAiBlock.sourceMeta.contextLine = lineNo;
        continue;
      }

      const inputMatch = trimmed.match(/^\\aiinput\{(\d+)\}\s*$/);
      if (inputMatch) {
        currentAiBlock.inputRows = Math.max(2, parseInt(inputMatch[1], 10) || 4);
        currentAiBlock.sourceMeta.inputLine = lineNo;
        continue;
      }

      if (trimmed) {
        pushIssue('warn', lineNo, `Unrecognized content inside \\ai block ignored: ${trimmed}`, line);
      }
      continue;
    }

    // --- scoring blocks: \score{n,type} ... \endscore ---
    const scoreMatch = parseScoreCommand(trimmed);
    if (scoreMatch && currentQuestion) {
      const { points, type: scoreType, supported } = scoreMatch;
      if (!supported) {
        pushIssue('error', lineNo, getUnsupportedScoreTypeMessage(scoreType), line);
      }

      inScoreBlock = true;
      openScoreLine = lineNo;
      currentScore = { type: scoreType, points, lines: [], supported };
      continue;
    }

    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (match && currentQuestion) {
        currentQuestion.responseLines = parseInt(match[1]);
        currentQuestion.hasTextResponse = true;
        if (currentQuestion.sourceMeta) {
          currentQuestion.sourceMeta.textResponseLine = lineNo;
        }
      }
      continue;
    }

    if (trimmed.startsWith('\\sampleresponses{')) {
      const m = trimmed.match(/\\sampleresponses\{([\s\S]+?)\}/);
      if (m && currentQuestion) {
        currentQuestion.samples.push(format(m[1]));
        currentQuestion.sourceMeta?.sampleLines.push(lineNo);
      }
      continue;
    }
    if (trimmed.startsWith('\\feedbackprompt{')) {
      const m = trimmed.match(/\\feedbackprompt\{([\s\S]+?)\}/);
      if (m && currentQuestion) {
        currentQuestion.feedback.push(format(m[1]));
        currentQuestion.sourceMeta?.feedbackLines.push(lineNo);
      }
      continue;
    }
    if (trimmed.startsWith('\\followupprompt{')) {
      const m = trimmed.match(/\\followupprompt\{([\s\S]+?)\}/);
      if (m && currentQuestion) {
        const raw = (m[1] || '').trim();
        if (raw) {
          currentQuestion.followups.push(format(raw));
          currentQuestion.sourceMeta?.followupLines.push(lineNo);
        }
      }
      continue;
    }


    const textbfMatch = trimmed.match(/^\\textbf\{(.+?)\}$/);
    if (textbfMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'text', content: `<strong>${textbfMatch[1]}</strong>` });
      continue;
    }

    // --- Handle tables ---
    if (trimmed.startsWith('\\table{')) {
      flushCurrentBlock();
      const m = trimmed.match(/\\table\{([\s\S]+?)\}/);
      const title = m ? m[1] : '';
      const newTable = { type: 'table', title: format(title), rows: [] };

      if (currentQuestion?.type === 'question') {
        if (!currentQuestion.tableBlocks) currentQuestion.tableBlocks = [];
        currentQuestion.tableBlocks.push(newTable);
      } else {
        currentQuestion = newTable; // standalone table
      }
      continue;
    }

    if (trimmed === '\\endtable') {
      if (currentQuestion?.type === 'table') {
        blocks.push(currentQuestion);
        currentQuestion = null;
      }
      continue;
    }

    if (trimmed.startsWith('\\row')) {
      const target = currentQuestion?.type === 'question'
        ? currentQuestion.tableBlocks?.at(-1)
        : currentQuestion;

      if (target?.type === 'table') {
        const rawCells = trimmed.replace(/^\\row\s*/, '').split('&');
        const cells = rawCells.map(cell => {
          const trimmedCell = cell.trim();
          const isInput = trimmedCell === '\\tresponse';

          if (isInput && currentQuestion?.type === 'question') {
            currentQuestion.hasTableResponse = true;
          }

          return isInput
            ? { type: 'input' }
            : { type: 'static', content: format(trimmedCell) };
        });

        target.rows.push(cells);
      }
      continue;
    }

    if (trimmed.startsWith('\\file{')) {
      flushCurrentBlock();

      if (inFileBlock) {
        pushIssue('error', lineNo, 'Nested \\file encountered. Missing \\endfile for previous file block.', line);
      }

      inFileBlock = true;
      openFileLine = lineNo;

      const m = trimmed.match(/\\file\{([\s\S]+?)\}/);
      const inner = m?.[1]?.trim() || '';

      const parts = inner.split(',').map(s => s.trim()).filter(Boolean);
      const filename = parts[0] || '';
      const readonly = (parts[1]?.toLowerCase() === 'readonly');

      if (!filename) {
        pushIssue('error', lineNo, '\\file{...} is missing a filename.', line);
      }

      currentFile = { type: 'file', filename, readonly, lines: [] };
      continue;
    }

    if (trimmed === '\\endfile') {
      if (!inFileBlock || !currentFile) {
        pushIssue('error', lineNo, '\\endfile without a matching \\file{...}', line);
        continue;
      }

      blocks.push({ ...currentFile, content: currentFile.lines.join('\n') });
      currentFile = null;
      inFileBlock = false;
      openFileLine = null;
      continue;
    }

    if (inFileBlock && currentFile) {
      currentFile.lines.push(line);
      continue;
    }

    if (currentQuestion) {
      currentQuestion.prompt += ' ' + format(line);
    } else {
      currentBlock.push(format(line));
    }
  }

  flushCurrentBlock();

  // ✅ report any unclosed structures
  if (currentMultipleChoice) {
    pushIssue('error', openMultipleChoiceLine ?? null, 'Unclosed \\multiplechoice block: missing \\endmultiplechoice at end of document.', null);
    finalizeMultipleChoice(lines.length);
  }
  if (currentDisplayCodeBlock) {
    pushIssue('error', openDisplayCodeLine ?? null, 'Unclosed display-only code block: missing matching end tag at end of document.', null);
    finalizeDisplayCodeBlock(lines.length);
  }
  if (currentQuestion) {
    pushIssue('error', openQuestionLine ?? null, 'Unclosed \\question: missing \\endquestion at end of document.', null);
  }
  if (inGroup) {
    pushIssue('error', openGroupLine ?? null, 'Unclosed \\questiongroup: missing \\endquestiongroup at end of document.', null);
  }
  if (inFileBlock) {
    pushIssue('error', openFileLine ?? null, 'Unclosed \\file block: missing \\endfile at end of document.', null);
  }
  if (inScoreBlock) {
    pushIssue('error', openScoreLine ?? null, 'Unclosed \\score block: missing \\endscore at end of document.', null);
  }
  if (currentAiBlock) {
    pushIssue('error', openAiLine ?? null, 'Unclosed \\ai block: missing \\endai at end of document.', null);
  }
  if (inList) {
    pushIssue('error', openListLine ?? null, 'Unclosed list: missing \\end{itemize} or \\end{enumerate}.', null);
  }

  // Legacy tests only: renumber all questions sequentially: 1., 2., 3., ...
  if (isTest && legacyTestNumbering) {
    let q = 0;
    for (const b of blocks) {
      if (b.type === 'question') {
        q += 1;
        b.label = `${q}.`;
      }
    }
  }


  // ✅ backward compatible return
  meta.isTest = !!isTest;
  meta.retriesDefault = globalRetriesRequired;

  if (options.returnIssues) {
    return { blocks, issues, meta };
  }

  return blocks;
}


// turn rich prompt HTML into plain text for the AI
const stripHtml = (s = '') =>
  s.replace(/<br\s*\/?>/gi, '\n')   // <br> -> newline
    .replace(/<\/?[^>]+>/g, '');     // drop other tags

// utils/parseSheet.jsx
const HIDE_FROM_STUDENTS_HEADERS = new Set([
  'aicodeguidance',
  'activitycontext',
  'studentlevel',
  'mode',
]);

export function renderBlocks(blocks, options = {}) {
  const {
    editable = false,
    isActive = false,
    isObserver = false,
    isInstructor = false,
    isTestMode = false,
    allowLocalToggle = true,
    prefill = {},
    mode: runMode = 'preview',
    currentGroupIndex = null,
    followupsShown = {},
    followupAnswers = {},
    setFollowupAnswers = () => { },
    onCodeChange = null,
    codeFeedbackShown = {},
    fileContents,
    setFileContents,
    textFeedbackShown = {},
    unansweredShown = {},
    onFileChange = null,
    infoBubbleSession = null,
    runtimeFeatures = {},
    onSelectBlock = null,
    selectedPreviewKey = null,
    renderInsertBeforeQuestion = null,
    renderInsertAfterQuestion = null,
    renderInsertBeforeGroup = null,
    renderInsertAfterGroup = null,
    suppressStudentTestFeedbackUi = false,
    hideStudentTestSections = false,
  } = options;

  let standaloneCodeCounter = 1;
  let infoBubbleSequence = 1;
  const hiddenTypes = ['sampleresponses', 'feedbackprompt', 'followupprompt'];
  const canEditTable =
    runMode === 'preview'
      ? editable
      : (editable && isActive);   // only active student edits in RUN

  const renderInfoBubbles = (block, target, keyPrefix, anchorRef, bubbleOptions = {}) => {
    if (suppressStudentTestFeedbackUi && !isInstructor) return null;
    const bubbleSession = bubbleOptions.infoBubbleSession || infoBubbleSession;
    const bubbleKey = `${keyPrefix}-${target}`;
    const infos = getInfosForTarget(block, target);
    if (!infos.length) return null;

    const placement = bubbleOptions.placement || 'top';
    const dismissOnTargetInput = !!bubbleOptions.dismissOnTargetInput;
    const firstInfo = infos[0];

    return (
      <InfoBubble
        key={bubbleKey}
        info={firstInfo}
        showKey={bubbleKey}
        anchorRef={anchorRef}
        placement={placement}
        dismissOnTargetInput={dismissOnTargetInput}
        infoBubbleSession={bubbleSession}
        sequence={infoBubbleSequence++}
      />
    );
  };

  return blocks.map((block, index) => {
    if (hiddenTypes.includes(block.type) && runMode !== 'preview') return null;
    if (block.type === 'endGroup') {
      const nextBlock = blocks[index + 1];
      return nextBlock?.type === 'groupIntro' || typeof renderInsertAfterGroup !== 'function'
        ? null
        : renderInsertAfterGroup(block);
    }

    // A standalone AI panel is a group-level learning tool, not a question and
    // not a response. It therefore has no grading, retry, or response state.
    if (block.type === 'ai') {
      return (
        <InlineAiAssistBlock
          key={`group-ai-${block.groupId}-${block.previewKey}`}
          aiBlock={block}
          questionBlock={null}
          runMode={runMode}
          selectedPreviewKey={selectedPreviewKey}
          onSelectBlock={onSelectBlock}
        />
      );
    }

    // 🔹 Render headers (title/name/activitycontext/studentlevel) inline where they appear
    if (block.type === 'header') {
      // Hide metadata headers from students in RUN mode.
      // In PREVIEW mode (authoring), show to everyone.
      const isMeta = HIDE_FROM_STUDENTS_HEADERS.has(block.tag);
      const isPreview = runMode === 'preview';

      if (!isPreview && isMeta && !isInstructor) {
        // Student in RUN mode → hide these headers
        return null;
      }

      // Labels for display
      const labelMap = {
        title: 'Title',
        name: 'Name',
        activitycontext: 'Context',
        studentlevel: 'Student level',
        aicodeguidance: 'AI code guidance',
      };
      const label = labelMap[block.tag] || block.tag;

      // Make guidance extra-readable for instructors (formatted block)
      if (block.tag === 'aicodeguidance' && (isInstructor || isPreview)) {
        const text = (block.content || '')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/?[^>]+>/g, '');
        return (
          <div key={`guidance-${index}`} className="alert alert-info my-2">
            <strong>{label}:</strong>
            <pre className="mb-0 mt-2" style={{ whiteSpace: 'pre-wrap' }}>{text}</pre>
          </div>
        );
      }

      // Default inline header rendering
      return (
        <p key={`hdr-${index}`} className="my-1 text-muted">
          <strong>{label}:</strong>{' '}
          <span dangerouslySetInnerHTML={{ __html: block.content }} />
        </p>
      );
    }

    if (block.type === 'section') {
      if (hideStudentTestSections && runMode !== 'preview' && !isInstructor) {
        return null;
      }
      return (
        <h2 key={`section-${index}`} className="my-3">
          {block.title}
          {block.minutes ? (
            <small className="text-muted ms-2 fw-normal">
              (Section timer: {block.minutes} minute{block.minutes === 1 ? '' : 's'})
            </small>
          ) : null}
        </h2>
      );
    }

    if (block.type === 'text') {
      return (
        <p key={`text-${index}`} className="my-2">
          <span dangerouslySetInnerHTML={{ __html: block.content }} />
        </p>
      );
    }

    if (block.type === 'list') {
      const ListTag = block.listType === 'ul' ? 'ul' : 'ol';
      return (
        <ListTag key={`list-${index}`} className="my-2 list-disc list-inside">
          {block.items.map((item, i) => (
            <li
              key={`list-item-${i}`}
              dangerouslySetInnerHTML={{ __html: item }}
            />))}
        </ListTag>
      );
    }

    if (block.type === 'link') {
      return (
        <p key={`link-${index}`}>
          <a href={block.url} target="_blank" rel="noopener noreferrer">
            {block.label}
          </a>
        </p>
      );
    }

    if (block.type === 'image') {
      let widthStyle;
      if (block.size) {
        if (/^\d+%$/.test(block.size)) widthStyle = block.size;       // percent
        else if (/^\d+$/.test(block.size)) widthStyle = `${block.size}px`; // pixels
      }

      return (
        <ImgWithFallback
          key={`img-${index}`}
          src={block.src}
          alt={block.alt}
          widthStyle={widthStyle}
          captionHtml={block.altHtml}
        />
      );
    }
    if (block.type === 'imageError') {
      return (
        <div key={`imgerr-${index}`} className="border rounded p-3 bg-light my-3">
          <div>⚠️ <strong>Image error</strong> — unsupported or unsafe source</div>
          <code style={{ wordBreak: 'break-all' }}>{block.src}</code>
        </div>
      );
    }


    if (block.type === 'groupIntro') {
      const groupIntroAnchorRef = React.createRef();
      const isSelectedPreviewGroup = runMode === 'preview' && selectedPreviewKey === block.previewKey;
      const retriesRequired = Number.isFinite(Number(block.retriesRequired))
        ? Math.max(0, Number(block.retriesRequired))
        : null;
      return (
        <React.Fragment key={`groupIntro-${index}`}>
          {typeof renderInsertBeforeGroup === 'function' ? renderInsertBeforeGroup(block) : null}
          <div
            className="mb-2"
            ref={groupIntroAnchorRef}
            data-preview-key={block.previewKey}
            onClick={(event) => {
              if (runMode !== 'preview' || typeof onSelectBlock !== 'function') return;
              if (event.target.closest('button, input, textarea, select, a')) return;
              onSelectBlock(block);
            }}
            style={
              runMode === 'preview'
                ? {
                  cursor: onSelectBlock ? 'pointer' : 'default',
                  border: isSelectedPreviewGroup ? '2px solid #0d6efd' : '1px solid transparent',
                  borderRadius: 8,
                  padding: '0.35rem 0.5rem',
                  background: isSelectedPreviewGroup ? 'rgba(13,110,253,0.03)' : 'transparent',
                }
                : undefined
            }
          >
            <strong>{block.groupId}. <span dangerouslySetInnerHTML={{ __html: block.content }} /></strong>
            {retriesRequired != null ? (
              <span className="ms-2 badge bg-light text-dark border">
                Retries: {retriesRequired}
              </span>
            ) : null}
            {!suppressStudentTestFeedbackUi && renderInfoBubbles(block, 'questiongroup', `groupIntro-${index}`, groupIntroAnchorRef)}
            {runMode === 'preview' && !suppressStudentTestFeedbackUi && renderInfoBubbles(
              block,
              'submitbutton',
              `groupIntro-submit-${index}`,
              groupIntroAnchorRef
            )}
          </div>
        </React.Fragment>

      );
    }

    if (block.type === 'file') {
      const isReadonly = !!block.readonly;
      const filename = block.filename;

      const canonicalContents = fileContents || {};
      const initialContent = block.content || '';

      const effectiveContent =
        Object.prototype.hasOwnProperty.call(canonicalContents, filename)
          ? canonicalContents[filename]
          : initialContent;

      // If you want ONLY active student to edit in RUN mode:
      // const canEdit = !isReadonly && editable && isActive;

      // If you want anyone to edit non-readonly files (your current behavior):
      const canEdit = !isReadonly;

      const keyForDb = `file:${filename}`;

      return (
        <div key={`file-wrap-${filename}-${index}`} className="mb-3">
          <FileBlock
            filename={filename}
            //fileKey={keyForDb}                 
            initialContent={effectiveContent}
            fileContents={canonicalContents}
            setFileContents={setFileContents}
            editable={canEdit}
          //onFileChange={onFileChange}       
          />
        </div>
      );
    }





    if (block.type === 'pythondisplay' || block.type === 'cppdisplay') {
      const DisplayComponent =
        block.type === 'cppdisplay' ? ActivityCppBlock : ActivityPythonBlock;
      return (
        <div key={`${block.type}-${index}`} className="mb-3">
          <DisplayComponent
            code={block.content || ''}
            blockIndex={`${block.type}-${index}`}
            editable={false}
            displayOnly={true}
          />
        </div>
      );
    }

    if (block.type === 'pythonturtle') {
      // Local-only top-level turtle: no DB keys, no prefill, always reflect sheet
      if (block.localOnly) {
        const tl = block.timeLimit ?? 50000;
        const w = block.width ?? 600;
        const h = block.height ?? 400;
        const localKey = `localpyt-${index}-${(block.content || '').length}`; // re-mount on content change
        const turtleId = `sk-turtle-${localKey}`;
        const canEdit = true; // always editable locally

        return (
          <div key={localKey}>
            {runMode === 'preview' && (
              <div className="text-muted small mb-1">
                ⏱ Time limit: {formatTimeLimit(tl)} · 🐢 {w}×{h} · <span className="badge bg-secondary">Local (not saved)</span>
              </div>
            )}
            <div id={turtleId} style={{ width: w, height: h, border: '1px solid #ddd', borderRadius: 6, marginBottom: 8 }} />
            <ActivityPythonBlock
              code={block.content || ''}           // ← always the sheet content
              blockIndex={localKey}
              editable={canEdit}
              localOnly={true}                     // ← tell the component it's ephemeral
              fileContents={fileContents}
              setFileContents={setFileContents}
              timeLimit={tl}
              turtleTargetId={turtleId}
              turtleWidth={w}
              turtleHeight={h}
            />
          </div>
        );
      }
      const groupPrefix = String((currentGroupIndex ?? 0) + 1);
      const codeKey = `${groupPrefix}code${standaloneCodeCounter++}`;
      const turtleId = `sk-turtle-${groupPrefix}-${index}`;

      // Context text like you do for python
      const prevContext = [...blocks].slice(0, index).reverse().find(b =>
        (b.type === 'section') ||
        (b.type === 'text') ||
        (b.type === 'header' && (b.tag === 'title' || b.tag === 'activitycontext'))
      );
      const questionText =
        prevContext?.type === 'section' ? prevContext.title :
          prevContext?.type === 'text' ? prevContext.content :
            prevContext?.type === 'header' ? prevContext.content :
              'Write and run Python code.';

      const meta = {
        questionText: stripHtml(questionText),
        sampleResponse: '',
        feedbackPrompt: '',
        hasTextResponse: !!block.hasTextResponse,
        hasTableResponse: !!block.hasTableResponse,
      };

      const tl = block.timeLimit ?? 50000;
      const w = block.width ?? 600;
      const h = block.height ?? 400;
      // --- toggle plumbing (same as python) ---
      const isObserver = !!options.isObserver;
      const allowToggle = !!allowLocalToggle && (options.isObserver || isInstructor);
      const viewMode = options.codeViewMode?.[codeKey] || 'active'; // 'active' | 'local'
      const activeCode = (prefill?.[codeKey]?.response ?? block.content ?? '');
      const displayedCode = (allowToggle && viewMode === 'local')
        ? (options.localCode?.[codeKey] ?? activeCode)
        : activeCode;
      const canEdit = (editable && isActive) || (allowToggle && viewMode === 'local');

      return (
        <div key={`pyt-${index}`}>
          {runMode === 'preview' && (
            <div className="text-muted small mb-1">
              ⏱ Time limit: {formatTimeLimit(tl)} · 🐢 {w}×{h}
            </div>
          )}
          {/* Turtle canvas mount */}
          <div id={turtleId} style={{ width: w, height: h, border: '1px solid #ddd', borderRadius: 6, marginBottom: 8 }} />
          {allowToggle && (
            <div className="d-flex justify-content-end mb-1">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => options.onToggleViewMode?.(codeKey, viewMode === 'active' ? 'local' : 'active')}
                title="Switch between following the active student and a private sandbox"
              >
                {viewMode === 'active' ? 'Follow Active' : 'Local Sandbox'}
              </button>
            </div>
          )}
          <ActivityPythonBlock
            key={`pyt-${index}-${activeCode.slice(0, 10)}`}
            code={displayedCode}
            blockIndex={`pyt-${codeKey}-${index}`}
            editable={canEdit}
            responseKey={codeKey}
            onCodeChange={(rk, code, extra) => {

              // observers in Local mode: keep it client-side only
              if (allowToggle && viewMode === 'local' && !isActive) {
                options.onLocalCodeChange?.(rk, code);
                return;
              }
              onCodeChange && onCodeChange(rk, code, { ...meta, ...extra });
            }} codeFeedbackShown={codeFeedbackShown}
            fileContents={fileContents}
            setFileContents={setFileContents}
            timeLimit={tl}
            // 👇 pass through for the runner
            turtleTargetId={turtleId}
            turtleWidth={w}
            turtleHeight={h}
          />
        </div>
      );
    }

    if (block.type === 'python' || block.type === 'pythonremote') {
      const PythonBlockComponent =
        block.type === 'pythonremote' ? ActivityRemotePythonBlock : ActivityPythonBlock;
      const remotePythonEnabled = runtimeFeatures.remotePython ?? true;

      // Local-only top-level python: no DB keys, no prefill, always reflect sheet
      if (block.localOnly) {
        const tl = block.timeLimit ?? 50000;
        const localKey = `localpy-${index}-${(block.content || '').length}`; // re-mount on content change
        const canEdit = true; // always editable locally
        return (
          <div key={localKey}>
            {runMode === 'preview' && (
              <div className="text-muted small mb-1">
                ⏱ Time limit: {formatTimeLimit(tl)} · <span className="badge bg-secondary">Local (not saved)</span>
              </div>
            )}
            <PythonBlockComponent
              code={block.content || ''}   // ← always the sheet content
              blockIndex={localKey}
              editable={canEdit}
              localOnly={true}             // ← no persistence
              runnerEnabled={block.type === 'pythonremote' ? remotePythonEnabled : true}
              fileContents={fileContents}
              setFileContents={setFileContents}
              timeLimit={tl}
              includeFiles={block.imports || []}
            />
          </div>
        );
      }
      const groupPrefix = String((currentGroupIndex ?? 0) + 1);
      const codeKey = `${groupPrefix}code${standaloneCodeCounter++}`;

      // find a nearby bit of human text to use as the "question"
      const prevContext = [...blocks]
        .slice(0, index)
        .reverse()
        .find(b =>
          (b.type === 'section') ||
          (b.type === 'text') ||
          (b.type === 'header' && (b.tag === 'title' || b.tag === 'activitycontext'))
        );

      const questionText =
        prevContext?.type === 'section' ? prevContext.title :
          prevContext?.type === 'text' ? prevContext.content :
            prevContext?.type === 'header' ? prevContext.content :
              'Write and run Python code.';

      const meta = {
        // ✅ use the derived nearby text, not block.prompt (which is undefined here)
        questionText: stripHtml(questionText),
        // Standalone python blocks usually don't carry these:
        sampleResponse: '',
        feedbackPrompt: '',
        hasTextResponse: !!block.hasTextResponse,
        hasTableResponse: !!block.hasTableResponse,
        lang: 'python',
        retriesRequired: block.retriesRequired ?? 0,
      };

      const tl = block.timeLimit ?? 50000;

      const codeMode = options.codeViewMode?.[codeKey] || 'active';
      const showToggle = !!allowLocalToggle && (options.isObserver || isInstructor);
      // what code to show
      const activeCode = prefill?.[codeKey]?.response || block.content || '';
      const displayedCode = (showToggle && codeMode === 'local')
        ? (options.localCode?.[codeKey] ?? activeCode)
        : activeCode;
      // who can edit?
      const canEdit =
        runMode === 'preview'
          ? editable
          : (editable && isActive) || (showToggle && codeMode === 'local');
      const showTL = runMode === 'preview';

      return (
        <div key={`py-${index}-${block.content?.slice(0, 10) || ''}`}>
          {runMode === 'preview' && (
            <div className="text-muted small mb-1">
              ⏱ Time limit: {formatTimeLimit(tl)}
            </div>
          )}
          {showToggle && (
            <div className="d-flex justify-content-end mb-1">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => options.onToggleViewMode?.(codeKey, codeMode === 'active' ? 'local' : 'active')}
                title="Switch between following the active student and a private sandbox"
              >
                {codeMode === 'active' ? 'Follow Active' : 'Local Sandbox'}
              </button>
            </div>
          )}
          <PythonBlockComponent
            key={`py-${index}-${block.content?.slice(0, 10) || ''}`}
            code={displayedCode}
            blockIndex={`py-${codeKey}-${index}`}
            editable={canEdit}
            runnerEnabled={block.type === 'pythonremote' ? remotePythonEnabled : true}
            responseKey={codeKey}
            // 👇 forward meta so the server sees the actual task
            onCodeChange={(rk, code, extra) => {
              // local sandbox -> store locally, no network
              if (showToggle && codeMode === 'local' && !isActive) {
                options.onLocalCodeChange?.(rk, code);
                return;
              }
              onCodeChange && onCodeChange(rk, code, { ...meta, ...extra });
            }}
            codeFeedbackShown={codeFeedbackShown}
            fileContents={fileContents}
            setFileContents={setFileContents}
            timeLimit={block.timeLimit || 50000}
            includeFiles={block.imports || []}
          />
        </div>
      );
    }
    if (block.type === 'cpp') {
      const tl = block.timeLimit ?? 5000;
      const includeFiles = block.includeFiles || null;


      // Local-only top-level C++: ephemeral, not saved
      if (block.localOnly) {
        const localKey = `localcpp-${index}-${(block.content || '').length}`;
        return (
          <div key={localKey}>
            {runMode === 'preview' && (
              <div className="text-muted small mb-1">
                ⏱ Time limit: {tl} ms · <span className="badge bg-secondary">C++</span> · <span className="badge bg-secondary">Local (not saved)</span>
              </div>
            )}
            <ActivityCppBlock
              code={block.content || ''}
              blockIndex={localKey}
              editable={true}
              localOnly={true}
              runnerEnabled={runtimeFeatures.remoteCpp ?? true}
              responseKey={localKey}
              onCodeChange={onCodeChange}
              fileContents={fileContents}
              setFileContents={setFileContents}
              timeLimit={tl}
              includeFiles={includeFiles}
            />
          </div>
        );
      }

      // Persisted top-level C++ (rare): use canonical ...code# key
      const groupPrefix = String((currentGroupIndex ?? 0) + 1);
      const codeKey = `${groupPrefix}code${standaloneCodeCounter++}`;

      const codeMode = options.codeViewMode?.[codeKey] || 'active';
      const showToggle = !!allowLocalToggle && (options.isObserver || isInstructor);

      const activeCode = prefill?.[codeKey]?.response || block.content || '';
      const displayedCode = (showToggle && codeMode === 'local')
        ? (options.localCode?.[codeKey] ?? activeCode)
        : activeCode;

      const canEdit =
        runMode === 'preview'
          ? editable
          : (editable && isActive) || (showToggle && codeMode === 'local');

      return (
        <div key={`cpp-${index}`}>
          {runMode === 'preview' && (
            <div className="text-muted small mb-1">
              ⏱ Time limit: {tl} ms · <span className="badge bg-secondary">C++</span>
            </div>
          )}
          {showToggle && (
            <div className="d-flex justify-content-end mb-1">
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => options.onToggleViewMode?.(codeKey, codeMode === 'active' ? 'local' : 'active')}
              >
                {codeMode === 'active' ? 'Follow Active' : 'Local Sandbox'}
              </button>
            </div>
          )}
          <ActivityCppBlock
            code={displayedCode}
            blockIndex={`cpp-${codeKey}-${index}`}
            editable={canEdit}
            runnerEnabled={runtimeFeatures.remoteCpp ?? true}
            responseKey={codeKey}
            onCodeChange={(rk, code, extra) => {
              if (showToggle && codeMode === 'local' && !isActive) {
                options.onLocalCodeChange?.(rk, code);
                return;
              }
              onCodeChange && onCodeChange(rk, code, {
                ...extra,
                questionText: 'Write and run C++ code.',
                hasTextResponse: false,
                hasTableResponse: false,
                lang: 'cpp',
              });
            }}
            fileContents={fileContents}
            setFileContents={setFileContents}
            timeLimit={tl}
            includeFiles={includeFiles}

            /* 👇 pass guidance like Python does */
            codeFeedbackShown={codeFeedbackShown}
            feedback={codeFeedbackShown?.[codeKey] || null}
          />

        </div>
      );
    }


    if (block.type === 'table') {
      // Base id for this standalone table instance
      const tableBaseKey = `table${index}`;
      return (
        <div key={`table-${index}`} className="my-4">
          <h4 className="mb-2">{block.title}</h4>
          <table className="table table-bordered">
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={`table-${index}-row-${i}`}>
                  {row.map((cell, j) => {
                    const cellKey = `${tableBaseKey}cell${i}_${j}`;
                    if (cell.type === 'input') {
                      return (
                        <td key={cellKey}>
                          <Form.Control
                            type="text"
                            {...makeResponseAttrs({ key: cellKey, kind: "table", qid: cellKey })}
                            value={prefill?.[cellKey]?.response || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              options.onTextChange?.(cellKey, val);
                            }}
                            readOnly={!canEditTable}
                          />

                        </td>
                      );
                    } else {
                      return (
                        <td
                          key={cellKey}
                          dangerouslySetInnerHTML={{ __html: cell.content }}
                        />
                      );
                    }
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }




    if (block.type === 'question') {
      const questionAnchorRef = React.createRef();
      const codeIndicesByLang = { python: [], cpp: [] };
      (block.codeBlocks || []).forEach(cb => {
        if (cb.lang === 'python') codeIndicesByLang.python.push(cb.index);
        if (cb.lang === 'cpp') codeIndicesByLang.cpp.push(cb.index);
      });

      const responseKey = `${block.groupId}${block.id}`;
      const followupAppeared = !!followupsShown?.[responseKey];
      const groupComplete = prefill?.[`${responseKey}S`] === 'complete';
      const unansweredMessage = unansweredShown?.[responseKey];

      const hasPython = (block.pythonBlocks?.length || 0) > 0;
      const hasCpp = (block.cppBlocks?.length || 0) > 0;
      const hasMultipleChoice = (block.multipleChoice?.choices?.length || 0) > 0;
      const allowsMultipleChoices = block.multipleChoice?.selectionMode === 'multiple';
      const hasInlineAi = (block.aiBlocks?.length || 0) > 0;
      const isCodeOnly =
        (hasPython || hasCpp) && !block.hasTextResponse && !block.hasTableResponse;

      // A multiple-choice response replaces the default free-text response. Authors can
      // still add code, tables, or other response elements to the same question. An
      // inline AI block is itself an interaction, so it does not receive the legacy
      // default text area unless the author explicitly adds \textresponse.
      const showTextArea =
        !hasMultipleChoice &&
        (block.hasTextResponse || (!hasInlineAi && !hasPython && !hasCpp && !block.hasTableResponse));

      const lockMainResponse =
        runMode === 'preview'
          ? !!followupsShown?.[responseKey] && !!block.hasTextResponse
          : false;


      // NEW: formatted score badges
      const scoreBadges = [];
      if (block.scores) {
        const scoreEntries = [
          ['response', 'Response'],
          ['choice', 'Choice'],
          ['code', 'Code'],
          ['output', 'Output'],
        ];
        for (const [key, label] of scoreEntries) {
          const s = block.scores[key];
          if (s && Number.isFinite(Number(s.points))) {
            const points = Number(s.points);
            scoreBadges.push(
              <span
                key={`score-${responseKey}-${key}`}
                className="badge bg-light text-muted border ms-2"
              >
                {points} pt{points !== 1 ? 's' : ''} {label}
              </span>
            );
          }
        }
      } else if (runMode === 'preview' && isInstructor) {
        scoreBadges.push(
          <span
            key={`score-${responseKey}-missing`}
            className="badge bg-warning text-dark border ms-2"
          >
            No rubric yet
          </span>
        );
      }

      const isSelectedPreviewBlock = runMode === 'preview' && selectedPreviewKey === block.previewKey;

      return (
        <React.Fragment key={`q-wrap-${block.groupId}-${block.id}`}>
          {typeof renderInsertBeforeQuestion === 'function' && blocks[index - 1]?.type !== 'question'
            ? renderInsertBeforeQuestion(block)
            : null}
          <div
          key={`q-${block.groupId}-${block.id}`}  // ✅ unique per question
          className="mb-4"
          ref={questionAnchorRef}
          data-preview-key={block.previewKey}
          onClick={(event) => {
            if (runMode !== 'preview' || typeof onSelectBlock !== 'function') return;
            if (event.target.closest('textarea, input, button, select, a')) return;
            onSelectBlock(block);
          }}
          style={
            runMode === 'preview'
              ? {
                cursor: onSelectBlock ? 'pointer' : 'default',
                border: isSelectedPreviewBlock ? '2px solid #0d6efd' : '1px solid transparent',
                borderRadius: 10,
                padding: '0.75rem',
                boxShadow: isSelectedPreviewBlock ? '0 0 0 3px rgba(13,110,253,0.12)' : 'none',
                background: isSelectedPreviewBlock ? 'rgba(13,110,253,0.03)' : 'transparent',
              }
              : undefined
          }
        >
          <p>
            <strong>{block.label}</strong>{' '}
            <span
              dangerouslySetInnerHTML={{ __html: block.prompt }}
            />
            {scoreBadges.length > 0 && (
              <span className="ms-2">
                {scoreBadges}
              </span>
            )}
            {lockMainResponse && (
              <span
                className="ms-2"
                title="Response locked due to follow-up"
                style={{ color: '#888', cursor: 'not-allowed' }}
              >
                🔒
              </span>
            )}
          </p>

          {renderInfoBubbles(
            block,
            'question',
            `question-${block.groupId}-${block.id}`,
            questionAnchorRef
          )}

          {block.displayCodeBlocks?.map((displayBlock, displayIndex) => {
            const DisplayComponent =
              displayBlock.type === 'cppdisplay' ? ActivityCppBlock : ActivityPythonBlock;
            return (
              <div key={`q-${block.groupId}-${block.id}-display-${displayIndex}`} className="mb-3">
                <DisplayComponent
                  code={displayBlock.content || ''}
                  blockIndex={`q-${block.groupId}-${block.id}-display-${displayIndex}`}
                  editable={false}
                  displayOnly={true}
                />
              </div>
            );
          })}

          {block.pythonBlocks?.map((py, i) => {
            const codeAnchorRef = React.createRef();
            const PythonBlockComponent =
              py.type === 'pythonremote' ? ActivityRemotePythonBlock : ActivityPythonBlock;
            const remotePythonEnabled = runtimeFeatures.remotePython ?? true;
            const cbIndex = codeIndicesByLang.python[i] ?? (i + 1);
            const responseKey = `${block.groupId}${block.id}code${cbIndex}`;
            const savedResponse = prefill?.[responseKey]?.response || py.content;
            const isTurtle = py.type === 'pythonturtle';
            const turtleId = isTurtle ? `sk-turtle-${block.groupId}${block.id}-${i}` : null;
            const w = py.width ?? 600;
            const h = py.height ?? 400;
            const isCodeOnly = !block.hasTextResponse && !block.hasTableResponse;
            const codeMode = options.codeViewMode?.[responseKey] || 'active';
            const showToggle = !!allowLocalToggle && (options.isObserver || isInstructor);

            const displayedCode = (showToggle && codeMode === 'local')
              ? (options.localCode?.[responseKey] ?? savedResponse)
              : savedResponse;
            const canEdit =
              runMode === 'preview'
                ? editable
                : (editable && isActive) || (showToggle && codeMode === 'local');
            const meta = {
              questionText: stripHtml(block.prompt || ''),                 // ✅ use the question’s prompt
              sampleResponse: stripHtml(block.samples?.[0] || ''),         // ✅ include per-question sample
              feedbackPrompt: stripHtml(block.feedback?.[0] || ''),        // ✅ include per-question guidance
              hasTextResponse: !!block.hasTextResponse,
              hasTableResponse: !!block.hasTableResponse,
              lang: 'python',
              retriesRequired: block.retriesRequired ?? 0,
            };

            const tl = py.timeLimit ?? block.timeLimit ?? 50000;

            return (
              <div key={`q-${block.groupId}-${block.id}-py-${i}`} ref={codeAnchorRef}>
                {!suppressStudentTestFeedbackUi && renderInfoBubbles(
                  block,
                  'coderesponse',
                  `question-${block.groupId}-${block.id}-py-${i}`,
                  codeAnchorRef,
                  { dismissOnTargetInput: true }
                )}
                {runMode === 'preview' && (
                  <div className="text-muted small mb-1">
                    ⏱ Time limit: {formatTimeLimit(tl)}
                  </div>
                )}
                {/* For turtle blocks, render a canvas mount just above */}
                {isTurtle && (
                  <div id={turtleId} style={{ width: w, height: h, border: '1px solid #ddd', borderRadius: 6, marginBottom: 8 }} />
                )}
                {showToggle && (
                  <div className="d-flex justify-content-end mb-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => options.onToggleViewMode?.(responseKey, codeMode === 'active' ? 'local' : 'active')}
                    >
                      {codeMode === 'active' ? 'Follow Active' : 'Local Sandbox'}
                    </button>
                  </div>
                )}
                <PythonBlockComponent
                  key={`q-${block.groupId}-${block.id}-py-${i}`}
                  code={displayedCode}
                  blockIndex={`q-${currentGroupIndex}-${block.id}-${i}`}
                  editable={canEdit}
                  runnerEnabled={py.type === 'pythonremote' ? remotePythonEnabled : true}
                  localOnly={runMode === 'preview'}
                  responseKey={responseKey}
                  onCodeChange={(rk, code, extra) => {
                    if (showToggle && codeMode === 'local' && !isActive) {
                      options.onLocalCodeChange?.(rk, code);
                      return;
                    }
                    onCodeChange && onCodeChange(rk, code, {
                      ...meta,
                      ...extra,
                      creatorSource: { questionBlock: block, codeType: py.type },
                    });
                  }}
                  codeFeedbackShown={codeFeedbackShown}
                  fileContents={fileContents}
                  setFileContents={setFileContents}
                  timeLimit={py.timeLimit ?? block.timeLimit ?? 50000}
                  turtleTargetId={isTurtle ? turtleId : undefined}
                  turtleWidth={w}
                  turtleHeight={h}
                  includeFiles={py.imports || []}
                />
              </div>
            );

          })}

          {block.cppBlocks?.map((cpp, i) => {
            const codeAnchorRef = React.createRef();
            const cbIndex = codeIndicesByLang.cpp[i] ?? (i + 1);
            const responseKey = `${block.groupId}${block.id}code${cbIndex}`;

            const saved = prefill?.[responseKey]?.response || cpp.content;
            const includeFiles = cpp.includeFiles || null;

            const codeMode = options.codeViewMode?.[responseKey] || 'active';
            const showToggle = !!allowLocalToggle && (options.isObserver || isInstructor);

            const displayedCode = (showToggle && codeMode === 'local')
              ? (options.localCode?.[responseKey] ?? saved)
              : saved;

            const canEdit =
              runMode === 'preview'
                ? editable
                : (editable && isActive) || (showToggle && codeMode === 'local');

            return (
              <div key={`q-${block.groupId}-${block.id}-cpp-${i}`} ref={codeAnchorRef}>
                {!suppressStudentTestFeedbackUi && renderInfoBubbles(
                  block,
                  'coderesponse',
                  `question-${block.groupId}-${block.id}-cpp-${i}`,
                  codeAnchorRef,
                  { dismissOnTargetInput: true }
                )}
                {runMode === 'preview' && (
                  <div className="text-muted small mb-1">
                    ⏱ Time limit: {cpp.timeLimit ?? 5000}{' '}
                    <span className="badge bg-secondary">C++</span>
                  </div>
                )}

                {showToggle && (
                  <div className="d-flex justify-content-end mb-1">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() =>
                        options.onToggleViewMode?.(
                          responseKey,
                          codeMode === 'active' ? 'local' : 'active'
                        )
                      }
                    >
                      {codeMode === 'active' ? 'Follow Active' : 'Local Sandbox'}
                    </button>
                  </div>
                )}

                <ActivityCppBlock
                  code={displayedCode}
                  blockIndex={`cpp-${block.groupId}-${block.id}-${i}`}
                  editable={canEdit}
                  runnerEnabled={runtimeFeatures.remoteCpp ?? true}
                  localOnly={runMode === 'preview'}
                  responseKey={responseKey}
                  onCodeChange={(rk, code, extra) => {
                    if (showToggle && codeMode === 'local' && !isActive) {
                      options.onLocalCodeChange?.(rk, code);
                      return;
                    }
                    onCodeChange &&
                      onCodeChange(rk, code, {
                        ...extra,
                        questionText: stripHtml(block.prompt || ''),
                        sampleResponse: stripHtml(block.samples?.[0] || ''),
                        feedbackPrompt: stripHtml(block.feedback?.[0] || ''),

                        hasTextResponse: !!block.hasTextResponse,
                        hasTableResponse: !!block.hasTableResponse,
                        lang: 'cpp',
                        retriesRequired: block.retriesRequired ?? 0,
                        creatorSource: { questionBlock: block, codeType: 'cpp' },
                      });
                  }}
                  timeLimit={cpp.timeLimit ?? 5000}
                  codeFeedbackShown={codeFeedbackShown}
                  feedback={codeFeedbackShown?.[responseKey] || null}
                  fileContents={fileContents}
                  setFileContents={setFileContents}
                />
              </div>
            );
          })}

          {block.tableBlocks?.map((table, i) => (
            <div key={`q-table-${index}-${i}`} className="my-3">
              <h5>{table.title}</h5>
              <table className="table table-bordered">
                <tbody>
                  {table.rows.map((row, ri) => (
                    <tr key={`row-${ri}`}>
                      {row.map((cell, ci) => {
                        const cellKey = `${block.groupId}${block.id}table${i}cell${ri}_${ci}`;
                        if (cell.type === 'input') {
                          return (
                            <td key={cellKey}>
                              <Form.Control
                                type="text"
                                value={prefill?.[cellKey]?.response || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (options.onTextChange) {
                                    options.onTextChange(cellKey, val);
                                  }
                                }}
                                readOnly={!canEditTable}
                                data-response-key={cellKey}
                              />
                            </td>
                          );
                        } else {
                          return (
                            <td
                              key={cellKey}
                              dangerouslySetInnerHTML={{ __html: cell.content }}
                            />
                          );
                        }
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {block.aiBlocks?.map((aiBlock, i) => {
            return (
              <InlineAiAssistBlock
                key={`q-ai-${block.groupId}-${block.id}-${i}`}
                aiBlock={aiBlock}
                questionBlock={block}
                runMode={runMode}
                selectedPreviewKey={selectedPreviewKey}
                onSelectBlock={onSelectBlock}
              />
            );
          })}

          {hasMultipleChoice ? (
            <fieldset className="mt-3" aria-label={allowsMultipleChoices ? 'Select all that apply' : 'Choose one answer'}>
              <legend className="fs-6 mb-2">{allowsMultipleChoices ? 'Select all that apply' : 'Choose one answer'}</legend>
              {block.multipleChoice.choices.map((choice, choiceIndex) => {
                const choiceId = `multiple-choice-${responseKey}-${choiceIndex}`;
                const isMultilineCodeChoice = /\\\\|\n/.test(String(choice.value || ''));
                const choiceLabel = isMultilineCodeChoice ? (
                  <code style={{ display: 'block', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                    {String(choice.value || '').replace(/\\\\/g, '\n')}
                  </code>
                ) : (
                  <span dangerouslySetInnerHTML={{ __html: choice.content || choice.value }} />
                );
                const selectedChoices = allowsMultipleChoices
                  ? parseMultipleChoiceSelections(prefill?.[responseKey]?.response)
                  : [];
                const isSelected = allowsMultipleChoices
                  ? selectedChoices.includes(choice.value)
                  : (prefill?.[responseKey]?.response || '') === choice.value;
                return (
                  <Form.Check
                    key={choiceId}
                    id={choiceId}
                    type={allowsMultipleChoices ? 'checkbox' : 'radio'}
                    name={`multiple-choice-${responseKey}`}
                    value={choice.value}
                    checked={isSelected}
                    disabled={!editable || lockMainResponse}
                    className="mb-2"
                    label={choiceLabel}
                    onChange={(event) => {
                      const nextValue = allowsMultipleChoices
                        ? serializeMultipleChoiceSelections(
                          event.target.checked
                            ? [...selectedChoices, choice.value]
                            : selectedChoices.filter((value) => value !== choice.value)
                        )
                        : choice.value;
                      options.onTextChange?.(responseKey, nextValue, {
                        questionText: stripHtml(block.prompt || ''),
                        sampleResponse: stripHtml(block.samples?.[0] || ''),
                        feedbackPrompt: stripHtml(block.feedback?.[0] || ''),
                        hasMultipleChoice: true,
                        allowsMultipleChoices,
                        retriesRequired: block.retriesRequired ?? 0,
                      });
                    }}
                  />
                );
              })}
            </fieldset>
          ) : null}

          {showTextArea ? (
            (() => {
              const textAnchorRef = React.createRef();
              const meta = {
                questionText: stripHtml(block.prompt || ''),
                sampleResponse: stripHtml(block.samples?.[0] || ''),
                feedbackPrompt: stripHtml(block.feedback?.[0] || ''),
                hasTextResponse: !!block.hasTextResponse,
                hasTableResponse: !!block.hasTableResponse,
                retriesRequired: block.retriesRequired ?? 0,
              };

              const guidance = textFeedbackShown?.[responseKey];

              return (
                <div ref={textAnchorRef}>
                  {renderInfoBubbles(
                    block,
                    'textresponse',
                    `question-${block.groupId}-${block.id}-text`,
                    textAnchorRef,
                    { dismissOnTargetInput: true }
                  )}
                  <Form.Control
                    as="textarea"
                    rows={Math.max((block.responseLines || 1), 2)}
                    {...makeResponseAttrs({ key: responseKey, kind: "text", qid: responseKey })}
                    value={prefill?.[responseKey]?.response || ''}
                    readOnly={
                      !editable ||
                      lockMainResponse
                    }
                    className="mt-2"
                    style={{ resize: 'vertical' }}
                    onChange={(e) => {
                      const val = e.target.value;
                      options.onTextChange?.(responseKey, val, meta);
                    }}
                  />
                </div>
              );
            })()
          ) : null}




          {(() => {
            if (suppressStudentTestFeedbackUi && !isInstructor) return null;
            const aiFeedbackVisible =
              Boolean(textFeedbackShown?.[responseKey]) ||
              (runMode === 'preview' &&
                ((block.samples?.length || 0) > 0 ||
                  (block.feedback?.length || 0) > 0 ||
                  (block.followups?.length || 0) > 0));
            if (!aiFeedbackVisible) return null;

            const aiFeedbackAnchorRef = React.createRef();

            return (
              <div ref={aiFeedbackAnchorRef}>
                {runMode === 'preview' && (
                  <>
                    {block.samples?.length > 0 && <p className="text-muted"><em>Sample: {block.samples.join('; ')}</em></p>}
                    {block.feedback?.length > 0 && <p className="text-muted"><em>Feedback: {block.feedback.join('; ')}</em></p>}
                    {block.followups?.length > 0 && <p className="text-muted"><em>Follow-up: {block.followups.join('; ')}</em></p>}
                  </>
                )}

                {textFeedbackShown?.[responseKey] && (
                  <Alert
                    variant="warning"
                    className="mt-2"
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    <strong>AI Guidance</strong>
                    <div>{textFeedbackShown[responseKey]}</div>
                  </Alert>
                )}

                {renderInfoBubbles(
                  block,
                  'aifeedback',
                  `question-${block.groupId}-${block.id}-ai`,
                  aiFeedbackAnchorRef,
                  { placement: 'top' }
                )}
              </div>
            );
          })()}

          {unansweredMessage && !suppressStudentTestFeedbackUi && (
            <Alert
              variant="warning"
              className="mt-2 border border-warning"
              style={{ whiteSpace: 'pre-wrap', backgroundColor: '#fff3cd' }}
            >
              <strong>This question has not been answered</strong>
              <div>{unansweredMessage}</div>
            </Alert>
          )}

          {runMode === 'preview' && !suppressStudentTestFeedbackUi &&
            renderInfoBubbles(
              block,
              'submitbutton',
              `question-${block.groupId}-${block.id}-submit`,
              questionAnchorRef
            )}

          {/* Show saved followup Q&A in read-only format */}


          {/* Follow-up UI */}
          {followupsShown?.[responseKey] && !suppressStudentTestFeedbackUi && (
            !showTextArea && hasPython ? (
              <div className="mt-3 alert alert-warning py-2">
                <strong>Follow-up:</strong> {followupsShown[responseKey]}
                <div className="small mt-1">
                  Update your program and run again to complete this question.
                </div>
              </div>
            ) : (
              (() => {
                const followupKey = `${responseKey}FA1`;
                const hasSavedFU = !!prefill?.[followupKey]?.response;
                const canEditFU = editable && isActive && !hasSavedFU;
                return (
                  <>
                    <div className="mt-3 text-muted">
                      <strong>Follow-up:</strong> {followupsShown[responseKey]}
                      {!canEditFU && (
                        <span className="ms-2" title={hasSavedFU ? "Follow-up answered" : "Read-only"} style={{ color: '#888' }}>
                          🔒
                        </span>
                      )}
                    </div>
                    {canEditFU ? (
                      <Form.Control
                        as="textarea"
                        rows={2}
                        {...makeResponseAttrs({ key: followupKey, kind: "followup-answer", qid: responseKey })}
                        value={followupAnswers?.[followupKey] || ''}
                        placeholder="Respond to the follow-up question here..."
                        onChange={(e) => {
                          const val = e.target.value;
                          setFollowupAnswers(prev => ({ ...prev, [followupKey]: val }));
                          if (options.isActive && options.socket) {
                            options.socket.emit('response:update', {
                              instanceId: options.instanceId,
                              responseKey: followupKey,
                              value: val,
                              answeredBy: options.answeredBy,
                              followupPrompt: options.followupsShown?.[responseKey]
                            });
                          }
                        }}
                        className="mt-1"
                        style={{ resize: 'vertical' }}
                      />

                    ) : (
                      <div className="bg-light p-2 rounded mt-1">
                        {prefill?.[followupKey]?.response || followupAnswers?.[followupKey] || ''}
                      </div>
                    )}
                  </>
                );
              })()
            )
          )}




          </div>
          {typeof renderInsertAfterQuestion === 'function' ? renderInsertAfterQuestion(block) : null}
        </React.Fragment>
      );
    }

    return null;
  });
}


// End parseSheet.jsx
