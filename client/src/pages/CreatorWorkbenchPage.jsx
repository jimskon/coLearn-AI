import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import CreatorTutorialOverlay, { useCreatorTutorial } from '../components/tutorial/CreatorTutorialOverlay';
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Container,
  Form,
  Modal,
  Spinner,
} from 'react-bootstrap';
import {
  ArrowLeft,
  Check2,
  ChatDots,
  Eye,
  PencilSquare,
  PlayCircle,
  PlusLg,
  Save,
  Stars,
  Trash,
  X,
} from 'react-bootstrap-icons';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
import useRuntimeFeatures from '../hooks/useRuntimeFeatures';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { createInfoBubbleSession } from '../utils/infoBubbleSession';

const emptyDraft = {
  title: '',
  duration_minutes: '45',
  mode: 'group',
  selected_model: 'gpt-5-mini',
  major_sections: [
    'Learning Objectives',
    'Exploration',
    'Concept Invention',
    'Application',
    'Reflection',
  ],
  description: '',
};

const creatorModelOptions = [
  { value: 'gpt-4o-mini', label: 'gpt-4o-mini', note: 'fast' },
  { value: 'gpt-5-mini', label: 'gpt-5-mini', note: 'balanced' },
  { value: 'gpt-4o', label: 'gpt-4o', note: 'strong' },
  { value: 'gpt-5.1', label: 'gpt-5.1', note: 'high quality' },
  { value: 'gpt-5.2', label: 'gpt-5.2', note: 'highest quality' },
];

const emptyAdvancedDraft = {
  language: 'English',
  include_timing: false,
  submit_retries: '3',
  include_info: false,
  difficulty: 'medium',
};

const majorSectionOptions = [
  'Learning Objectives',
  'Exploration',
  'Concept Invention',
  'Application',
  'Reflection',
];

function cloneEmptyDraft(overrides = {}) {
  return {
    ...emptyDraft,
    major_sections: [...emptyDraft.major_sections],
    ...overrides,
  };
}

function cloneEmptyAdvancedDraft() {
  return { ...emptyAdvancedDraft };
}

function buildAdvancedPromptText(advanced) {
  const lines = [];
  const language = String(advanced?.language || '').trim();
  if (language && language.toLowerCase() !== 'english') {
    lines.push(`Make the activity in ${language}.`);
  }
  if (advanced?.include_timing) {
    lines.push('Include timing on sections.');
  }
  const retries = parseInt(advanced?.submit_retries, 10);
  if (Number.isFinite(retries) && retries !== 3) {
    lines.push(`Use ${retries} submit retries.`);
  }
  if (advanced?.include_info) {
    lines.push('Include info boxes when helpful.');
  }
  if (advanced?.difficulty === 'easy') {
    lines.push('Aim for easy difficulty and simpler student answers.');
  } else if (advanced?.difficulty === 'challenging') {
    lines.push('Aim for challenging difficulty and deeper, more precise student answers.');
  }
  return lines.join(' ');
}

function appendAdvancedPrompt(baseText, advancedText) {
  return [String(baseText || '').trim(), String(advancedText || '').trim()].filter(Boolean).join('\n\n');
}

async function readJsonResponse(res) {
  const raw = await res.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    const head = raw.trim().slice(0, 120).replace(/\s+/g, ' ');
    throw new Error(head.startsWith('<html') || head.startsWith('<!doctype')
      ? 'Server returned HTML instead of JSON.'
      : `Unexpected server response: ${head || 'non-JSON body'}`);
  }
}

function collectFileContents(blocks) {
  const files = {};
  for (const block of blocks || []) {
    if (block?.type === 'file' && block?.filename) {
      files[block.filename] = block.content ?? '';
    }
  }
  return files;
}

function parseActivityText(text) {
  const parsed = parseSheetToBlocks(String(text || '').split('\n'), { returnIssues: true });
  const blocks = Array.isArray(parsed?.blocks)
    ? parsed.blocks
    : Array.isArray(parsed)
      ? parsed
      : [];
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  return { blocks, issues, files: collectFileContents(blocks) };
}

function htmlToEditorText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function updateLine(lines, lineNumber, nextValue) {
  if (!Number.isFinite(lineNumber) || lineNumber <= 0) return false;
  const index = lineNumber - 1;
  if (index < 0 || index >= lines.length) return false;
  lines[index] = nextValue;
  return true;
}

function insertLinesAfterAnchors(lines, insertions) {
  const ordered = [...insertions]
    .filter((item) => Number.isFinite(item?.anchorLine) && item.anchorLine >= 0 && item.text)
    .sort((a, b) => a.anchorLine - b.anchorLine);

  let offset = 0;
  for (const insertion of ordered) {
    const index = Math.max(0, Math.min(lines.length, insertion.anchorLine + offset));
    lines.splice(index, 0, insertion.text);
    offset += 1;
  }
}

function applyQuestionEditsToSource(sourceText, block, edits) {
  const sourceMeta = block?.sourceMeta;
  if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return sourceText;

  const lines = String(sourceText || '').split('\n');
  updateLine(lines, sourceMeta.questionLine, `\\question{${String(edits.prompt || '').trim()}}`);

  const responseLineCount = Math.max(1, Number.parseInt(edits.responseLines, 10) || 1);
  const sampleResponse = String(edits.sampleResponse || '').trim();
  const feedbackPrompt = String(edits.feedbackPrompt || '').trim();
  const followupPrompt = String(edits.followupPrompt || '').trim();
  const insertions = [];

  if (sourceMeta.textResponseLine) {
    updateLine(lines, sourceMeta.textResponseLine, `\\textresponse{${responseLineCount}}`);
  } else if (responseLineCount > 0) {
    insertions.push({
      anchorLine: sourceMeta.questionLine,
      text: `\\textresponse{${responseLineCount}}`,
    });
  }

  if (Array.isArray(sourceMeta.sampleLines) && sourceMeta.sampleLines[0]) {
    updateLine(lines, sourceMeta.sampleLines[0], `\\sampleresponses{${sampleResponse}}`);
  } else if (sampleResponse) {
    insertions.push({
      anchorLine: sourceMeta.textResponseLine || sourceMeta.questionLine,
      text: `\\sampleresponses{${sampleResponse}}`,
    });
  }

  if (Array.isArray(sourceMeta.feedbackLines) && sourceMeta.feedbackLines[0]) {
    updateLine(lines, sourceMeta.feedbackLines[0], `\\feedbackprompt{${feedbackPrompt}}`);
  } else if (feedbackPrompt) {
    insertions.push({
      anchorLine:
        sourceMeta.sampleLines?.[0] ||
        sourceMeta.textResponseLine ||
        sourceMeta.questionLine,
      text: `\\feedbackprompt{${feedbackPrompt}}`,
    });
  }

  if (Array.isArray(sourceMeta.followupLines) && sourceMeta.followupLines[0]) {
    updateLine(lines, sourceMeta.followupLines[0], `\\followupprompt{${followupPrompt}}`);
  } else if (followupPrompt) {
    insertions.push({
      anchorLine:
        sourceMeta.feedbackLines?.[0] ||
        sourceMeta.sampleLines?.[0] ||
        sourceMeta.textResponseLine ||
        sourceMeta.questionLine,
      text: `\\followupprompt{${followupPrompt}}`,
    });
  }

  insertLinesAfterAnchors(lines, insertions);
  return lines.join('\n');
}

function buildQuestionInspectorDraft(block) {
  return {
    prompt: htmlToEditorText(block?.prompt),
    responseLines: Number(block?.responseLines) || 1,
    sampleResponse: htmlToEditorText(block?.samples?.[0]),
    feedbackPrompt: htmlToEditorText(block?.feedback?.[0]),
    followupPrompt: htmlToEditorText(block?.followups?.[0]),
  };
}

function applyAiEditsToSource(sourceText, block, edits) {
  const sourceMeta = block?.sourceMeta;
  if (!sourceMeta?.aiLine || !sourceMeta?.endAiLine) return sourceText;

  const lines = String(sourceText || '').split('\n');
  const title = String(edits.title || '').trim();
  const prompt = String(edits.prompt || '').trim();
  const guardrail = String(edits.guardrail || '').trim();
  const context = Array.isArray(edits.contextSources)
    ? edits.contextSources
    : String(edits.contextSources || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  const inputRows = Math.max(2, Number.parseInt(edits.inputRows, 10) || 4);
  const insertions = [];

  updateLine(lines, sourceMeta.aiLine, `\\ai{${String(edits.mode || 'explain').trim().toLowerCase() || 'explain'}}`);

  if (sourceMeta.titleLine) {
    updateLine(lines, sourceMeta.titleLine, `\\aititle{${title}}`);
  } else if (title) {
    insertions.push({ anchorLine: sourceMeta.aiLine, text: `\\aititle{${title}}` });
  }

  if (sourceMeta.promptLine) {
    updateLine(lines, sourceMeta.promptLine, `\\aiprompt{${prompt}}`);
  } else if (prompt) {
    insertions.push({ anchorLine: sourceMeta.titleLine || sourceMeta.aiLine, text: `\\aiprompt{${prompt}}` });
  }

  if (sourceMeta.guardrailLine) {
    updateLine(lines, sourceMeta.guardrailLine, `\\aiguardrail{${guardrail}}`);
  } else if (guardrail) {
    insertions.push({ anchorLine: sourceMeta.promptLine || sourceMeta.titleLine || sourceMeta.aiLine, text: `\\aiguardrail{${guardrail}}` });
  }

  if (sourceMeta.contextLine) {
    updateLine(lines, sourceMeta.contextLine, `\\aicontext{${context.join(',')}}`);
  } else if (context.length) {
    insertions.push({ anchorLine: sourceMeta.guardrailLine || sourceMeta.promptLine || sourceMeta.titleLine || sourceMeta.aiLine, text: `\\aicontext{${context.join(',')}}` });
  }

  if (sourceMeta.inputLine) {
    updateLine(lines, sourceMeta.inputLine, `\\aiinput{${inputRows}}`);
  } else {
    insertions.push({ anchorLine: sourceMeta.contextLine || sourceMeta.guardrailLine || sourceMeta.promptLine || sourceMeta.titleLine || sourceMeta.aiLine, text: `\\aiinput{${inputRows}}` });
  }

  insertLinesAfterAnchors(lines, insertions);
  return lines.join('\n');
}

function buildAiInspectorDraft(block) {
  return {
    mode: String(block?.mode || 'explain').trim().toLowerCase() || 'explain',
    title: htmlToEditorText(block?.title || 'AI Coach'),
    prompt: htmlToEditorText(block?.prompt),
    guardrail: htmlToEditorText(block?.guardrail),
    contextSources: Array.isArray(block?.contextSources) ? block.contextSources.join(', ') : '',
    inputRows: Number(block?.inputRows) || 4,
  };
}

function findSelectableBlockByPreviewKey(blocks, previewKey) {
  if (!previewKey) return null;
  for (const block of blocks || []) {
    if (block?.previewKey === previewKey) return block;
    if (Array.isArray(block?.aiBlocks)) {
      const aiMatch = block.aiBlocks.find((aiBlock) => aiBlock?.previewKey === previewKey);
      if (aiMatch) return aiMatch;
    }
  }
  return null;
}

const starterQuestionLines = [
  '\\question{New question prompt.}',
  '\\textresponse{3}',
  '\\sampleresponses{Example response.}',
  '\\feedbackprompt{Explain what a strong answer includes.}',
  '\\endquestion',
];

const starterQuestionGroupLines = [
  '\\questiongroup{New Question Group}',
  ...starterQuestionLines,
  '\\endquestiongroup',
];

export default function CreatorWorkbenchPage() {
  const { classId, activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const isDemoCreator = new URLSearchParams(location.search).get('demo') === '1';

  const [classInfo, setClassInfo] = useState(null);
  const [activity, setActivity] = useState(null);
  const [draft, setDraft] = useState(() => cloneEmptyDraft({
    duration_minutes: isDemoCreator ? '10' : emptyDraft.duration_minutes,
    selected_model: isDemoCreator ? 'gpt-5-mini' : emptyDraft.selected_model,
  }));
  const [advancedDraft, setAdvancedDraft] = useState(() => cloneEmptyAdvancedDraft());
  const [rawText, setRawText] = useState('');
  const [blocks, setBlocks] = useState([]);
  const [parseIssues, setParseIssues] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const { features: runtimeFeatures } = useRuntimeFeatures();
  const [skulptLoaded, setSkulptLoaded] = useState(false);

  const [rightMode, setRightMode] = useState('preview');
  const [createBusy, setCreateBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState(false);
  const [sandboxBusy, setSandboxBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const [revisionRequest, setRevisionRequest] = useState('');
  const [messages, setMessages] = useState([]);
  const [proposal, setProposal] = useState(null);
  const [sandboxUrl, setSandboxUrl] = useState('');
  const [selectedPreviewKey, setSelectedPreviewKey] = useState('');
  const [questionInspectorDraft, setQuestionInspectorDraft] = useState(null);
  const [aiInspectorDraft, setAiInspectorDraft] = useState(null);
  const [showPreviewInspector, setShowPreviewInspector] = useState(true);
  const [showIssuesModal, setShowIssuesModal] = useState(false);

  const autoTimerRef = useRef(null);
  const infoBubbleSessionRef = useRef(createInfoBubbleSession());
  const creatorTutorial = useCreatorTutorial({ demoMode: isDemoCreator });

  const tutorialRefs = {
    classLink: useRef(null),
    title: useRef(null),
    minutes: useRef(null),
    brief: useRef(null),
    sandbox: useRef(null),
    revision: useRef(null),
  };
  const effectiveClassId = classId || activity?.class_id;
  const activeBlocks = proposal?.blocks || blocks;
  const activeIssues = proposal?.issues || parseIssues;
  const activeText = proposal?.text || rawText;
  const hasProposalErrors = !!proposal?.issues?.some((issue) => issue.severity === 'error');
  const advancedPromptText = useMemo(() => buildAdvancedPromptText(advancedDraft), [advancedDraft]);

  const updateFileContents = useCallback((updaterFn) => {
    setFileContents((prev) => updaterFn(prev));
  }, []);

  const creatorModelChoices = useMemo(() => (
    isDemoCreator
      ? creatorModelOptions.filter((option) => ['gpt-5-mini', 'gpt-4o-mini'].includes(option.value))
      : creatorModelOptions
  ), [isDemoCreator]);

  function selectInsertedQuestion(parsed, questionLine) {
    const inserted = parsed.blocks.find((block) => (
      block?.type === 'question' && block?.sourceMeta?.questionLine === questionLine
    ));
    setSelectedPreviewKey(inserted?.previewKey || '');
  }

  function insertStarterQuestion(block, placement) {
    const sourceMeta = block?.sourceMeta;
    if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return;

    const lines = String(rawText || '').split('\n');
    const insertionIndex = placement === 'before'
      ? sourceMeta.questionLine - 1
      : sourceMeta.endQuestionLine;
    const nextText = [...lines];
    nextText.splice(insertionIndex, 0, ...starterQuestionLines);
    const nextSource = nextText.join('\n');
    const parsed = compileText(nextSource);

    setRawText(nextSource);
    setSandboxUrl('');
    selectInsertedQuestion(parsed, insertionIndex + 1);
    setNotice('Added a new question. Use the Question Panel to edit it.');
    setTimeout(() => setNotice(''), 2400);
  }

  function insertStarterQuestionGroup(block, placement) {
    const sourceMeta = block?.sourceMeta;
    const groupLine = sourceMeta?.groupLine;
    const endGroupLine = sourceMeta?.endGroupLine;
    const insertionIndex = placement === 'before'
      ? groupLine - 1
      : endGroupLine;

    if (!Number.isFinite(insertionIndex) || insertionIndex < 0) return;

    const lines = String(rawText || '').split('\n');
    const nextText = [...lines];
    nextText.splice(insertionIndex, 0, ...starterQuestionGroupLines);
    const nextSource = nextText.join('\n');
    const parsed = compileText(nextSource);

    setRawText(nextSource);
    setSandboxUrl('');
    selectInsertedQuestion(parsed, insertionIndex + 2);
    setNotice('Added a new question group. Use the Question Panel to edit its starter question.');
    setTimeout(() => setNotice(''), 2400);
  }

  function renderInsertionMarker(key, label, onClick) {
    return (
      <div key={key} className="creator-insert-slot">
        <Button
          type="button"
          size="sm"
          variant="outline-primary"
          className="creator-insert-button"
          aria-label={label}
          title={label}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
        >
          <PlusLg />
        </Button>
      </div>
    );
  }

  const renderedActivity = useMemo(() => renderBlocks(activeBlocks, {
    mode: 'preview',
    editable: true,
    isInstructor: true,
    allowLocalToggle: false,
    fileContents,
    setFileContents: updateFileContents,
    infoBubbleSession: infoBubbleSessionRef.current,
    runtimeFeatures,
    onSelectBlock: proposal ? null : (block) => setSelectedPreviewKey(block?.previewKey || ''),
    selectedPreviewKey,
    renderInsertBeforeQuestion: proposal ? null : (block) => renderInsertionMarker(
      `before-question-${block.previewKey}`,
      'Add question before',
      () => insertStarterQuestion(block, 'before')
    ),
    renderInsertAfterQuestion: proposal ? null : (block) => renderInsertionMarker(
      `after-question-${block.previewKey}`,
      'Add question after',
      () => insertStarterQuestion(block, 'after')
    ),
    renderInsertBeforeGroup: proposal ? null : (block) => renderInsertionMarker(
      `before-group-${block.groupId}`,
      'Add question group before',
      () => insertStarterQuestionGroup(block, 'before')
    ),
    renderInsertAfterGroup: proposal ? null : (block) => renderInsertionMarker(
      `after-group-${block.groupId}`,
      'Add question group after',
      () => insertStarterQuestionGroup(block, 'after')
    ),
  }), [activeBlocks, fileContents, proposal, selectedPreviewKey, updateFileContents, infoBubbleSessionRef, runtimeFeatures, insertStarterQuestion, insertStarterQuestionGroup]);

  const selectedPreviewBlock = useMemo(() => (
    findSelectableBlockByPreviewKey(activeBlocks, selectedPreviewKey)
  ), [activeBlocks, selectedPreviewKey]);

  const selectedQuestionBlock = selectedPreviewBlock?.type === 'question' ? selectedPreviewBlock : null;
  const selectedAiBlock = selectedPreviewBlock?.type === 'ai' ? selectedPreviewBlock : null;

  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    if (isDemoCreator && !['gpt-5-mini', 'gpt-4o-mini'].includes(draft.selected_model)) {
      setDraft((prev) => ({
        ...prev,
        selected_model: 'gpt-5-mini',
      }));
    }
  }, [draft.selected_model, isDemoCreator]);

  const compileText = useCallback((sourceText) => {
    const parsed = parseActivityText(sourceText);
    setBlocks(parsed.blocks);
    setParseIssues(parsed.issues);
    setFileContents(parsed.files);
    return parsed;
  }, []);

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
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script ${src}`));
        document.head.appendChild(script);
      });

    const loadSkulpt = async () => {
      try {
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt.min.js');
        await loadScript('https://cdn.jsdelivr.net/npm/skulpt@1.2.0/dist/skulpt-stdlib.js');
        setSkulptLoaded(true);
      } catch (err) {
        console.error('Skulpt failed to load', err);
        setSkulptLoaded(true);
      }
    };

    loadSkulpt();
  }, []);

  useEffect(() => {
    if (user && !canManage) {
      navigate('/dashboard');
    }
  }, [canManage, navigate, user]);

  useEffect(() => {
    const loadClassInfo = async (id) => {
      if (!id) return;
      const res = await fetch(`${API_BASE_URL}/api/classes/${id}`, { credentials: 'include' });
      const data = await res.json();
      if (res.ok && !data.error) setClassInfo(data);
    };

    const loadActivity = async () => {
      if (!activityId || !skulptLoaded) {
        if (classId) loadClassInfo(classId).catch(console.error);
        return;
      }

      try {
        setError('');
        const activityRes = await fetch(`${API_BASE_URL}/api/activities/${activityId}`, {
          credentials: 'include',
        });
        const activityData = await activityRes.json();
        if (!activityRes.ok) throw new Error(activityData?.error || 'Failed to load activity.');

        const sourceRes = await fetch(`${API_BASE_URL}/api/activities/${activityId}/source`, {
          credentials: 'include',
        });
        const sourceData = await sourceRes.json();
        if (!sourceRes.ok) throw new Error(sourceData?.error || 'Failed to load activity source.');

        const text = Array.isArray(sourceData?.lines)
          ? sourceData.lines.join('\n')
          : String(sourceData?.text || activityData?.content_text || '');

        setActivity(activityData);
        setRawText(text);
        compileText(text);
        await loadClassInfo(activityData.class_id);
      } catch (err) {
        console.error('Creator workbench load failed:', err);
        setError(err?.message || String(err));
      }
    };

    loadActivity();
  }, [activityId, classId, compileText, skulptLoaded]);

  useEffect(() => {
    if (!skulptLoaded || !rawText.trim() || proposal) return undefined;
    clearTimeout(autoTimerRef.current);
    autoTimerRef.current = setTimeout(() => compileText(rawText), 250);
    return () => clearTimeout(autoTimerRef.current);
  }, [compileText, proposal, rawText, skulptLoaded]);

  useEffect(() => {
    if (!selectedQuestionBlock) {
      setQuestionInspectorDraft(null);
    } else {
      setShowPreviewInspector(true);
      setQuestionInspectorDraft(buildQuestionInspectorDraft(selectedQuestionBlock));
    }
  }, [selectedQuestionBlock]);

  useEffect(() => {
    if (!selectedAiBlock) {
      setAiInspectorDraft(null);
    } else {
      setShowPreviewInspector(true);
      setAiInspectorDraft(buildAiInspectorDraft(selectedAiBlock));
    }
  }, [selectedAiBlock]);

  useEffect(() => {
    if (!proposal) return;
    setSelectedPreviewKey('');
  }, [proposal]);

  const handleDraftChange = (field, value) => {
    setDraft((prev) => {
      if (field === 'mode') {
        return { ...prev, mode: value, major_sections: [...majorSectionOptions] };
      }
      return { ...prev, [field]: value };
    });
  };

  const toggleMajorSection = (sectionName) => {
    setDraft((prev) => {
      const selected = new Set(prev.major_sections || []);
      if (selected.has(sectionName)) selected.delete(sectionName);
      else selected.add(sectionName);
      return {
        ...prev,
        major_sections: majorSectionOptions.filter((option) => selected.has(option)),
      };
    });
  };

  const createDraft = async () => {
    setNotice('');
    setError('');

    if (!draft.title.trim() || !draft.description.trim()) {
      setError('Enter a title and creator brief.');
      return;
    }

    const durationMinutes = parseInt(draft.duration_minutes, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError('Enter a valid duration.');
      return;
    }

    if (!draft.major_sections?.length) {
      setError('Select at least one section.');
      return;
    }

    setCreateBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/creator-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: draft.title.trim(),
          duration_minutes: durationMinutes,
          mode: draft.mode,
          selected_model: draft.selected_model,
          major_sections: draft.major_sections,
          description: appendAdvancedPrompt(draft.description, advancedPromptText),
          createdBy: user?.id,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Failed to create draft.');

      setActivity(data);
      setRawText(data.content_text || '');
      compileText(data.content_text || '');
      setMessages([{ role: 'assistant', text: 'Draft created.' }]);
      creatorTutorial.startAfterGenerate();
      if (data.generation_status === 'fallback') {
        setNotice(data.generation_error || 'A fallback draft was created.');
      }
      navigate(`/creator/${data.id}`, { replace: true });
    } catch (err) {
      console.error('Create draft failed:', err);
      setError(err?.message || String(err));
    } finally {
      setCreateBusy(false);
    }
  };

  const saveSource = async (sourceText = rawText) => {
    if (!activity?.id) throw new Error('Create a draft before saving.');
    setSaveBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: sourceText }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Save failed ${res.status}`);
      setActivity((prev) => ({ ...(prev || {}), title: data?.title || prev?.title, content_text: sourceText }));
      setNotice('Saved.');
      setTimeout(() => setNotice(''), 1800);
      return data;
    } finally {
      setSaveBusy(false);
    }
  };

  const requestRevision = async () => {
    const requestText = revisionRequest.trim();
    if (!activity?.id || !effectiveClassId) {
      setError('Create a draft before requesting revisions.');
      return;
    }
    if (!requestText) return;

    setError('');
    setNotice('');
    setProposal(null);
    setRevisionBusy(true);
    setMessages((prev) => [...prev, { role: 'user', text: requestText }]);
    setRevisionRequest('');

    try {
      const parsedNow = compileText(rawText);
      const res = await fetch(`${API_BASE_URL}/api/classes/${effectiveClassId}/creator-draft/${activity.id}/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          request: appendAdvancedPrompt(requestText, advancedPromptText),
          doc_text: rawText,
          selected_model: draft.selected_model,
          parse_issues: parsedNow.issues,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Revision request failed.');

      const proposedText = data.proposedDocText || data.proposed_doc_text || '';
      if (!proposedText.trim()) throw new Error('Revision returned an empty proposal.');
      const parsedProposal = parseActivityText(proposedText);
      setProposal({
        text: proposedText,
        summary: Array.isArray(data.summary) ? data.summary : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
        issues: parsedProposal.issues,
        blocks: parsedProposal.blocks,
        generationStatus: data.generation_status,
      });
      setFileContents(parsedProposal.files);
      setRightMode('preview');
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: data.generation_status === 'generated'
            ? 'Proposed revision ready for review.'
            : (data.generation_error || 'Returned the current draft unchanged.'),
        },
      ]);
    } catch (err) {
      console.error('Revision failed:', err);
      setError(err?.message || String(err));
      setMessages((prev) => [...prev, { role: 'assistant', text: err?.message || 'Revision failed.' }]);
    } finally {
      setRevisionBusy(false);
    }
  };

  const acceptProposal = async () => {
    if (!proposal?.text || hasProposalErrors) return;
    try {
      setError('');
      await saveSource(proposal.text);
      setRawText(proposal.text);
      compileText(proposal.text);
      setMessages((prev) => [...prev, { role: 'assistant', text: 'Revision accepted and saved.' }]);
      setProposal(null);
    } catch (err) {
      console.error('Accept proposal failed:', err);
      setError(err?.message || String(err));
    }
  };

  const openSandbox = async () => {
    if (!activity?.id || proposal) return;
    setSandboxBusy(true);
    setError('');
    try {
      await saveSource(rawText);
      const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/sandbox-instance`, {
        method: 'POST',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.instanceId) throw new Error(data?.error || 'Failed to open sandbox.');
      setSandboxUrl(`${window.location.origin}/run/${data.instanceId}?mode=creator_sandbox&embed=1&t=${Date.now()}`);
      setRightMode('sandbox');
    } catch (err) {
      console.error('Open sandbox failed:', err);
      setError(err?.message || String(err));
    } finally {
      setSandboxBusy(false);
    }
  };

  const selectRightMode = (mode) => {
    if (mode === 'sandbox') {
      openSandbox();
      return;
    }
    setRightMode(mode);
  };

  const applyQuestionInspectorChanges = () => {
    if (!selectedQuestionBlock || !questionInspectorDraft || proposal) return;
    const nextText = applyQuestionEditsToSource(rawText, selectedQuestionBlock, questionInspectorDraft);
    setRawText(nextText);
    compileText(nextText);
    setNotice('Updated question settings in source.');
    setTimeout(() => setNotice(''), 1800);
  };

  const applyAiInspectorChanges = () => {
    if (!selectedAiBlock || !aiInspectorDraft || proposal) return;
    const nextText = applyAiEditsToSource(rawText, selectedAiBlock, aiInspectorDraft);
    setRawText(nextText);
    compileText(nextText);
    setNotice('Updated AI block settings in source.');
    setTimeout(() => setNotice(''), 1800);
  };

  const removeQuestionGroup = (groupId, { skipConfirmation = false } = {}) => {
    if (proposal) return;
    const group = blocks.find((block) => block?.type === 'groupIntro' && block?.groupId === groupId);
    const startLine = group?.sourceMeta?.groupLine;
    const endLine = group?.sourceMeta?.endGroupLine;
    if (!startLine || !endLine) return;

    if (!skipConfirmation && !window.confirm('Remove this question group and every question in it?')) return;

    const lines = String(rawText || '').split('\n');
    lines.splice(startLine - 1, endLine - startLine + 1);
    const nextText = lines.join('\n');
    setRawText(nextText);
    setSandboxUrl('');
    setSelectedPreviewKey('');
    compileText(nextText);
    setNotice('Removed question group.');
    setTimeout(() => setNotice(''), 2400);
  };

  const removeSelectedQuestion = () => {
    if (!selectedQuestionBlock || proposal) return;
    const sourceMeta = selectedQuestionBlock.sourceMeta;
    if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return;

    const questionsInGroup = blocks.filter((block) => (
      block?.type === 'question' && block?.groupId === selectedQuestionBlock.groupId
    ));
    if (questionsInGroup.length <= 1) {
      if (!window.confirm('This is the only question in its group. Remove the entire question group?')) return;
      removeQuestionGroup(selectedQuestionBlock.groupId, { skipConfirmation: true });
      return;
    }

    if (!window.confirm('Remove this question?')) return;

    const lines = String(rawText || '').split('\n');
    lines.splice(sourceMeta.questionLine - 1, sourceMeta.endQuestionLine - sourceMeta.questionLine + 1);
    const nextText = lines.join('\n');
    setRawText(nextText);
    setSandboxUrl('');
    setSelectedPreviewKey('');
    compileText(nextText);
    setNotice('Removed question.');
    setTimeout(() => setNotice(''), 2400);
  };

  return (
    <Container fluid className="creator-workbench px-3">
      <style>{`
        .creator-workbench { padding-top: 0.75rem; }
        .creator-shell {
          display: grid;
          grid-template-columns: minmax(320px, 410px) minmax(0, 1fr);
          gap: 12px;
          height: calc(100vh - 88px);
          min-height: 620px;
        }
        .creator-left,
        .creator-right {
          border: 1px solid #d9dee3;
          background: #fff;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .creator-panel-header {
          flex: 0 0 auto;
          min-height: 52px;
          padding: 0.75rem;
          border-bottom: 1px solid #e4e7ea;
          background: #f8f9fa;
        }
        .creator-panel-body {
          flex: 1 1 auto;
          min-height: 0;
          overflow: auto;
          padding: 0.75rem;
        }
        .creator-chat-log {
          min-height: 120px;
          max-height: 210px;
          overflow: auto;
          border: 1px solid #e3e6ea;
          background: #fbfbfc;
          padding: 0.5rem;
        }
        .creator-chat-message {
          border-bottom: 1px solid #eceff2;
          padding: 0.35rem 0;
          white-space: pre-wrap;
        }
        .creator-chat-message:last-child { border-bottom: 0; }
        .creator-markup-editor {
          display: block;
          width: 100%;
          height: 100%;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          min-height: 0;
          resize: none;
          border: 0;
          border-radius: 0;
          line-height: 1.4;
          overflow: auto;
        }
        .creator-preview-surface {
          max-width: 980px;
          margin: 0 auto;
        }
        .creator-insert-slot {
          height: 14px;
          display: flex;
          align-items: center;
          justify-content: center;
          position: relative;
        }
        .creator-insert-slot::before {
          content: '';
          width: 100%;
          border-top: 1px dashed #c8d3df;
        }
        .creator-insert-button {
          position: absolute;
          z-index: 1;
          width: 24px;
          height: 24px;
          padding: 0;
          border-radius: 50%;
          background: #fff;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          transform: scale(0.85);
          transition: opacity 120ms ease, transform 120ms ease;
        }
        .creator-insert-slot:hover .creator-insert-button,
        .creator-insert-slot:focus-within .creator-insert-button {
          opacity: 1;
          transform: scale(1);
        }
        .creator-preview-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr);
          gap: 12px;
          align-items: start;
        }
        .creator-preview-toolbar {
          display: flex;
          justify-content: flex-end;
          margin-bottom: 0.75rem;
        }
        .creator-preview-inspector {
          border: 1px solid #d9dee3;
          border-radius: 10px;
          background: #fafbfc;
          padding: 0.9rem;
          position: sticky;
          top: 0;
          max-height: calc(100vh - 120px);
          overflow-y: auto;
        }
        @media (min-width: 1180px) {
          .creator-preview-layout {
            grid-template-columns: minmax(0, 1fr) 320px;
          }
        }
        .creator-sandbox-frame {
          width: 100%;
          height: 100%;
          border: 0;
          background: #fff;
        }
        .creator-issues-bar {
          border-top: 1px solid #d9dee3;
          background: #fffaf2;
        }
        .creator-issues-bar[data-severity="error"] {
          background: #fff6f6;
        }
        .creator-issue-item {
          white-space: pre-wrap;
          word-break: break-word;
        }
        @media (max-width: 900px) {
          .creator-shell {
            grid-template-columns: 1fr;
            height: auto;
          }
          .creator-left,
          .creator-right { min-height: 70vh; }
        }
      `}</style>

      <div className="d-flex align-items-center justify-content-between mb-2">
        <div>
          <h3 className="mb-0">Create Activity</h3>
          <div className="text-muted small">
            {classInfo?.name || (effectiveClassId ? `Class ${effectiveClassId}` : 'New class activity')}
            {activity?.title ? ` · ${activity.title}` : ''}
          </div>
        </div>
        <Button
          ref={tutorialRefs.classLink}
          variant="outline-secondary"
          size="sm"
          onClick={() => navigate(effectiveClassId ? `/class/${effectiveClassId}` : '/manage-classes')}
        >
          <ArrowLeft className="me-1" /> Class
        </Button>
      </div>

      {notice ? <Alert variant="info" className="py-2 mb-2">{notice}</Alert> : null}
      {error ? <Alert variant="danger" className="py-2 mb-2">{error}</Alert> : null}

      <div className="creator-shell">
        <section className="creator-left">
          <div className="creator-panel-header d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <div className="fw-semibold"><ChatDots className="me-2" />AI Builder</div>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowAdvanced(true)}>
                Advanced
              </Button>
            </div>
            {activity?.id ? <Badge bg="success">Draft #{activity.id}</Badge> : <Badge bg="secondary">Setup</Badge>}
          </div>
          <div className="creator-panel-body">
            {!activity?.id ? (
              <div>
                <Form.Group className="mb-3" ref={tutorialRefs.title}>
                  <Form.Label>Title</Form.Label>
                  <Form.Control
                    value={draft.title}
                    onChange={(event) => handleDraftChange('title', event.target.value)}
                    placeholder="Sorting Warmup"
                    autoFocus
                  />
                </Form.Group>

                <div className="row g-2 mb-3">
                  <div className="col-5">
                    <Form.Group ref={tutorialRefs.minutes}>
                      <Form.Label>Minutes</Form.Label>
                      <Form.Control
                        type="number"
                        min="1"
                        value={draft.duration_minutes}
                        onChange={(event) => handleDraftChange('duration_minutes', event.target.value)}
                      />
                    </Form.Group>
                  </div>
                  <div className="col-7">
                    <Form.Group>
                      <Form.Label>Mode</Form.Label>
                      <Form.Select value={draft.mode} onChange={(event) => handleDraftChange('mode', event.target.value)}>
                        <option value="group">Group</option>
                        <option value="demo">Demo</option>
                        <option value="test">Test</option>
                      </Form.Select>
                    </Form.Group>
                  </div>
                </div>

                <Form.Group className="mb-3">
                  <Form.Label>Model</Form.Label>
                  <Form.Select value={draft.selected_model} onChange={(event) => handleDraftChange('selected_model', event.target.value)}>
                    {creatorModelChoices.map((option) => (
                      <option key={option.value} value={option.value}>{option.label} · {option.note}</option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group className="mb-3">
                  <Form.Label>Sections</Form.Label>
                  <div className="d-grid gap-1">
                    {majorSectionOptions.map((sectionName) => (
                      <Form.Check
                        key={sectionName}
                        type="checkbox"
                        id={`creator-section-${sectionName.replace(/\s+/g, '-').toLowerCase()}`}
                        label={sectionName}
                        checked={draft.major_sections.includes(sectionName)}
                        onChange={() => toggleMajorSection(sectionName)}
                      />
                    ))}
                  </div>
                </Form.Group>

                <Form.Group className="mb-3" ref={tutorialRefs.brief}>
                  <Form.Label>Activity Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={8}
                    value={draft.description}
                    onChange={(event) => handleDraftChange('description', event.target.value)}
                  />
                </Form.Group>

                <Button variant="success" onClick={createDraft} disabled={createBusy || !classId}>
                  {createBusy ? <Spinner animation="border" size="sm" className="me-2" /> : <Stars className="me-2" />}
                  Create Draft
                </Button>
              </div>
            ) : (
              <div className="d-flex flex-column gap-3">
                <div className="creator-chat-log">
                  {messages.length ? messages.map((message, index) => (
                    <div className="creator-chat-message" key={`${message.role}-${index}`}>
                      <div className="small text-muted text-uppercase">{message.role === 'user' ? 'You' : 'AI'}</div>
                      <div>{message.text}</div>
                    </div>
                  )) : <div className="text-muted small">No revision requests yet.</div>}
                </div>

                {proposal ? (
                  <Alert variant={hasProposalErrors ? 'danger' : 'warning'} className="mb-0">
                    <div className="fw-semibold mb-2">Pending proposal</div>
                    {proposal.summary?.length ? (
                      <ul className="mb-2 ps-3">
                        {proposal.summary.map((item, index) => <li key={`summary-${index}`}>{item}</li>)}
                      </ul>
                    ) : null}
                    {proposal.warnings?.length ? (
                      <div className="small mb-2">
                        {proposal.warnings.map((item, index) => <div key={`warning-${index}`}>{item}</div>)}
                      </div>
                    ) : null}
                    {hasProposalErrors ? (
                      <div className="small mb-2">Resolve parser errors before accepting this proposal.</div>
                    ) : null}
                    <div className="d-flex gap-2">
                      <Button size="sm" variant="success" onClick={acceptProposal} disabled={saveBusy || hasProposalErrors}>
                        <Check2 className="me-1" /> Accept
                      </Button>
                      <Button size="sm" variant="outline-secondary" onClick={() => setProposal(null)} disabled={saveBusy}>
                        <X className="me-1" /> Reject
                      </Button>
                    </div>
                  </Alert>
                ) : null}

                <Form.Group>
                  <Form.Label>Model</Form.Label>
                  <Form.Select
                    value={draft.selected_model}
                    onChange={(event) => handleDraftChange('selected_model', event.target.value)}
                    disabled={revisionBusy || !!proposal}
                  >
                    {creatorModelChoices.map((option) => (
                      <option key={option.value} value={option.value}>{option.label} · {option.note}</option>
                    ))}
                  </Form.Select>
                </Form.Group>

                <Form.Group ref={tutorialRefs.revision}>
                  <Form.Label>Revision Request</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={5}
                    value={revisionRequest}
                    onChange={(event) => setRevisionRequest(event.target.value)}
                    disabled={revisionBusy || !!proposal}
                  />
                </Form.Group>
                <Button variant="primary" onClick={requestRevision} disabled={revisionBusy || !!proposal || !revisionRequest.trim()}>
                  {revisionBusy ? <Spinner animation="border" size="sm" className="me-2" /> : <Stars className="me-2" />}
                  Revise Draft
                </Button>
              </div>
            )}
          </div>
        </section>

        <section className="creator-right">
          <div className="creator-panel-header d-flex align-items-center justify-content-between gap-2">
            <div className="d-flex align-items-center gap-2">
              <ButtonGroup size="sm">
                <Button variant={rightMode === 'preview' ? 'primary' : 'outline-primary'} onClick={() => selectRightMode('preview')}>
                  <Eye className="me-1" /> Visual Editor
                </Button>
                <Button variant={rightMode === 'edit' ? 'primary' : 'outline-primary'} onClick={() => selectRightMode('edit')}>
                  <PencilSquare className="me-1" /> Source
                </Button>
                <Button
                  ref={tutorialRefs.sandbox}
                  variant={rightMode === 'sandbox' ? 'primary' : 'outline-primary'}
                  onClick={() => selectRightMode('sandbox')}
                  disabled={!activity?.id || !!proposal || sandboxBusy}
                >                  {sandboxBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <PlayCircle className="me-1" />}
                  Sandbox
                </Button>
              </ButtonGroup>
              {proposal ? <Badge bg="warning" text="dark">Proposal</Badge> : null}
              {activeIssues.length ? <Badge bg={activeIssues.some((issue) => issue.severity === 'error') ? 'danger' : 'warning'}>{activeIssues.length} issue{activeIssues.length === 1 ? '' : 's'}</Badge> : <Badge bg="success">Clean</Badge>}
            </div>
            <Button size="sm" variant="success" onClick={() => saveSource(rawText)} disabled={isDemoCreator || !activity?.id || saveBusy || !!proposal}>
              {saveBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <Save className="me-1" />}
              Save
            </Button>
          </div>
          {isDemoCreator ? (
            <div className="px-3 py-2 border-top bg-light text-muted small">
              Creator demo mode: Save is disabled. Model choices are limited to the demo set.
            </div>
          ) : null}

          <div className="creator-panel-body p-0">
            {rightMode === 'preview' ? (
              <div className="p-3">
                {!activity?.id && !activeText ? (
                  <Alert variant="secondary" className="mb-0">Create a draft to edit it visually here.</Alert>
                ) : (
                  <>
                    <div className="creator-preview-toolbar">
                      <Button
                        size="sm"
                        variant={showPreviewInspector ? 'outline-secondary' : 'outline-primary'}
                        onClick={() => setShowPreviewInspector((prev) => !prev)}
                      >
                        {showPreviewInspector ? 'Hide Panel' : 'Show Panel'}
                      </Button>
                    </div>
                    <div className="creator-preview-layout">
                    <div className="creator-preview-surface">{renderedActivity}</div>
                    {showPreviewInspector ? (
                      <aside className="creator-preview-inspector">
                        <div className="d-flex align-items-start justify-content-between gap-2 mb-2">
                          <div className="fw-semibold">
                            {selectedAiBlock ? 'AI Panel' : 'Question Panel'}
                          </div>
                          <Button
                            size="sm"
                            variant="link"
                            className="p-0 text-muted"
                            onClick={() => setShowPreviewInspector(false)}
                            aria-label="Hide question panel"
                          >
                            <X />
                          </Button>
                        </div>
                        {!selectedQuestionBlock ? (
                          !selectedAiBlock ? (
                            <div className="text-muted small">
                              Click a question or AI block in the Visual Editor to inspect and refine it without editing raw source.
                            </div>
                          ) : (
                            <>
                              <div className="text-muted small mb-3">
                                AI block · group {selectedAiBlock.groupId} · question {selectedAiBlock.parentQuestionId}
                              </div>

                              <Form.Group className="mb-3">
                                <Form.Label>Mode</Form.Label>
                                <Form.Select
                                  value={aiInspectorDraft?.mode || 'explain'}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), mode: event.target.value }))}
                                >
                                  <option value="explain">Explain</option>
                                  <option value="critique">Critique</option>
                                  <option value="testgen">Testgen</option>
                                  <option value="generate">Generate</option>
                                </Form.Select>
                              </Form.Group>

                              <Form.Group className="mb-3">
                                <Form.Label>Title</Form.Label>
                                <Form.Control
                                  value={aiInspectorDraft?.title || ''}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), title: event.target.value }))}
                                />
                              </Form.Group>

                              <Form.Group className="mb-3">
                                <Form.Label>Student Prompt</Form.Label>
                                <Form.Control
                                  as="textarea"
                                  rows={4}
                                  value={aiInspectorDraft?.prompt || ''}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), prompt: event.target.value }))}
                                />
                              </Form.Group>

                              <Form.Group className="mb-3">
                                <Form.Label>Guardrail</Form.Label>
                                <Form.Control
                                  as="textarea"
                                  rows={4}
                                  value={aiInspectorDraft?.guardrail || ''}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), guardrail: event.target.value }))}
                                />
                              </Form.Group>

                              <Form.Group className="mb-3">
                                <Form.Label>Context Sources</Form.Label>
                                <Form.Control
                                  value={aiInspectorDraft?.contextSources || ''}
                                  placeholder="current-question,current-code,student-response"
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), contextSources: event.target.value }))}
                                />
                                {!selectedAiBlock?.sourceMeta?.contextLine ? (
                                  <div className="text-muted small mt-1">Applying will add a new `\\aicontext` line to this AI block.</div>
                                ) : null}
                              </Form.Group>

                              <Form.Group className="mb-3">
                                <Form.Label>Input Rows</Form.Label>
                                <Form.Control
                                  type="number"
                                  min="2"
                                  value={aiInspectorDraft?.inputRows || 4}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), inputRows: event.target.value }))}
                                />
                              </Form.Group>

                              <div className="d-flex gap-2">
                                <Button size="sm" variant="primary" disabled={!aiInspectorDraft || !!proposal} onClick={applyAiInspectorChanges}>
                                  Apply
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  onClick={() => setAiInspectorDraft(buildAiInspectorDraft(selectedAiBlock))}
                                  disabled={!selectedAiBlock}
                                >
                                  Reset
                                </Button>
                              </div>

                              <div className="text-muted small mt-3">
                                This phase adds the authoring shell for `\\ai` blocks in the Visual Editor. Live AI execution comes next.
                              </div>
                            </>
                          )
                        ) : (
                          <>
                            <div className="text-muted small mb-3">
                              {selectedQuestionBlock.label} · group {selectedQuestionBlock.groupId}
                            </div>

                            <Form.Group className="mb-3">
                              <Form.Label>Question Text</Form.Label>
                              <Form.Control
                                as="textarea"
                                rows={4}
                                value={questionInspectorDraft?.prompt || ''}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), prompt: event.target.value }))}
                              />
                            </Form.Group>

                            <Form.Group className="mb-3">
                              <Form.Label>Sample Answer</Form.Label>
                              <Form.Control
                                as="textarea"
                                rows={3}
                                value={questionInspectorDraft?.sampleResponse || ''}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), sampleResponse: event.target.value }))}
                              />
                              {!selectedQuestionBlock?.sourceMeta?.sampleLines?.[0] ? (
                                <div className="text-muted small mt-1">Applying will add a new `\\sampleresponses` line to this question.</div>
                              ) : null}
                            </Form.Group>

                            <Form.Group className="mb-3">
                              <Form.Label>Feedback Guidance</Form.Label>
                              <Form.Control
                                as="textarea"
                                rows={3}
                                value={questionInspectorDraft?.feedbackPrompt || ''}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), feedbackPrompt: event.target.value }))}
                              />
                              {!selectedQuestionBlock?.sourceMeta?.feedbackLines?.[0] ? (
                                <div className="text-muted small mt-1">Applying will add a new `\\feedbackprompt` line to this question.</div>
                              ) : null}
                            </Form.Group>

                            <Form.Group className="mb-3">
                              <Form.Label>Follow-up Prompt</Form.Label>
                              <Form.Control
                                as="textarea"
                                rows={3}
                                value={questionInspectorDraft?.followupPrompt || ''}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), followupPrompt: event.target.value }))}
                              />
                              {!selectedQuestionBlock?.sourceMeta?.followupLines?.[0] ? (
                                <div className="text-muted small mt-1">Applying will add a new `\\followupprompt` line to this question.</div>
                              ) : null}
                            </Form.Group>

                            <Form.Group className="mb-3">
                              <Form.Label>Response Lines</Form.Label>
                              <Form.Control
                                type="number"
                                min="1"
                                value={questionInspectorDraft?.responseLines || 1}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), responseLines: event.target.value }))}
                              />
                              {!selectedQuestionBlock?.sourceMeta?.textResponseLine ? (
                                <div className="text-muted small mt-1">Applying will add a new `\\textresponse` line to this question.</div>
                              ) : null}
                            </Form.Group>

                            <div className="d-flex gap-2">
                              <Button size="sm" variant="primary" disabled={!questionInspectorDraft || !!proposal} onClick={applyQuestionInspectorChanges}>
                                Apply
                              </Button>
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                onClick={() => setQuestionInspectorDraft(buildQuestionInspectorDraft(selectedQuestionBlock))}
                                disabled={!selectedQuestionBlock}
                              >
                                Reset
                              </Button>
                            </div>

                            <div className="border-top mt-3 pt-3">
                              <div className="text-muted small mb-2">Remove</div>
                              <div className="d-flex flex-wrap gap-2">
                                <Button
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={!!proposal}
                                  onClick={removeSelectedQuestion}
                                >
                                  <Trash className="me-1" /> Remove Question
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-danger"
                                  disabled={!!proposal}
                                  onClick={() => removeQuestionGroup(selectedQuestionBlock.groupId)}
                                >
                                  <Trash className="me-1" /> Remove Question Group
                                </Button>
                              </div>
                            </div>

                            <div className="text-muted small mt-3">
                              This phase can now edit existing question metadata and add the common missing question lines when needed.
                            </div>
                          </>
                        )}
                      </aside>
                    ) : null}
                    </div>
                  </>
                )}
              </div>
            ) : null}

            {rightMode === 'edit' ? (
              <Form.Control
                as="textarea"
                className="creator-markup-editor"
                value={activeText}
                readOnly={!!proposal}
                spellCheck={false}
                onChange={(event) => {
                  setRawText(event.target.value);
                  setSandboxUrl('');
                }}
              />
            ) : null}

            {rightMode === 'sandbox' ? (
              sandboxUrl ? (
                <iframe title="Creator sandbox" className="creator-sandbox-frame" src={sandboxUrl} />
              ) : (
                <div className="p-3"><Alert variant="secondary">Sandbox is not open.</Alert></div>
              )
            ) : null}
          </div>

          {activeIssues.length ? (
            <div
              className="creator-issues-bar px-2 py-2 d-flex align-items-center justify-content-between gap-2"
              data-severity={activeIssues.some((issue) => issue.severity === 'error') ? 'error' : 'warning'}
            >
              <div className="small text-truncate">
                <strong>{activeIssues.some((issue) => issue.severity === 'error') ? 'Parser errors' : 'Parser warnings'}</strong>
                <span className="text-muted"> · {activeIssues.length} issue{activeIssues.length === 1 ? '' : 's'}</span>
                <span className="ms-2">
                  {typeof activeIssues[0]?.line === 'number' ? `Line ${activeIssues[0].line}: ` : ''}
                  {activeIssues[0]?.message}
                </span>
              </div>
              <div className="d-flex gap-2 flex-shrink-0">
                <Button size="sm" variant="outline-secondary" onClick={() => setRightMode('edit')}>
                  Open Source
                </Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setShowIssuesModal(true)}>
                  View All
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <Modal show={showAdvanced} onHide={() => setShowAdvanced(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Advanced</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-3">
            These settings only add extra instructions to the prompt. Nothing is saved.
          </p>

          <Form.Group className="mb-3">
            <Form.Label>Language</Form.Label>
            <Form.Control
              value={advancedDraft.language}
              onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, language: event.target.value }))}
              placeholder="English"
            />
          </Form.Group>

          <Form.Check
            className="mb-3"
            type="checkbox"
            id="advanced-include-timing"
            label="Include timing on sections"
            checked={advancedDraft.include_timing}
            onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, include_timing: event.target.checked }))}
          />

          <Form.Group className="mb-3">
            <Form.Label>Submit Retries</Form.Label>
            <Form.Control
              type="number"
              min="0"
              value={advancedDraft.submit_retries}
              onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, submit_retries: event.target.value }))}
            />
          </Form.Group>

          <Form.Check
            className="mb-3"
            type="checkbox"
            id="advanced-include-info"
            label="Include info boxes"
            checked={advancedDraft.include_info}
            onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, include_info: event.target.checked }))}
          />

          <Form.Group>
            <Form.Label>Difficulty</Form.Label>
            <Form.Select
              value={advancedDraft.difficulty}
              onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, difficulty: event.target.value }))}
            >
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="challenging">Challenging</option>
            </Form.Select>
          </Form.Group>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowAdvanced(false)}>Close</Button>
        </Modal.Footer>
      </Modal>
      <Modal show={showIssuesModal} onHide={() => setShowIssuesModal(false)} size="lg" centered scrollable>
        <Modal.Header closeButton>
          <Modal.Title>
            {activeIssues.some((issue) => issue.severity === 'error') ? 'Parser Errors' : 'Parser Warnings'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex justify-content-end mb-3">
            <Button size="sm" variant="outline-secondary" onClick={() => {
              setShowIssuesModal(false);
              setRightMode('edit');
            }}>
              Open Source
            </Button>
          </div>
          {activeIssues.map((issue, index) => (
            <Alert
              key={`creator-issue-modal-${index}`}
              variant={issue.severity === 'error' ? 'danger' : 'warning'}
              className="creator-issue-item py-2 px-3 mb-2"
            >
              <strong>{String(issue.severity || '').toUpperCase()}</strong>
              {typeof issue.line === 'number' ? ` line ${issue.line}` : ''}: {issue.message}
            </Alert>
          ))}
        </Modal.Body>
      </Modal>
      <CreatorTutorialOverlay
        phase={creatorTutorial.phase}
        refs={tutorialRefs}
        demoMode={isDemoCreator}
        onQuit={creatorTutorial.quit}
        onFinishSetup={creatorTutorial.finishSetup}
      />
    </Container>
  );
}
