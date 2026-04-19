// parseSheet.jsx

import ActivityQuestionBlock from '../components/activity/ActivityQuestionBlock';
import ActivityHeader from '../components/activity/ActivityHeader';
import ActivityEnvironment from '../components/activity/ActivityEnvironment';
import ActivityPythonBlock from '../components/activity/ActivityPythonBlock';
import { makeResponseAttrs } from './responseDom';

import { Form } from 'react-bootstrap';

import { useState, useEffect, useRef } from 'react';;

import ActivityCppBlock from '../components/activity/ActivityCppBlock';
import { Alert } from 'react-bootstrap';




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

// Joins multi-line \tag{...} blocks into single logical lines by balancing braces.
// Keeps everything else as-is. Works for any \SomeTag{ ... } (including section*, link, image, etc.)
function collapseBracedCommands(rawLines) {
  const startsTag = (s) =>
    /^\s*\\(?:title|name|activitycontext|studentlevel|aicodeguidance|section\*?|questiongroup|question|sampleresponses|feedbackprompt|followupprompt|table|image|link|file|pythonturtle|cpp|include)\{/.test(s);
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
        rows={Math.max(4, localValue.split('\n').length)}
        readOnly={!editable}
        className="font-monospace bg-light mt-1"
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
  let isTest = false;
  const legacyTestNumbering = options.legacyTestNumbering === true;
  // default true unless explicitly set to false

  const blocks = [];
  let groupNumber = 0;
  let questionLetterCode = 97;
  let responseId = 1;
  let globalRetriesRequired = 0;          // ✅ sheet default
  let currentGroupRetriesRequired = 0;    // ✅ current group effective value
  const meta = {
    isTest: false,
    retriesDefault: 0,
    groupRetries: {}
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
  let pendingIncludeFiles = null;

  // track some structural state to report missing closures
  let openGroupLine = null;
  let openQuestionLine = null;
  let openFileLine = null;
  let openScoreLine = null;
  let openListLine = null;


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
      continue;
    }
    // --- inside a \score ... \endscore block ---
    if (inScoreBlock && currentScore && currentQuestion) {
      if (trimmed === '\\endscore') {
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

        inScoreBlock = false;
        currentScore = null;
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

    if (trimmed === '\\endpython' || trimmed === '\\endpythonturtle') {
      if (currentField === 'python' || currentField === 'pythonturtle') {
        const lastBlock = blocks.at(-1);
        if ((lastBlock?.type === 'python' || lastBlock?.type === 'pythonturtle') && lastBlock.lines) {
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
          }
        }
        currentField = 'prompt';
      }
      continue;
    }

    if (currentField === 'python' || currentField === 'pythonturtle') {
      const lastBlock = blocks.at(-1);
      if ((lastBlock?.type === 'python' || lastBlock?.type === 'pythonturtle') && lastBlock.lines) {
        lastBlock.lines.push(line);
      } else if (currentQuestion?.pythonBlocks?.length > 0) {
        const lastQuestionBlock = currentQuestion.pythonBlocks.at(-1);
        lastQuestionBlock.lines.push(line);
      }
      continue;
    }

    // Start of a header (now always single logical line thanks to collapseBracedCommands)
    const headerStart = trimmed.match(/^\\(title|name|activitycontext|studentlevel|aicodeguidance)\{([\s\S]*?)\}$/);
    if (headerStart) {
      flushCurrentBlock();
      const tag = headerStart[1];
      const content = headerStart[2];
      blocks.push({ type: 'header', tag, content: format(content) });
      continue;
    }

    const sectionMatch = trimmed.match(/^\\section\*?\{([\s\S]+?)\}$/);
    if (sectionMatch) {
      flushCurrentBlock();
      blocks.push({ type: 'section', title: format(sectionMatch[1]) });
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
        content,
        retriesRequired: currentGroupRetriesRequired, // ✅ include it
      });
      meta.groupRetries[groupNumber] = currentGroupRetriesRequired;
      continue;
    }

    if (trimmed === '\\endquestiongroup') {
      if (!inGroup) {
        pushIssue('error', lineNo, '\\endquestiongroup without a matching \\questiongroup', line);
      }
      if (currentQuestion) {
        pushIssue('error', lineNo, 'Closing group while a \\question is still open. Missing \\endquestion before \\endquestiongroup.', line);
      }
      blocks.push({ type: 'endGroup' });
      inGroup = false;
      openGroupLine = null;
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
      if (gi) gi.retriesRequired = n;

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
        label: `${id}.`,
        responseId: responseId++,
        prompt: format(rawClean),
        responseLines: 1,
        samples: [],
        feedback: [],
        followups: [],
        codeBlocks: [],
        scores: {},
        retriesRequired: currentGroupRetriesRequired,
      };

      openQuestionLine = lineNo;
      continue;
    }

    if (trimmed === '\\endquestion') {
      if (!currentQuestion) {
        pushIssue('error', lineNo, '\\endquestion without a matching \\question{...}', line);
        continue;
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

      currentQuestion._initialCode =
        (currentQuestion.codeBlocks?.map(cb => cb.content || '') || []).filter(x => x !== undefined);

      blocks.push(currentQuestion);
      currentQuestion = null;
      openQuestionLine = null;
      continue;
    }

    // --- scoring blocks: \score{n,type} ... \endscore ---
    // type is one of: response, code, output
    const scoreMatch = trimmed.match(/^\\score\{(\d+)\s*,\s*(response|code|output)\}/i);
    if (scoreMatch && currentQuestion) {
      const points = parseInt(scoreMatch[1], 10);
      const scoreType = scoreMatch[2].toLowerCase();

      inScoreBlock = true;
      openScoreLine = lineNo;
      currentScore = { type: scoreType, points, lines: [] };
      continue;
    }

    if (inScoreBlock && currentScore && currentQuestion) {
      if (trimmed === '\\endscore') {
        // existing finalize logic...
        inScoreBlock = false;
        currentScore = null;
        openScoreLine = null;
        continue;
      } else {
        currentScore.lines.push(line);
        continue;
      }
    }

    if (trimmed.startsWith('\\textresponse')) {
      const match = trimmed.match(/\\textresponse\{(\d+)\}/);
      if (match && currentQuestion) {
        currentQuestion.responseLines = parseInt(match[1]);
        currentQuestion.hasTextResponse = true;
      }
      continue;
    }

    if (trimmed.startsWith('\\sampleresponses{')) {
      const m = trimmed.match(/\\sampleresponses\{([\s\S]+?)\}/);
      if (m && currentQuestion) currentQuestion.samples.push(format(m[1]));
      continue;
    }
    if (trimmed.startsWith('\\feedbackprompt{')) {
      const m = trimmed.match(/\\feedbackprompt\{([\s\S]+?)\}/);
      if (m && currentQuestion) currentQuestion.feedback.push(format(m[1]));
      continue;
    }
    if (trimmed.startsWith('\\followupprompt{')) {
      const m = trimmed.match(/\\followupprompt\{([\s\S]+?)\}/);
      if (m && currentQuestion) {
        const raw = (m[1] || '').trim();
        if (raw) currentQuestion.followups.push(format(raw));
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
]);

export function renderBlocks(blocks, options = {}) {
  const {
    editable = false,
    isActive = false,
    isObserver = false,
    isInstructor = false,
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
    onFileChange = null,
  } = options;

  let standaloneCodeCounter = 1;
  const hiddenTypes = ['sampleresponses', 'feedbackprompt', 'followupprompt'];
  const canEditTable =
    runMode === 'preview'
      ? editable
      : (editable && isActive);   // only active student edits in RUN

  return blocks.map((block, index) => {
    if (hiddenTypes.includes(block.type) && runMode !== 'preview') return null;
    if (block.type === 'endGroup') return null;

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
      return (
        <h2 key={`section-${index}`} className="my-3">
          {block.title}
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
      return (
        <div key={`groupIntro-${index}`} className="mb-2">
          <strong>{block.groupId}. <span dangerouslySetInnerHTML={{ __html: block.content }} /></strong>
        </div>

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

    if (block.type === 'python') {
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
            <ActivityPythonBlock
              code={block.content || ''}   // ← always the sheet content
              blockIndex={localKey}
              editable={canEdit}
              localOnly={true}             // ← no persistence
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
          <ActivityPythonBlock
            key={`py-${index}-${block.content?.slice(0, 10) || ''}`}
            code={displayedCode}
            blockIndex={`py-${codeKey}-${index}`}
            editable={canEdit}
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
      const codeIndicesByLang = { python: [], cpp: [] };
      (block.codeBlocks || []).forEach(cb => {
        if (cb.lang === 'python') codeIndicesByLang.python.push(cb.index);
        if (cb.lang === 'cpp') codeIndicesByLang.cpp.push(cb.index);
      });

      const responseKey = `${block.groupId}${block.id}`;
      const followupAppeared = !!followupsShown?.[responseKey];
      const groupComplete = prefill?.[`${responseKey}S`] === 'complete';

      const hasPython = (block.pythonBlocks?.length || 0) > 0;
      const hasCpp = (block.cppBlocks?.length || 0) > 0;
      const isCodeOnly =
        (hasPython || hasCpp) && !block.hasTextResponse && !block.hasTableResponse;

      // Show a free-text box only if explicitly requested OR (no code & no table)
      const showTextArea =
        block.hasTextResponse || (!hasPython && !hasCpp && !block.hasTableResponse);

      const lockMainResponse =
        runMode === 'preview'
          ? !!followupsShown?.[responseKey] && !!block.hasTextResponse
          : false;


      // NEW: formatted score badges
      const scoreBadges = [];
      if (block.scores) {
        const scoreEntries = [
          ['response', 'Response'],
          ['code', 'Code'],
          ['output', 'Output'],
        ];
        for (const [key, label] of scoreEntries) {
          const s = block.scores[key];
          if (s && typeof s.points === 'number') {
            scoreBadges.push(
              <span
                key={`score-${responseKey}-${key}`}
                className="badge bg-light text-muted border ms-2"
              >
                {s.points} pt{s.points !== 1 ? 's' : ''} {label}
              </span>
            );
          }
        }
      }

      return (
        <div
          key={`q-${block.groupId}-${block.id}`}  // ✅ unique per question
          className="mb-4"
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

          {block.pythonBlocks?.map((py, i) => {
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
              <div key={`q-${block.groupId}-${block.id}-py-${i}`}>
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
                <ActivityPythonBlock
                  key={`q-${block.groupId}-${block.id}-py-${i}`}
                  code={displayedCode}
                  blockIndex={`q-${currentGroupIndex}-${block.id}-${i}`}
                  editable={canEdit}
                  localOnly={runMode === 'preview'}
                  responseKey={responseKey}
                  onCodeChange={(rk, code, extra) => {
                    if (showToggle && codeMode === 'local' && !isActive) {
                      options.onLocalCodeChange?.(rk, code);
                      return;
                    }
                    onCodeChange && onCodeChange(rk, code, { ...meta, ...extra });
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
              <div key={`q-${block.groupId}-${block.id}-cpp-${i}`}>
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

          {showTextArea ? (
            (() => {
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
                <>
                  <Form.Control
                    as="textarea"
                    rows={Math.max((block.responseLines || 1), 2)}
                    {...makeResponseAttrs({ key: responseKey, kind: "text", qid: responseKey })}
                    value={prefill?.[responseKey]?.response || ''}
                    readOnly={
                      !editable ||
                      lockMainResponse ||
                      prefill?.[`${responseKey}S`] === 'complete' ||
                      prefill?.[`${responseKey}S`]?.response === 'complete'
                    }
                    className="mt-2"
                    style={{ resize: 'vertical' }}
                    onChange={(e) => {
                      const val = e.target.value;
                      options.onTextChange?.(responseKey, val, meta);
                    }}
                  />


                  {/* 🔶 AI Guidance: visible to active student, observers, and instructor */}
                  {guidance && (
                    <Alert
                      variant="warning"
                      className="mt-2"
                      style={{ whiteSpace: 'pre-wrap' }}
                    >
                      <strong>AI Guidance</strong>
                      <div>{guidance}</div>
                    </Alert>
                  )}
                </>
              );
            })()
          ) : null}




          {runMode === 'preview' && (
            <>
              {block.samples?.length > 0 && <p className="text-muted"><em>Sample: {block.samples.join('; ')}</em></p>}
              {block.feedback?.length > 0 && <p className="text-muted"><em>Feedback: {block.feedback.join('; ')}</em></p>}
              {block.followups?.length > 0 && <p className="text-muted"><em>Follow-up: {block.followups.join('; ')}</em></p>}
            </>
          )}

          {/* Show saved followup Q&A in read-only format */}


          {/* Follow-up UI */}
          {followupsShown?.[responseKey] && (
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
      );
    }

    return null;
  });
}


// End parseSheet.jsx
