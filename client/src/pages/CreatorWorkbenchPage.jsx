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
  ArrowCounterclockwise,
  ArrowDown,
  ArrowUp,
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
import { formatLocalDateTime } from '../utils/time';
import { API_BASE_URL } from '../config';
import useRuntimeFeatures from '../hooks/useRuntimeFeatures';
import {
  INLINE_AI_DEFAULT_MODEL,
  INLINE_AI_MODEL_OPTIONS,
  parseSheetToBlocks,
  renderBlocks,
} from '../utils/parseSheet';
import { createInfoBubbleSession } from '../utils/infoBubbleSession';
import { getSectionKeyAtLine, swapSourceRanges } from '../utils/creatorVisualEdits';
import { validateMultipleChoice } from '../utils/multipleChoice';
import markupValidator from '../../../shared/activityMarkupValidation.cjs';
import {
  serializeAiComponent,
  serializeQuestionComponent,
  serializeQuestionGroupComponent,
} from '../utils/creatorComponentSerialization';

const { validateActivityMarkup } = markupValidator;

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
  timed_section_minutes: {},
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
  return {
    ...emptyAdvancedDraft,
    timed_section_minutes: { ...emptyAdvancedDraft.timed_section_minutes },
  };
}

function slugifyActivityName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
}

function markupHeaderValue(value) {
  return String(value || '')
    .replace(/[{}]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
}

function upsertLanguageHeader(sourceText, language) {
  const normalizedLanguage = markupHeaderValue(language) || 'English';
  const lines = String(sourceText || '').split('\n');
  const existingIndex = lines.findIndex((line) => /^\\language\{[\s\S]*\}\s*$/.test(line.trim()));
  if (existingIndex >= 0) {
    lines[existingIndex] = `\\language{${normalizedLanguage}}`;
    return lines.join('\n');
  }

  const modeIndex = lines.findIndex((line) => /^\\mode\{[\s\S]*\}\s*$/.test(line.trim()));
  lines.splice(modeIndex >= 0 ? modeIndex + 1 : 0, 0, `\\language{${normalizedLanguage}}`);
  return lines.join('\n');
}

function allocateTimedSectionMinutes(sectionNames, totalMinutes) {
  const sections = Array.isArray(sectionNames) ? sectionNames : [];
  const total = Math.round(Number(totalMinutes));
  if (!sections.length || !Number.isFinite(total) || total < sections.length) return {};

  const base = Math.floor(total / sections.length);
  const remainder = total % sections.length;
  return Object.fromEntries(sections.map((sectionName, index) => [
    sectionName,
    String(base + (index < remainder ? 1 : 0)),
  ]));
}

function buildAdvancedPromptText(advanced) {
  const lines = [];
  const language = String(advanced?.language || '').trim();
  if (language && language.toLowerCase() !== 'english') {
    lines.push(`Make the activity in ${language}.`);
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
  const parserIssues = Array.isArray(parsed?.issues) ? parsed.issues : [];
  const structuralIssues = validateActivityMarkup(text).issues.map((issue) => ({
    ...issue,
    context: null,
  }));
  // The renderer provides detailed display warnings; this shared validator is
  // authoritative for errors that would make a deterministic visual edit unsafe.
  const issues = [...parserIssues, ...structuralIssues];
  return { blocks, issues, files: collectFileContents(blocks) };
}

function htmlToEditorText(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function buildQuestionInspectorDraft(block) {
  const multipleChoice = block?.multipleChoice;
  const scoreDraft = (type) => ({
    points: Number.isFinite(Number(block?.scores?.[type]?.points))
      ? String(block?.scores?.[type].points)
      : '',
    instructions: htmlToEditorText(
      block?.scores?.[type]?.instructionsRaw || block?.scores?.[type]?.instructionsHtml || ''
    ),
  });
  return {
    prompt: htmlToEditorText(block?.prompt),
    responseLines: multipleChoice ? '' : (block?.hasTextResponse ? (Number(block?.responseLines) || 1) : ''),
    sampleResponse: htmlToEditorText(block?.samples?.[0]),
    feedbackPrompt: htmlToEditorText(block?.feedback?.[0]),
    followupPrompt: htmlToEditorText(block?.followups?.[0]),
    multipleChoiceEnabled: !!multipleChoice,
    multipleChoiceSelectionMode: multipleChoice?.selectionMode || 'single',
    multipleChoiceAnswer: multipleChoice?.correctAnswer ?? '',
    multipleChoiceChoices: multipleChoice?.choices?.map((choice) => ({
      value: choice.value,
      points: choice.points,
    })) || [{ value: 'First option', points: null }, { value: 'Second option', points: null }],
    responseScorePoints: multipleChoice?.hasChoiceScores ? '' : scoreDraft('response').points,
    responseScoreInstructions: multipleChoice?.hasChoiceScores ? '' : scoreDraft('response').instructions,
    codeScorePoints: scoreDraft('code').points,
    codeScoreInstructions: scoreDraft('code').instructions,
    outputScorePoints: scoreDraft('output').points,
    outputScoreInstructions: scoreDraft('output').instructions,
  };
}

function findSectionCommandBeforeLine(sourceText, lineNumber) {
  const lines = String(sourceText || '').split('\n');
  const end = Math.max(0, Math.min(lines.length, Number(lineNumber) - 1));

  for (let index = end - 1; index >= 0; index -= 1) {
    const match = lines[index].match(/^\s*\\section\{([^{}]+)\}(?:\{(\d+)\})?\s*$/);
    if (match) {
      return {
        line: index + 1,
        title: match[1].trim(),
        minutes: match[2] ? Number.parseInt(match[2], 10) : null,
      };
    }
  }
  return null;
}

function buildQuestionGroupInspectorDraft(block, sourceText) {
  const section = findSectionCommandBeforeLine(sourceText, block?.sourceMeta?.groupLine);
  return {
    title: htmlToEditorText(block?.content || 'New Question Group'),
    retriesRequired: Math.max(0, Number.parseInt(block?.retriesRequired, 10) || 0),
    sectionTitle: section?.title || '',
    sectionTimerEnabled: Number.isFinite(section?.minutes),
    sectionMinutes: Number.isFinite(section?.minutes) ? String(section.minutes) : '',
  };
}

function buildAiInspectorDraft(block) {
  return {
    mode: String(block?.mode || 'explain').trim().toLowerCase() || 'explain',
    model: INLINE_AI_MODEL_OPTIONS.some((option) => option.value === block?.model)
      ? block.model
      : INLINE_AI_DEFAULT_MODEL,
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

const starterQuestionTemplates = {
  written: [
  '\\question{New question prompt.}',
  '\\textresponse{3}',
  '\\sampleresponses{Example response.}',
  '\\feedbackprompt{Explain what a strong answer includes.}',
  '\\endquestion',
  ],
  multiplechoice: [
    '\\question{Choose the best answer.}',
    '\\multiplechoice{First option}',
    '\\choice{First option}',
    '\\choice{Second option}',
    '\\endmultiplechoice',
    '\\sampleresponses{First option}',
    '\\feedbackprompt{Review the choices and explain why the selected answer is correct.}',
    '\\endquestion',
  ],
  python: [
    '\\question{Write and run a Python program that solves this task.}',
    '\\python',
    '# Write your Python code here',
    '\\endpython',
    '\\sampleresponses{A working Python solution.}',
    '\\feedbackprompt{Test the program and explain how it solves the task.}',
    '\\endquestion',
  ],
  pythonremote: [
    '\\question{Write and run a remote Python program that solves this task.}',
    '\\pythonremote',
    '# Write your remote Python code here',
    '\\endpythonremote',
    '\\sampleresponses{A working remote Python solution.}',
    '\\feedbackprompt{Test the program and explain how it solves the task.}',
    '\\endquestion',
  ],
  pythonturtle: [
    '\\question{Write and run a turtle program that creates the requested drawing.}',
    '\\pythonturtle{600x400}',
    'import turtle',
    '',
    '# Write your turtle code here',
    '\\endpythonturtle',
    '\\sampleresponses{A working turtle program that creates the requested drawing.}',
    '\\feedbackprompt{Run the drawing and explain how your code controls it.}',
    '\\endquestion',
  ],
  cpp: [
    '\\question{Write and run a C++ program that solves this task.}',
    '\\cpp',
    '#include <iostream>',
    '',
    'int main() {',
    '  // Write your C++ code here',
    '  return 0;',
    '}',
    '\\endcpp',
    '\\sampleresponses{A working C++ solution.}',
    '\\feedbackprompt{Compile the program and explain how it solves the task.}',
    '\\endquestion',
  ],
  ai: [
    '\\ai{explain}',
    '\\aititle{AI Coach}',
    '\\aiprompt{Ask for help reasoning through this activity without asking for the final answer.}',
    '\\aiguardrail{Ask guiding questions and keep the discussion focused on this activity.}',
    '\\aicontext{nearby-text}',
    '\\aiinput{4}',
    '\\endai',
  ],
};

function getStarterQuestionLines(questionType) {
  return starterQuestionTemplates[questionType] || starterQuestionTemplates.written;
}

// This is intentionally concrete rather than AI-generated.  It gives creators a
// reliable starting point for testing every major lab building block, then lets
// them replace the prompts with their own assignment.
const labBoilerplateSource = [
  '\\title{Programming Lab Boilerplate}',
  '\\name{programming_lab_boilerplate}',
  '\\mode{assignment}',
  '\\studentlevel{Introductory programming}',
  '\\activitycontext{Build a small program in milestones. Save and test your work as you go, then submit the complete lab once at the end. The scores shown after submission are preliminary until your instructor reviews them.}',
  '\\aicodeguidance{Act as a lab coach. Help students plan, debug, and test their own solution. Do not write the complete final solution for them.}',
  '',
  '\\questiongroup{Lab goal and plan}',
  '\\text{Goal: create a program that reads whole numbers, keeps the valid values, and prints their total and average.}',
  '\\question{In your own words, describe the input, processing, and output your final program will need.}',
  '\\textresponse{5}',
  '\\sampleresponses{The program reads values, validates them, accumulates a total and count, then prints the total and average.}',
  '\\feedbackprompt{Give constructive feedback on whether the student identified input, processing, and output.}',
  '\\score{3,response}',
  '3: Clearly describes all three stages.',
  '2: Describes most stages.',
  '1: Vague or incomplete plan.',
  '0: No usable plan.',
  '\\endscore',
  '\\endquestion',
  '',
  '\\question{Which expression correctly tests whether value is at least zero?}',
  '\\multiplechoice{}',
  '\\choice{value = 0}{0}',
  '\\choice{value >= 0}{2}',
  '\\choice{value ==> 0}{0}',
  '\\choice{value < 0}{0}',
  '\\endmultiplechoice',
  '\\feedbackprompt{Briefly explain why the selected comparison does or does not include zero.}',
  '\\endquestion',
  '\\endquestiongroup',
  '',
  '\\questiongroup{Build and test a component}',
  '\\pythondisplay',
  '# Example: a running total starts at zero',
  'total = 0',
  '\\endpythondisplay',
  '\\question{Write a function named add_valid that returns the sum of the non-negative values in a list. Run several tests before moving on.}',
  '\\python',
  'def add_valid(values):',
  '    # Replace this starter code.',
  '    return 0',
  '',
  'print(add_valid([4, -1, 6]))  # expected: 10',
  '\\endpython',
  '\\sampleresponses{A function that loops through values, adds non-negative ones, and returns the sum.}',
  '\\feedbackprompt{Check the submitted code for correct filtering, accumulation, and a useful test.}',
  '\\score{6,code}',
  '6: Correct component with a meaningful test.',
  '3-5: Mostly correct but has a minor logic or test gap.',
  '1-2: Some relevant code but does not solve the component.',
  '0: Missing or unrelated.',
  '\\endscore',
  '\\endquestion',
  '',
  '\\question{Record two test cases for your function: one ordinary case and one edge case. Explain the expected result for each.}',
  '\\table{Component test cases}',
  '\\row Test input & Expected result & Why this test matters',
  '\\row \\tresponse & \\tresponse & \\tresponse',
  '\\row \\tresponse & \\tresponse & \\tresponse',
  '\\endtable',
  '\\sampleresponses{Includes an ordinary list and an edge case such as an empty list or all negative values.}',
  '\\feedbackprompt{Assess whether the test cases are specific and include an edge case.}',
  '\\score{3,response}',
  '3: Two useful cases including an edge case.',
  '2: Two cases with limited explanation.',
  '1: One useful case.',
  '0: Missing.',
  '\\endscore',
  '\\endquestion',
  '\\endquestiongroup',
  '',
  '\\questiongroup{Files and larger-program options}',
  '\\file{numbers.txt,readonly}',
  '4',
  '-1',
  '6',
  '\\endfile',
  '\\file{notes.txt}',
  '# Keep design notes or test results here.',
  '\\endfile',
  '\\question{Use the supplied numbers.txt data (or your own list) to write a complete Python program that reports the total and average of valid values.}',
  '\\pythonremote',
  '# You may read numbers.txt or use a list while developing.',
  '# Print both a total and an average for the valid values.',
  '\\endpythonremote',
  '\\sampleresponses{A complete program that reads or defines values, ignores negatives, and prints total and average.}',
  '\\feedbackprompt{Evaluate the complete solution, including handling of no valid values and evidence of testing.}',
  '\\score{10,code}',
  '10: Complete, correct, readable program with appropriate edge-case handling.',
  '7-9: Largely correct with a minor issue.',
  '3-6: Meaningful partial implementation.',
  '0-2: Minimal or missing implementation.',
  '\\endscore',
  '\\endquestion',
  '',
  '\\question{Optional extension: implement the same calculation in C++.}',
  '\\cpp',
  '#include <iostream>',
  'int main() {',
  '  // Optional extension.',
  '  return 0;',
  '}',
  '\\endcpp',
  '\\sampleresponses{A C++ implementation that computes and prints the requested result.}',
  '\\feedbackprompt{Award credit only for a working, tested C++ extension.}',
  '\\score{2,code}',
  '2: Working extension.',
  '1: Meaningful start.',
  '0: Not attempted or incorrect.',
  '\\endscore',
  '\\endquestion',
  '',
  '\\question{Optional visual extension: use Python Turtle to draw one square for each valid value.}',
  '\\pythonturtle{600x300}',
  'import turtle',
  '',
  '# Optional extension: draw a square for each valid value.',
  '\\endpythonturtle',
  '\\sampleresponses{A turtle program that uses a loop and produces a visible drawing.}',
  '\\feedbackprompt{Award credit for a working turtle extension that meaningfully uses the lab data or logic.}',
  '\\score{2,code}',
  '2: Working, meaningful extension.',
  '1: Meaningful start.',
  '0: Not attempted or incorrect.',
  '\\endscore',
  '\\endquestion',
  '\\endquestiongroup',
  '',
  '\\questiongroup{Reflection and final submission}',
  '\\ai{critique}',
  '\\aititle{Lab Coach}',
  '\\aiprompt{Ask for help evaluating a test case or explaining a bug you found.}',
  '\\aiguardrail{Coach the student through debugging and testing without providing the final program.}',
  '\\aicontext{nearby-text}',
  '\\aiinput{4}',
  '\\endai',
  '',
  '\\question{What test result gave you the most useful information while building this program, and what did you change because of it?}',
  '\\textresponse{5}',
  '\\sampleresponses{Names a concrete test, result, and revision or confirmation.}',
  '\\feedbackprompt{Give concise feedback on the student reflection and use of testing evidence.}',
  '\\score{3,response}',
  '3: Specific evidence and clear reflection.',
  '2: Some evidence but limited detail.',
  '1: General reflection only.',
  '0: Missing.',
  '\\endscore',
  '\\endquestion',
  '\\endquestiongroup',
].join('\n');

function getQuestionSource(sourceText, block) {
  const sourceMeta = block?.sourceMeta;
  if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return '';
  return String(sourceText || '')
    .split('\n')
    .slice(sourceMeta.questionLine - 1, sourceMeta.endQuestionLine)
    .join('\n');
}

function getQuestionCodeBlock(sourceText, block, requestedType = '') {
  const sourceMeta = block?.sourceMeta;
  if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return null;
  const lines = String(sourceText || '').split('\n');
  const startIndex = sourceMeta.questionLine - 1;
  const endIndex = sourceMeta.endQuestionLine - 1;
  const openingPatterns = [
    ['pythonremote', /^\\pythonremote(?:\{[^}]*\})?\s*$/i, '\\endpythonremote', 'Python Remote'],
    ['pythonturtle', /^\\pythonturtle(?:\{[^}]*\})?\s*$/i, '\\endpythonturtle', 'Python Turtle'],
    ['python', /^\\python(?:\{[^}]*\})?\s*$/i, '\\endpython', 'Python'],
    ['cpp', /^\\cpp(?:\{[^}]*\})?\s*$/i, '\\endcpp', 'C++'],
  ];

  for (let index = startIndex; index <= endIndex; index += 1) {
    const line = lines[index]?.trim();
    const match = openingPatterns.find(([, pattern]) => pattern.test(line));
    if (!match || (requestedType && match[0] !== requestedType)) continue;
    const [type, , closingTag, label] = match;
    const closeIndex = lines.findIndex((candidate, candidateIndex) => (
      candidateIndex > index && candidateIndex <= endIndex && candidate.trim() === closingTag
    ));
    if (closeIndex === -1) return null;
    return {
      type,
      label,
      openLine: index + 1,
      closeLine: closeIndex + 1,
      content: lines.slice(index + 1, closeIndex).join('\n'),
    };
  }
  return null;
}

export default function CreatorWorkbenchPage() {
  const { classId, activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useUser();
  const isDemoCreator = new URLSearchParams(location.search).get('demo') === '1';
  const isBlankCreate = new URLSearchParams(location.search).get('blank') === '1';

  const [classInfo, setClassInfo] = useState(null);
  const [activity, setActivity] = useState(null);
  const [draft, setDraft] = useState(() => cloneEmptyDraft({
    duration_minutes: isDemoCreator ? '10' : emptyDraft.duration_minutes,
    selected_model: isDemoCreator ? 'gpt-5-mini' : emptyDraft.selected_model,
  }));
  const [advancedDraft, setAdvancedDraft] = useState(() => cloneEmptyAdvancedDraft());
  const [rawText, setRawText] = useState('');
  const declaredSourceMode = useMemo(() => {
    const match = String(rawText || '').match(/^\s*\\mode\{([^}]+)\}/mi);
    return match ? String(match[1] || '').trim().toLowerCase() : '';
  }, [rawText]);
  const normalizedDraftMode = declaredSourceMode || String(draft.mode || '').trim().toLowerCase();
  const isTestDraft = normalizedDraftMode === 'test';
  const isAssignmentDraft = normalizedDraftMode === 'assignment';
  const isSectionlessDraft = normalizedDraftMode === 'test' || normalizedDraftMode === 'assignment';
  const currentModeLabel = isAssignmentDraft
    ? 'Lab Assignment'
    : isTestDraft
      ? 'Test'
      : normalizedDraftMode === 'playground'
        ? 'Playground'
        : normalizedDraftMode === 'demo'
          ? 'Demo'
          : 'Group Activity';
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
  const [questionGroupInspectorDraft, setQuestionGroupInspectorDraft] = useState(null);
  const [insertTarget, setInsertTarget] = useState(null);
  const [questionRevisionRequest, setQuestionRevisionRequest] = useState('');
  const [questionRevisionBusy, setQuestionRevisionBusy] = useState(false);
  const [questionRevisionProposal, setQuestionRevisionProposal] = useState(null);
  const [starterCodeDraft, setStarterCodeDraft] = useState('');
  const [aiInspectorDraft, setAiInspectorDraft] = useState(null);
  const [showPreviewInspector, setShowPreviewInspector] = useState(true);
  const [showIssuesModal, setShowIssuesModal] = useState(false);
  const [showRemoteSync, setShowRemoteSync] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState('');
  const [visualUndoStack, setVisualUndoStack] = useState([]);
  const [savedSourceText, setSavedSourceText] = useState('');
  const [savedSourceRevision, setSavedSourceRevision] = useState(null);
  const [pendingNavigation, setPendingNavigation] = useState(null);

  const autoTimerRef = useRef(null);
  const sourceTextareaRef = useRef(null);
  const sourceGutterRef = useRef(null);
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
  const sourceLineCount = useMemo(
    () => Math.max(1, String(activeText || '').split('\n').length),
    [activeText],
  );
  const hasProposalErrors = !!proposal?.issues?.some((issue) => issue.severity === 'error');
  const markupValidation = useMemo(() => validateActivityMarkup(rawText), [rawText]);
  const hasMarkupErrors = !markupValidation.valid;
  const firstMarkupError = markupValidation.issues[0] || null;
  const hasUnsavedChanges = !!activity?.id && rawText !== savedSourceText;
  const advancedPromptText = useMemo(() => buildAdvancedPromptText(advancedDraft), [advancedDraft]);
  const multipleChoiceValidation = useMemo(() => {
    if (!questionInspectorDraft?.multipleChoiceEnabled) return { errors: [] };
    return validateMultipleChoice(
      questionInspectorDraft.multipleChoiceSelectionMode === 'multiple' ? '' : questionInspectorDraft.multipleChoiceAnswer,
      questionInspectorDraft.multipleChoiceChoices,
    );
  }, [questionInspectorDraft]);

  const updateFileContents = useCallback((updaterFn) => {
    setFileContents((prev) => updaterFn(prev));
  }, []);

  const creatorModelChoices = useMemo(() => (
    isDemoCreator
      ? creatorModelOptions.filter((option) => ['gpt-5-mini', 'gpt-4o-mini'].includes(option.value))
      : creatorModelOptions
  ), [isDemoCreator]);

  useEffect(() => {
    if (sourceGutterRef.current && sourceTextareaRef.current) {
      sourceGutterRef.current.scrollTop = sourceTextareaRef.current.scrollTop;
    }
  }, [activeText, rightMode]);

  function selectInsertedQuestion(parsed, questionLine) {
    const inserted = parsed.blocks.find((block) => (
      block?.type === 'question' && block?.sourceMeta?.questionLine === questionLine
    ));
    setSelectedPreviewKey(inserted?.previewKey || '');
  }

  function selectMovedQuestion(parsed, questionLine) {
    const moved = parsed.blocks.find((block) => (
      block?.type === 'question' && block?.sourceMeta?.questionLine === questionLine
    ));
    setSelectedPreviewKey(moved?.previewKey || '');
  }

  function selectMovedQuestionGroup(parsed, groupLine) {
    const moved = parsed.blocks.find((block) => (
      block?.type === 'groupIntro' && block?.sourceMeta?.groupLine === groupLine
    ));
    setSelectedPreviewKey(moved?.previewKey || '');
  }

  function recordVisualEdit(label) {
    setVisualUndoStack((previous) => ([
      ...previous,
      { sourceText: rawText, label },
    ].slice(-40)));
  }

  function insertStarterQuestion(block, placement, questionType = 'written') {
    const sourceMeta = block?.sourceMeta;
    if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return;

    const lines = String(rawText || '').split('\n');
    const insertionIndex = placement === 'before'
      ? sourceMeta.questionLine - 1
      : sourceMeta.endQuestionLine;
    const nextText = [...lines];
    nextText.splice(insertionIndex, 0, ...getStarterQuestionLines(questionType));
    const nextSource = nextText.join('\n');
    const parsed = compileText(nextSource);

    recordVisualEdit('adding a question');
    setRawText(nextSource);
    setSandboxUrl('');
    selectInsertedQuestion(parsed, insertionIndex + 1);
    setNotice('Added a new question. Use the Question Panel to edit it.');
    setTimeout(() => setNotice(''), 2400);
  }

  function insertStarterQuestionGroup(block, placement, questionType = 'written') {
    const sourceMeta = block?.sourceMeta;
    const groupLine = sourceMeta?.groupLine;
    const endGroupLine = sourceMeta?.endGroupLine;
    const insertionIndex = placement === 'before'
      ? groupLine - 1
      : endGroupLine;

    if (!Number.isFinite(insertionIndex) || insertionIndex < 0) return;

    const lines = String(rawText || '').split('\n');
    const nextText = [...lines];
    nextText.splice(
      insertionIndex,
      0,
      '\\questiongroup{New Question Group}',
      ...getStarterQuestionLines(questionType),
      '\\endquestiongroup'
    );
    const nextSource = nextText.join('\n');
    const parsed = compileText(nextSource);

    recordVisualEdit('adding a question group');
    setRawText(nextSource);
    setSandboxUrl('');
    selectInsertedQuestion(parsed, insertionIndex + 2);
    setNotice('Added a new question group. Use the Question Panel to edit its starter question.');
    setTimeout(() => setNotice(''), 2400);
  }

  function persistVisualCodeChange(_responseKey, code, meta = {}) {
    if (meta.__broadcastOnly || proposal) return;
    const sourceRef = meta.creatorSource;
    const codeBlock = getQuestionCodeBlock(rawText, sourceRef?.questionBlock, sourceRef?.codeType);
    if (!codeBlock) return;

    const lines = String(rawText || '').split('\n');
    lines.splice(
      codeBlock.openLine,
      codeBlock.closeLine - codeBlock.openLine - 1,
      ...String(code || '').split('\n')
    );
    const nextText = lines.join('\n');
    recordVisualEdit(`updating ${codeBlock.label} starter code`);
    setRawText(nextText);
    setStarterCodeDraft(String(code || ''));
    compileText(nextText);
    setNotice(`${codeBlock.label} starter code updated.`);
    setTimeout(() => setNotice(''), 1800);
  }

  function renderInsertionMarker(key, label, target) {
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
            setInsertTarget(target);
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
    onCodeChange: persistVisualCodeChange,
    selectedPreviewKey,
    renderInsertBeforeQuestion: proposal ? null : (block) => renderInsertionMarker(
      `before-question-${block.previewKey}`,
      'Add question before',
      { kind: 'question', block, placement: 'before' }
    ),
    renderInsertAfterQuestion: proposal ? null : (block) => renderInsertionMarker(
      `after-question-${block.previewKey}`,
      'Add question after',
      { kind: 'question', block, placement: 'after' }
    ),
    renderInsertBeforeGroup: proposal ? null : (block) => renderInsertionMarker(
      `before-group-${block.groupId}`,
      'Add question group before',
      { kind: 'group', block, placement: 'before' }
    ),
    renderInsertAfterGroup: proposal ? null : (block) => renderInsertionMarker(
      `after-group-${block.groupId}`,
      'Add question group after',
      { kind: 'group', block, placement: 'after' }
    ),
  }), [activeBlocks, fileContents, proposal, selectedPreviewKey, updateFileContents, infoBubbleSessionRef, runtimeFeatures, insertStarterQuestion, insertStarterQuestionGroup]);

  const selectedPreviewBlock = useMemo(() => (
    findSelectableBlockByPreviewKey(activeBlocks, selectedPreviewKey)
  ), [activeBlocks, selectedPreviewKey]);

  const selectedQuestionBlock = selectedPreviewBlock?.type === 'question' ? selectedPreviewBlock : null;
  const selectedQuestionCodeBlock = useMemo(() => (
    getQuestionCodeBlock(rawText, selectedQuestionBlock)
  ), [rawText, selectedQuestionBlock]);
  const selectedQuestionGroupBlock = selectedPreviewBlock?.type === 'groupIntro' ? selectedPreviewBlock : null;
  const selectedAiBlock = selectedPreviewBlock?.type === 'ai' ? selectedPreviewBlock : null;
  const selectedQuestionMoveState = useMemo(() => {
    if (!selectedQuestionBlock) return { index: -1, questions: [] };
    const questions = blocks
      .filter((block) => block?.type === 'question' && block?.groupId === selectedQuestionBlock.groupId)
      .sort((left, right) => left.sourceMeta.questionLine - right.sourceMeta.questionLine);
    return { index: questions.indexOf(selectedQuestionBlock), questions };
  }, [blocks, selectedQuestionBlock]);
  const selectedGroupMoveState = useMemo(() => {
    if (!selectedQuestionGroupBlock) return { index: -1, groups: [] };
    const selectedSection = getSectionKeyAtLine(rawText, selectedQuestionGroupBlock.sourceMeta?.groupLine);
    const groups = blocks
      .filter((block) => block?.type === 'groupIntro'
        && getSectionKeyAtLine(rawText, block.sourceMeta?.groupLine) === selectedSection)
      .sort((left, right) => left.sourceMeta.groupLine - right.sourceMeta.groupLine);
    return { index: groups.indexOf(selectedQuestionGroupBlock), groups };
  }, [blocks, rawText, selectedQuestionGroupBlock]);
  const proposedQuestionPreview = useMemo(() => {
    const markup = questionRevisionProposal?.proposedMarkup;
    if (!markup) return null;

    // Questions are only valid inside a group in the activity markup. Wrap the
    // proposal for parsing, then render just the question in this read-only preview.
    const parsed = parseActivityText([
      '\\questiongroup{Proposed question preview}',
      markup,
      '\\endquestiongroup',
    ].join('\n'));
    const questionBlocks = parsed.blocks.filter((block) => block?.type === 'question');
    return renderBlocks(questionBlocks, {
      mode: 'preview',
      editable: false,
      isInstructor: true,
      fileContents: parsed.files,
      runtimeFeatures,
    });
  }, [questionRevisionProposal?.proposedMarkup, runtimeFeatures]);

  const canManage = user?.role === 'root' || user?.role === 'creator';

  useEffect(() => {
    if (isDemoCreator && !['gpt-5-mini', 'gpt-4o-mini'].includes(draft.selected_model)) {
      setDraft((prev) => ({
        ...prev,
        selected_model: 'gpt-5-mini',
      }));
    }
  }, [draft.selected_model, isDemoCreator]);

  useEffect(() => {
    if (isTestDraft && rightMode === 'sandbox') {
      setRightMode('preview');
    } else if (!isTestDraft && rightMode === 'test-run') {
      setRightMode('preview');
    }
  }, [isTestDraft, rightMode]);

  const compileText = useCallback((sourceText) => {
    const parsed = parseActivityText(sourceText);
    setBlocks(parsed.blocks);
    setParseIssues(parsed.issues);
    setFileContents(parsed.files);
    return parsed;
  }, []);

  const undoVisualEdit = () => {
    const previousEdit = visualUndoStack.at(-1);
    if (!previousEdit || proposal) return;

    const parsed = compileText(previousEdit.sourceText);
    setRawText(previousEdit.sourceText);
    setSandboxUrl('');
    setSelectedPreviewKey('');
    setQuestionRevisionProposal(null);
    setVisualUndoStack((previous) => previous.slice(0, -1));
    setNotice(`Undid ${previousEdit.label}.`);
    setTimeout(() => setNotice(''), 1800);
    return parsed;
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

        setActivity({
          ...activityData,
          source_updated_at: sourceData?.metadata?.source_updated_at
            ?? sourceData?.source_updated_at
            ?? activityData?.source_updated_at
            ?? null,
          source_revision: sourceData?.metadata?.source_revision
            ?? activityData?.source_revision
            ?? 0,
        });
        setDraft((previous) => ({
          ...previous,
          title: activityData?.title || previous.title,
          mode: String(activityData?.mode || activityData?.activity_type || previous.mode || 'group').trim().toLowerCase(),
        }));
        setRawText(text);
        setSavedSourceText(text);
        setSavedSourceRevision(Number(sourceData?.metadata?.source_revision ?? activityData?.source_revision ?? 0));
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
    if (!hasUnsavedChanges) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!activity?.id || proposal) return;
    if (rightMode !== 'preview') return;
    if (isBlankCreate || !String(rawText || '').trim()) {
      setRightMode('edit');
    }
  }, [activity?.id, isBlankCreate, proposal, rawText, rightMode]);

  useEffect(() => {
    if (!selectedQuestionBlock) {
      setQuestionInspectorDraft(null);
    } else {
      setShowPreviewInspector(true);
      setQuestionInspectorDraft(buildQuestionInspectorDraft(selectedQuestionBlock));
      setStarterCodeDraft(getQuestionCodeBlock(rawText, selectedQuestionBlock)?.content || '');
    }
  }, [rawText, selectedQuestionBlock]);

  useEffect(() => {
    if (!selectedQuestionGroupBlock) {
      setQuestionGroupInspectorDraft(null);
    } else {
      setShowPreviewInspector(true);
      setQuestionGroupInspectorDraft(buildQuestionGroupInspectorDraft(selectedQuestionGroupBlock, rawText));
    }
  }, [rawText, selectedQuestionGroupBlock]);

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
        const nextMode = String(value || '').trim().toLowerCase();
        const nextIsSectionless = nextMode === 'test' || nextMode === 'assignment';
        return {
          ...prev,
          mode: nextMode,
          major_sections: nextIsSectionless ? [] : [...majorSectionOptions],
        };
      }
      return { ...prev, [field]: value };
    });

    if (field === 'duration_minutes' || field === 'mode') {
      setAdvancedDraft((prev) => {
        if (field === 'mode' && (String(value || '').trim().toLowerCase() === 'test' || String(value || '').trim().toLowerCase() === 'assignment')) {
          return {
            ...prev,
            include_timing: false,
          };
        }
        return prev.include_timing
          ? {
            ...prev,
            timed_section_minutes: allocateTimedSectionMinutes(
              field === 'mode' ? majorSectionOptions : draft.major_sections,
              field === 'duration_minutes' ? value : draft.duration_minutes
            ),
          }
          : prev;
      });
    }
  };

  const toggleMajorSection = (sectionName) => {
    if (isSectionlessDraft) return;
    const selected = new Set(draft.major_sections || []);
    if (selected.has(sectionName)) selected.delete(sectionName);
    else selected.add(sectionName);
    const majorSections = majorSectionOptions.filter((option) => selected.has(option));

    setDraft((prev) => {
      return {
        ...prev,
        major_sections: majorSections,
      };
    });
    setAdvancedDraft((prev) => prev.include_timing
      ? {
        ...prev,
        timed_section_minutes: allocateTimedSectionMinutes(majorSections, draft.duration_minutes),
      }
      : prev);
  };

  const createDraft = async ({ useLabBoilerplate = false } = {}) => {
    setNotice('');
    setError('');

    const draftTitle = draft.title.trim() || (useLabBoilerplate ? 'Programming Lab Boilerplate' : '');
    const draftDescription = draft.description.trim() || (useLabBoilerplate
      ? 'A comprehensive programming lab example with milestones, code, files, tests, feedback, and final submission.'
      : '');

    if (!draftTitle || !draftDescription) {
      setError('Enter a title and creator brief.');
      return;
    }

    const durationMinutes = parseInt(draft.duration_minutes, 10);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError('Enter a valid duration.');
      return;
    }

    if (!isSectionlessDraft && !draft.major_sections?.length) {
      setError('Select at least one section.');
      return;
    }

    const retriesRequired = parseInt(advancedDraft.submit_retries, 10);
    if (!Number.isFinite(retriesRequired) || retriesRequired < 0) {
      setError('Enter zero or more submit retries.');
      return;
    }

    const useTimedSections = isSectionlessDraft ? false : advancedDraft.include_timing;
    const timedSections = useTimedSections
      ? draft.major_sections.map((title) => ({
        title,
        minutes: parseInt(advancedDraft.timed_section_minutes?.[title], 10),
      }))
      : [];
    if (useTimedSections) {
      if (durationMinutes < timedSections.length) {
        setError('The activity duration must allow at least one minute for each timed section.');
        return;
      }
      if (timedSections.some((section) => !Number.isFinite(section.minutes) || section.minutes <= 0)) {
        setError('Give every selected timed section a positive whole number of minutes.');
        return;
      }
      const totalTimedMinutes = timedSections.reduce((total, section) => total + section.minutes, 0);
      if (totalTimedMinutes !== durationMinutes) {
        setError(`Section timers total ${totalTimedMinutes} minutes; they must equal the activity duration of ${durationMinutes} minutes.`);
        return;
      }
    }

    setCreateBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/creator-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title: draftTitle,
          duration_minutes: durationMinutes,
          mode: draft.mode,
          selected_model: draft.selected_model,
          major_sections: isSectionlessDraft ? [] : draft.major_sections,
          use_timed_sections: useTimedSections,
          timed_sections: isSectionlessDraft ? [] : timedSections,
          retries_required: retriesRequired,
          language: markupHeaderValue(advancedDraft.language) || 'English',
          description: appendAdvancedPrompt(draftDescription, advancedPromptText),
          createdBy: user?.id,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Failed to create draft.');

      // The language setting is activity metadata, not merely a generation
      // instruction.  Preserve it in the source even if a model or an older
      // server response supplies a different (usually English) header.
      const selectedLanguage = markupHeaderValue(advancedDraft.language) || 'English';
      const generatedSourceText = data.content_text || '';
      let sourceText = useLabBoilerplate
        ? upsertLanguageHeader(labBoilerplateSource, selectedLanguage)
        : upsertLanguageHeader(generatedSourceText, selectedLanguage);
      if (useLabBoilerplate || sourceText !== generatedSourceText) {
        const sourceRes = await fetch(`${API_BASE_URL}/api/activities/${data.id}/source`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ text: sourceText, expected_revision: 0 }),
        });
        const sourceData = await sourceRes.json().catch(() => ({}));
        if (!sourceRes.ok) throw new Error(sourceData?.error || 'The draft was created, but its selected language could not be saved.');
        data.source_updated_at = sourceData?.metadata?.source_updated_at
          ?? sourceData?.source_updated_at
          ?? data.source_updated_at
          ?? null;
        data.source_revision = sourceData?.metadata?.source_revision
          ?? sourceData?.source_revision
          ?? data.source_revision
          ?? 0;
      }

      setActivity({ ...data, content_text: sourceText });
      if (useLabBoilerplate) {
        setDraft((previous) => ({ ...previous, title: draftTitle, description: draftDescription }));
      }
      setRawText(sourceText);
      setSavedSourceText(sourceText);
      setSavedSourceRevision(Number(data.source_revision ?? 0));
      compileText(sourceText);
      setMessages([{ role: 'assistant', text: useLabBoilerplate ? 'Lab boilerplate created.' : 'Draft created.' }]);
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

  const createBlankActivity = async () => {
    setNotice('');
    setError('');

    const title = markupHeaderValue(draft.title);
    if (!title) {
      setError('Enter a title before creating a blank activity.');
      return;
    }

    const mode = String(draft.mode || 'group').trim().toLowerCase() || 'group';
    const baseName = slugifyActivityName(title) || 'untitled_activity';
    const name = `${baseName}_${Date.now().toString(36)}`;
    const sourceText = [
      `\\title{${title}}`,
      `\\name{${name}}`,
      `\\mode{${mode}}`,
      `\\language{${markupHeaderValue(advancedDraft.language) || 'English'}}`,
      '',
      '% Paste or write your activity markup below.',
      '',
    ].join('\n');

    setCreateBusy(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          title,
          source_type: 'local',
          content_text: sourceText,
          order_index: 0,
          createdBy: user?.id,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) throw new Error(data?.error || 'Failed to create blank activity.');

      setActivity({ ...data, mode, content_text: sourceText });
      setRawText(sourceText);
      setSavedSourceText(sourceText);
      setSavedSourceRevision(Number(data.source_revision ?? 0));
      compileText(sourceText);
      setMessages([{ role: 'assistant', text: 'Blank activity created without AI generation.' }]);
      setRightMode('edit');
      setNotice('Blank activity created. Paste your markup into Source, then click Save.');
      navigate(`/creator/${data.id}?blank=1`, { replace: true });
    } catch (err) {
      console.error('Blank activity creation failed:', err);
      setError(err?.message || String(err));
    } finally {
      setCreateBusy(false);
    }
  };

  const loadLabBoilerplate = () => {
    if (proposal) return;
    recordVisualEdit('loading lab boilerplate');
    setRawText(labBoilerplateSource);
    compileText(labBoilerplateSource);
    setSandboxUrl('');
    setRightMode('preview');
    setNotice('Lab boilerplate loaded. Review it, then click Save to replace this draft.');
  };

  const saveSource = async (sourceText = rawText) => {
    if (!activity?.id) throw new Error('Create a draft before saving.');
    const validation = validateActivityMarkup(sourceText);
    if (!validation.valid) {
      const first = validation.issues[0];
      throw new Error(`Fix the markup before saving: line ${first.line}: ${first.message}`);
    }
    setSaveBusy(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/source`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: sourceText,
          expected_revision: Number.isInteger(savedSourceRevision) ? savedSourceRevision : 0,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        const currentRevision = data?.current_revision;
        throw new Error(
          `This activity was saved elsewhere${Number.isInteger(currentRevision) ? ` as revision ${currentRevision}` : ''}. `
          + 'Your unsaved changes are still in this browser. Copy them, then reload the activity before trying again.'
        );
      }
      if (!res.ok) throw new Error(data?.error || `Save failed ${res.status}`);
      setActivity((prev) => ({
        ...(prev || {}),
        title: data?.title || prev?.title,
        content_text: sourceText,
        source_updated_at: data?.metadata?.source_updated_at
          ?? data?.source_updated_at
          ?? prev?.source_updated_at
          ?? null,
        source_revision: data?.metadata?.source_revision
          ?? data?.source_revision
          ?? prev?.source_revision
          ?? 0,
        source_origin: data?.metadata?.source_origin
          ?? data?.source_origin
          ?? prev?.source_origin
          ?? null,
        last_synced_at: data?.metadata?.last_synced_at
          ?? prev?.last_synced_at
          ?? null,
      }));
      setSavedSourceText(sourceText);
      setSavedSourceRevision(Number(data?.metadata?.source_revision ?? data?.source_revision ?? savedSourceRevision ?? 0));
      setNotice(activity?.sheet_url
        ? 'Saved locally. Open Remote Copy to publish this version to Google.'
        : 'Saved.');
      setTimeout(() => setNotice(''), 1800);
      return data;
    } finally {
      setSaveBusy(false);
    }
  };

  const loadRemoteStatus = async () => {
    if (!activity?.id) return;
    setRemoteBusy(true);
    setRemoteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/remote-status`, {
        credentials: 'include',
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Could not check the linked Google Doc.');
      setRemoteStatus(data);
    } catch (err) {
      setRemoteStatus(null);
      setRemoteError(err?.message || String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  const openRemoteSync = () => {
    setShowRemoteSync(true);
    loadRemoteStatus();
  };

  const copyLocalSource = async () => {
    try {
      // Sync status is calculated from the saved database copy, so publish the
      // same version rather than unsaved text still sitting in the editor.
      const savedLocalText = activity?.content_text ?? rawText;
      await navigator.clipboard.writeText(savedLocalText);
      setNotice('Local markup copied. Paste it into the Google Doc.');
      setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setRemoteError('Your browser did not allow copying. Select the Source tab and copy the markup manually.');
    }
  };

  const openRemoteDocument = () => {
    const url = remoteStatus?.remote?.url || activity?.sheet_url;
    if (!url) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const importRemoteSource = async () => {
    if (!activity?.id) return;
    if (!window.confirm('Replace the local activity markup with the current Google Doc text? This cannot be undone from this dialog.')) return;
    setRemoteBusy(true);
    setRemoteError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/activities/${activity.id}/import-remote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          expected_revision: Number.isInteger(savedSourceRevision) ? savedSourceRevision : 0,
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Could not import the linked Google Doc.');
      setRawText(data.text || '');
      setSavedSourceText(data.text || '');
      setSavedSourceRevision(Number(data.source_revision ?? savedSourceRevision ?? 0));
      compileText(data.text || '');
      setActivity((prev) => ({
        ...(prev || {}),
        title: data.title || prev?.title,
        content_text: data.text || '',
        source_type: 'local',
        source_updated_at: data.source_updated_at || prev?.source_updated_at || null,
        source_revision: data.source_revision ?? prev?.source_revision ?? 0,
        source_origin: data.source_origin || 'google_import',
        last_synced_at: data.last_synced_at || prev?.last_synced_at || null,
      }));
      setNotice('Imported the current Google Doc into the local activity.');
      setTimeout(() => setNotice(''), 3000);
      await loadRemoteStatus();
    } catch (err) {
      setRemoteError(err?.message || String(err));
    } finally {
      setRemoteBusy(false);
    }
  };

  const requestRevision = async (requestOverride = null) => {
    const isAdvancedOnlyRequest = typeof requestOverride === 'string';
    const requestText = String(isAdvancedOnlyRequest ? requestOverride : revisionRequest).trim();
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
    if (!isAdvancedOnlyRequest) setRevisionRequest('');

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

      const revisionText = data.proposedDocText || data.proposed_doc_text || '';
      const proposedText = isAdvancedOnlyRequest
        ? upsertLanguageHeader(revisionText, advancedDraft.language)
        : revisionText;
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

  const openCreatorTestRun = async () => {
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
      if (!res.ok || !data.instanceId) throw new Error(data?.error || 'Failed to open test run.');
      setSandboxUrl(`${window.location.origin}/run/${data.instanceId}?mode=creator_test&embed=1&t=${Date.now()}`);
      setRightMode('test-run');
    } catch (err) {
      console.error('Open creator test run failed:', err);
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
    if (mode === 'test-run') {
      openCreatorTestRun();
      return;
    }
    setRightMode(mode);
  };

  const applyVisualSource = (nextText, label) => {
    const validation = validateActivityMarkup(nextText);
    if (!validation.valid) {
      const first = validation.issues[0];
      setError(`Try Changes was not applied. Line ${first.line}: ${first.message}`);
      return rawText;
    }
    if (nextText !== rawText) {
      recordVisualEdit(label);
      setRawText(nextText);
      setSandboxUrl('');
      compileText(nextText);
    }
    return nextText;
  };

  const buildQuestionInspectorSource = () => {
    if (!selectedQuestionBlock || !questionInspectorDraft) return rawText;
    return serializeQuestionComponent(
      rawText,
      selectedQuestionBlock,
      questionInspectorDraft,
      selectedQuestionCodeBlock,
      starterCodeDraft,
    );
  };

  const applyQuestionInspectorChanges = () => {
    if (!selectedQuestionBlock || !questionInspectorDraft || proposal) return null;
    if (multipleChoiceValidation.errors.length) return null;
    return applyVisualSource(buildQuestionInspectorSource(), 'updating question settings');
  };

  const applyStarterCodeChanges = () => {
    if (!selectedQuestionCodeBlock || !selectedQuestionBlock || proposal) return null;
    const nextText = serializeQuestionComponent(
      rawText,
      selectedQuestionBlock,
      questionInspectorDraft || buildQuestionInspectorDraft(selectedQuestionBlock),
      selectedQuestionCodeBlock,
      starterCodeDraft,
    );
    return applyVisualSource(nextText, `updating ${selectedQuestionCodeBlock.label} starter code`);
  };

  const removeResponseLines = () => {
    if (!selectedQuestionBlock || !questionInspectorDraft || proposal) return;
    const nextText = serializeQuestionComponent(rawText, selectedQuestionBlock, {
      ...questionInspectorDraft,
      responseLines: '',
    }, selectedQuestionCodeBlock, starterCodeDraft);
    if (nextText === rawText) return;
    const appliedText = applyVisualSource(nextText, 'removing response lines');
    if (appliedText === rawText) return;
    setQuestionInspectorDraft((prev) => ({ ...(prev || {}), responseLines: '' }));
    setNotice('Removed written response lines from this question.');
    setTimeout(() => setNotice(''), 1800);
  };

  const requestQuestionRevision = async () => {
    const revisionRequest = questionRevisionRequest.trim();
    const questionMarkup = getQuestionSource(rawText, selectedQuestionBlock);
    if (!revisionRequest || !questionMarkup || !activity?.id || !effectiveClassId || proposal) return;

    setQuestionRevisionBusy(true);
    setQuestionRevisionProposal(null);
    setError('');
    try {
      const group = blocks.find((block) => (
        block?.type === 'groupIntro' && block?.groupId === selectedQuestionBlock.groupId
      ));
      const res = await fetch(`${API_BASE_URL}/api/classes/${effectiveClassId}/creator-draft/${activity.id}/revise-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          request: questionRevisionRequest,
          question_markup: questionMarkup,
          selected_model: draft.selected_model,
          group_title: htmlToEditorText(group?.content || ''),
        }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(data?.error || 'Question revision failed.');

      const proposedMarkup = String(data?.proposedQuestionMarkup || data?.proposed_question_markup || '').trim();
      if (!proposedMarkup) throw new Error('Question revision returned an empty proposal.');
      setQuestionRevisionProposal({
        currentMarkup: questionMarkup,
        proposedMarkup,
        summary: Array.isArray(data?.summary) ? data.summary : [],
        warnings: Array.isArray(data?.warnings) ? data.warnings : [],
        generationStatus: String(data?.generation_status || 'unknown'),
        generationError: String(data?.generation_error || '').trim(),
      });
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setQuestionRevisionBusy(false);
    }
  };

  const applyQuestionRevision = () => {
    if (!selectedQuestionBlock || !questionRevisionProposal?.proposedMarkup || proposal) return;
    const sourceMeta = selectedQuestionBlock.sourceMeta;
    if (!sourceMeta?.questionLine || !sourceMeta?.endQuestionLine) return;

    const lines = String(rawText || '').split('\n');
    const proposedLines = questionRevisionProposal.proposedMarkup.split('\n');
    lines.splice(sourceMeta.questionLine - 1, sourceMeta.endQuestionLine - sourceMeta.questionLine + 1, ...proposedLines);
    const nextText = lines.join('\n');
    const appliedText = applyVisualSource(nextText, 'applying an AI question revision');
    if (appliedText === rawText) return;
    const parsed = parseActivityText(appliedText);
    selectInsertedQuestion(parsed, sourceMeta.questionLine);
    setQuestionRevisionProposal(null);
    setQuestionRevisionRequest('');
    setNotice('Applied AI revision to this question.');
    setTimeout(() => setNotice(''), 2400);
  };

  const applyQuestionGroupInspectorChanges = () => {
    if (!selectedQuestionGroupBlock || !questionGroupInspectorDraft || proposal) return null;
    const nextText = serializeQuestionGroupComponent(rawText, selectedQuestionGroupBlock, questionGroupInspectorDraft);
    return applyVisualSource(nextText, 'updating question group settings');
  };

  const applyAiInspectorChanges = () => {
    if (!selectedAiBlock || !aiInspectorDraft || proposal) return null;
    const nextText = serializeAiComponent(
      rawText,
      selectedAiBlock,
      aiInspectorDraft,
      INLINE_AI_DEFAULT_MODEL,
      INLINE_AI_MODEL_OPTIONS,
    );
    return applyVisualSource(nextText, 'updating AI block settings');
  };

  const trySelectedPanelChanges = () => {
    if (selectedQuestionBlock) return applyQuestionInspectorChanges();
    if (selectedQuestionGroupBlock) return applyQuestionGroupInspectorChanges();
    if (selectedAiBlock) return applyAiInspectorChanges();
    return null;
  };

  const hasPendingPanelChanges = (() => {
    if (proposal) return false;
    if (selectedQuestionBlock && questionInspectorDraft) {
      const initialDraft = buildQuestionInspectorDraft(selectedQuestionBlock);
      const questionFieldsChanged = JSON.stringify(questionInspectorDraft) !== JSON.stringify(initialDraft);
      const codeChanged = !!selectedQuestionCodeBlock
        && String(starterCodeDraft || '') !== String(selectedQuestionCodeBlock.content || '');
      return !multipleChoiceValidation.errors.length
        && (questionFieldsChanged || codeChanged);
    }
    if (selectedQuestionGroupBlock && questionGroupInspectorDraft) {
      return JSON.stringify(questionGroupInspectorDraft)
        !== JSON.stringify(buildQuestionGroupInspectorDraft(selectedQuestionGroupBlock, rawText));
    }
    if (selectedAiBlock && aiInspectorDraft) {
      return JSON.stringify(aiInspectorDraft) !== JSON.stringify(buildAiInspectorDraft(selectedAiBlock));
    }
    return false;
  })();

  const saveVisualEditorChanges = async () => {
    if (proposal) return;
    setError('');
    try {
      await saveSource(rawText);
    } catch (err) {
      setError(err?.message || String(err));
    }
  };

  const requestNavigation = (destination) => {
    if (hasUnsavedChanges) {
      setPendingNavigation(destination);
      return;
    }
    navigate(destination);
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
    recordVisualEdit('removing a question group');
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
    recordVisualEdit('removing a question');
    setRawText(nextText);
    setSandboxUrl('');
    setSelectedPreviewKey('');
    compileText(nextText);
    setNotice('Removed question.');
    setTimeout(() => setNotice(''), 2400);
  };

  const moveSelectedQuestion = (direction) => {
    if (!selectedQuestionBlock || proposal) return;
    const { index, questions } = selectedQuestionMoveState;
    const target = questions[index + direction];
    const sourceMeta = selectedQuestionBlock.sourceMeta;
    const targetMeta = target?.sourceMeta;
    if (!target || !sourceMeta?.questionLine || !sourceMeta?.endQuestionLine
      || !targetMeta?.questionLine || !targetMeta?.endQuestionLine) return;

    const nextText = swapSourceRanges(rawText,
      { startLine: sourceMeta.questionLine, endLine: sourceMeta.endQuestionLine },
      { startLine: targetMeta.questionLine, endLine: targetMeta.endQuestionLine },
    );
    if (nextText === rawText) return;

    const parsed = compileText(nextText);
    recordVisualEdit(`moving a question ${direction < 0 ? 'up' : 'down'}`);
    setRawText(nextText);
    setSandboxUrl('');
    selectMovedQuestion(parsed, targetMeta.questionLine);
    setNotice(`Moved question ${direction < 0 ? 'up' : 'down'}.`);
    setTimeout(() => setNotice(''), 1800);
  };

  const moveSelectedQuestionGroup = (direction) => {
    if (!selectedQuestionGroupBlock || proposal) return;
    const { index, groups } = selectedGroupMoveState;
    const target = groups[index + direction];
    const sourceMeta = selectedQuestionGroupBlock.sourceMeta;
    const targetMeta = target?.sourceMeta;
    if (!target || !sourceMeta?.groupLine || !sourceMeta?.endGroupLine
      || !targetMeta?.groupLine || !targetMeta?.endGroupLine) return;

    const nextText = swapSourceRanges(rawText,
      { startLine: sourceMeta.groupLine, endLine: sourceMeta.endGroupLine },
      { startLine: targetMeta.groupLine, endLine: targetMeta.endGroupLine },
    );
    if (nextText === rawText) return;

    const parsed = compileText(nextText);
    recordVisualEdit(`moving a question group ${direction < 0 ? 'up' : 'down'}`);
    setRawText(nextText);
    setSandboxUrl('');
    selectMovedQuestionGroup(parsed, targetMeta.groupLine);
    setNotice(`Moved question group ${direction < 0 ? 'up' : 'down'} within this section.`);
    setTimeout(() => setNotice(''), 1800);
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
          flex: 1 1 auto;
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
        .creator-source-editor-wrap {
          display: flex;
          width: 100%;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .creator-source-line-gutter {
          user-select: none;
          flex: 0 0 auto;
          padding: 0.5rem 0.5rem;
          background: #f3f3f3;
          border-right: 1px solid #ddd;
          color: #666;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
          font-size: 0.9rem;
          line-height: 1.4;
          text-align: right;
          overflow: hidden;
          min-width: 3.25rem;
        }
        .creator-source-line-gutter div {
          height: 1.4em;
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
          <h3 className="mb-0">{activity?.id ? `Edit: ${currentModeLabel}` : 'Create Activity'}</h3>
          <div className="text-muted small">
            {classInfo?.name || (effectiveClassId ? `Class ${effectiveClassId}` : 'New class activity')}
            {activity?.title ? ` · ${activity.title}` : ''}
            {activity?.source_updated_at
              ? ` · Activity version${activity?.source_revision ? ` ${activity.source_revision}` : ''}: ${formatLocalDateTime(activity.source_updated_at)}`
              : activity?.id ? ' · Activity version: not recorded yet' : ''}
          </div>
        </div>
        <Button
          ref={tutorialRefs.classLink}
          variant="outline-secondary"
          size="sm"
          onClick={() => requestNavigation(effectiveClassId ? `/class/${effectiveClassId}` : '/manage-classes')}
        >
          <ArrowLeft className="me-1" /> Class
        </Button>
      </div>

      {notice ? <Alert variant="info" className="py-2 mb-2">{notice}</Alert> : null}
      {error ? <Alert variant="danger" className="py-2 mb-2">{error}</Alert> : null}
      {activity?.id && (
        <Alert variant={isAssignmentDraft ? 'success' : isTestDraft ? 'warning' : 'secondary'} className="py-2 mb-2 d-flex align-items-center gap-2">
          <Badge bg={isAssignmentDraft ? 'success' : isTestDraft ? 'warning' : 'secondary'} text={isTestDraft ? 'dark' : undefined}>
            CURRENT MODE
          </Badge>
          <strong>{currentModeLabel}</strong>
          {isAssignmentDraft ? (
            <span className="small">All milestones are visible; students save drafts and submit the lab once at the end.</span>
          ) : null}
        </Alert>
      )}

      <div className="creator-shell">
        <section className="creator-left">
          <div className="creator-panel-header d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-2">
              <div className="fw-semibold"><ChatDots className="me-2" />AI Builder</div>
              <Button size="sm" variant="outline-secondary" onClick={() => setShowAdvanced(true)}>
                Advanced
              </Button>
            </div>
            {activity?.id ? (
              <div className="d-flex align-items-center gap-2">
                <Badge bg={isAssignmentDraft ? 'success' : isTestDraft ? 'warning' : 'secondary'} text={isTestDraft ? 'dark' : undefined}>
                  {currentModeLabel}
                </Badge>
                <Badge bg="light" text="dark" className="border">Draft #{activity.id}</Badge>
              </div>
            ) : <Badge bg="secondary">Setup</Badge>}
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
                        <option value="playground">Playground</option>
                        <option value="demo">Demo</option>
                        <option value="test">Test</option>
                        <option value="assignment">Assignment</option>
                      </Form.Select>
                      <div className="text-muted small mt-1">
                        Assignment mode is for project-style labs and does not require section structure.
                      </div>
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

                {!isSectionlessDraft ? (
                  <>
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

                    <div className="border rounded p-2 mb-3">
                      <Form.Check
                        type="checkbox"
                        id="creator-add-section-timers"
                        label="Add timers to sections"
                        checked={advancedDraft.include_timing}
                        onChange={(event) => setAdvancedDraft((prev) => ({
                          ...prev,
                          include_timing: event.target.checked,
                          timed_section_minutes: event.target.checked
                            ? allocateTimedSectionMinutes(draft.major_sections, draft.duration_minutes)
                            : prev.timed_section_minutes,
                        }))}
                      />
                      <div className="text-muted small mt-1">
                        Each timer is shared by the question groups in its section.
                      </div>
                      {advancedDraft.include_timing ? (
                        <div className="d-grid gap-2 mt-2">
                          {draft.major_sections.map((sectionName) => (
                            <div className="d-flex align-items-center gap-2" key={sectionName}>
                              <Form.Label className="mb-0 flex-grow-1" htmlFor={`create-timed-section-${sectionName.replace(/\s+/g, '-').toLowerCase()}`}>
                                {sectionName}
                              </Form.Label>
                              <Form.Control
                                id={`create-timed-section-${sectionName.replace(/\s+/g, '-').toLowerCase()}`}
                                type="number"
                                min="1"
                                step="1"
                                aria-label={`${sectionName} minutes`}
                                style={{ width: '5.5rem' }}
                                value={advancedDraft.timed_section_minutes?.[sectionName] || ''}
                                onChange={(event) => setAdvancedDraft((prev) => ({
                                  ...prev,
                                  timed_section_minutes: {
                                    ...prev.timed_section_minutes,
                                    [sectionName]: event.target.value,
                                  },
                                }))}
                              />
                              <span className="text-muted small">min</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                <Form.Group className="mb-3" ref={tutorialRefs.brief}>
                  <Form.Label>Activity Description</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={8}
                    value={draft.description}
                    onChange={(event) => handleDraftChange('description', event.target.value)}
                  />
                </Form.Group>

                <div className="d-flex flex-wrap gap-2">
                  <Button variant="success" onClick={() => createDraft()} disabled={createBusy || !classId}>
                    {createBusy ? <Spinner animation="border" size="sm" className="me-2" /> : <Stars className="me-2" />}
                    Create Draft
                  </Button>
                  <Button variant="outline-primary" onClick={createBlankActivity} disabled={createBusy || !classId}>
                    {createBusy ? <Spinner animation="border" size="sm" className="me-2" /> : <PencilSquare className="me-2" />}
                    Create Blank — No AI
                  </Button>
                  {isAssignmentDraft ? (
                    <Button variant="outline-success" onClick={() => createDraft({ useLabBoilerplate: true })} disabled={createBusy || !classId}>
                      {createBusy ? <Spinner animation="border" size="sm" className="me-2" /> : <PlusLg className="me-2" />}
                      Create Lab Boilerplate
                    </Button>
                  ) : null}
                </div>
                <div className="text-muted small mt-2">
                  <strong>Create Blank — No AI</strong> creates a local activity immediately, then opens Source so you can paste markup. It does not send a generation request.
                </div>
                {isAssignmentDraft ? (
                  <div className="text-muted small mt-2">
                    This creates a ready-to-edit sample lab without requiring a title or AI brief. It includes every supported lab building block.
                  </div>
                ) : null}
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
                    placeholder="Ask for a specific change to one question, question group, or section. Smaller, targeted requests are much less likely to time out."
                    value={revisionRequest}
                    onChange={(event) => setRevisionRequest(event.target.value)}
                    disabled={revisionBusy || !!proposal}
                  />
                  <div className="text-muted small mt-1">
                    For best results, focus on one question, one group, or one section at a time. Very broad draft-wide changes are more likely to time out.
                  </div>
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
                {!isTestDraft ? (
                  <Button
                    ref={tutorialRefs.sandbox}
                    variant={rightMode === 'sandbox' ? 'primary' : 'outline-primary'}
                    onClick={() => selectRightMode('sandbox')}
                    disabled={!activity?.id || !!proposal || sandboxBusy}
                  >
                    {sandboxBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <PlayCircle className="me-1" />}
                    Sandbox
                  </Button>
                ) : null}
                {isTestDraft ? (
                  <Button
                    variant={rightMode === 'test-run' ? 'primary' : 'outline-primary'}
                    onClick={() => selectRightMode('test-run')}
                    disabled={!activity?.id || !!proposal || sandboxBusy}
                  >
                    {sandboxBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <PlayCircle className="me-1" />}
                    Test Run
                  </Button>
                ) : null}
              </ButtonGroup>
              <Button
                size="sm"
                variant="outline-secondary"
                onClick={undoVisualEdit}
                disabled={!visualUndoStack.length || !!proposal}
                title={visualUndoStack.length ? `Undo ${visualUndoStack.at(-1)?.label}` : 'Nothing to undo'}
              >
                <ArrowCounterclockwise className="me-1" /> Undo
              </Button>
              {isAssignmentDraft ? (
                <Button
                  size="sm"
                  variant="outline-success"
                  onClick={loadLabBoilerplate}
                  disabled={!activity?.id || !!proposal}
                  title="Replace the current source in the editor with the comprehensive lab example"
                >
                  <PlusLg className="me-1" /> Lab Boilerplate
                </Button>
              ) : null}
              {proposal ? <Badge bg="warning" text="dark">Proposal</Badge> : null}
              {activeIssues.length ? <Badge bg={activeIssues.some((issue) => issue.severity === 'error') ? 'danger' : 'warning'}>{activeIssues.length} issue{activeIssues.length === 1 ? '' : 's'}</Badge> : <Badge bg="success">Clean</Badge>}
              {activity?.id ? (
                <Badge bg={hasUnsavedChanges ? 'warning' : 'secondary'} text={hasUnsavedChanges ? 'dark' : undefined}>
                  {hasUnsavedChanges ? 'Unsaved browser changes' : `Saved · revision ${savedSourceRevision ?? 0}`}
                </Badge>
              ) : null}
            </div>
            <div className="d-flex gap-2">
              {activity?.sheet_url ? (
                <Button size="sm" variant="outline-secondary" onClick={openRemoteSync} disabled={!!proposal}>
                  Remote Copy
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="primary"
                disabled={!hasPendingPanelChanges || !!proposal || multipleChoiceValidation.errors.length > 0}
                onClick={trySelectedPanelChanges}
                title="Rebuild the selected component safely in this browser without saving to the database"
              >
                Try Changes
              </Button>
              <Button
                size="sm"
                variant="success"
                onClick={saveVisualEditorChanges}
                disabled={isDemoCreator || !activity?.id || saveBusy || !!proposal || !hasUnsavedChanges}
                title={hasMarkupErrors && firstMarkupError
                  ? `Save will explain the markup error at line ${firstMarkupError.line}.`
                  : 'Save this activity to the database'}
              >
                {saveBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <Save className="me-1" />}
                Save
              </Button>
            </div>
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
                            {selectedAiBlock ? 'AI Panel' : (selectedQuestionGroupBlock ? 'Question Group Panel' : 'Question Panel')}
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
                        {(selectedQuestionBlock || selectedQuestionGroupBlock || selectedAiBlock) ? (
                          <div className="border rounded bg-light p-2 mb-3">
                            <div className="small text-muted">
                              {hasPendingPanelChanges ? 'Panel changes are ready to try in this browser.' : 'Change a field to enable Try Changes.'}
                            </div>
                            <div className="small text-muted mt-1">Try Changes updates only this browser. Use the green Save button to write the activity to the database.</div>
                          </div>
                        ) : null}
                        {selectedQuestionGroupBlock ? (
                          <>
                            <div className="text-muted small mb-3 d-flex flex-wrap align-items-center gap-2">
                              <span>Group {selectedQuestionGroupBlock.groupId}</span>
                              <Badge bg="light" text="dark" className="border">
                                Retries: {Math.max(0, Number.parseInt(questionGroupInspectorDraft?.retriesRequired, 10) || 0)}
                              </Badge>
                            </div>

                            <Form.Group className="mb-3">
                              <Form.Label>Group Title</Form.Label>
                              <Form.Control
                                value={questionGroupInspectorDraft?.title || ''}
                                disabled={!questionGroupInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionGroupInspectorDraft((prev) => ({ ...(prev || {}), title: event.target.value }))}
                              />
                            </Form.Group>

                            <Form.Group className="mb-3">
                              <Form.Label>Retries Required</Form.Label>
                              <Form.Control
                                type="number"
                                min="0"
                                value={questionGroupInspectorDraft?.retriesRequired ?? 0}
                                disabled={!questionGroupInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionGroupInspectorDraft((prev) => ({ ...(prev || {}), retriesRequired: event.target.value }))}
                              />
                              {!selectedQuestionGroupBlock?.sourceMeta?.retriesLine ? (
                                <div className="text-muted small mt-1">Applying will add a group-level `\\retries` line.</div>
                              ) : null}
                            </Form.Group>

                            <div className="border-top pt-3 mb-3">
                              <Form.Check
                                className="mb-2"
                                type="checkbox"
                                id="question-group-section-timer"
                                label="Add a section timer"
                                checked={questionGroupInspectorDraft?.sectionTimerEnabled === true}
                                disabled={!questionGroupInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionGroupInspectorDraft((prev) => ({
                                  ...(prev || {}),
                                  sectionTimerEnabled: event.target.checked,
                                  sectionMinutes: event.target.checked && !prev?.sectionMinutes ? '10' : prev?.sectionMinutes,
                                }))}
                              />
                              {questionGroupInspectorDraft?.sectionTimerEnabled ? (
                                <Form.Group>
                                  <Form.Label className="small">Section timer (minutes)</Form.Label>
                                  <Form.Control
                                    type="number"
                                    min="1"
                                    step="1"
                                    value={questionGroupInspectorDraft?.sectionMinutes || ''}
                                    disabled={!questionGroupInspectorDraft || !!proposal}
                                    onChange={(event) => setQuestionGroupInspectorDraft((prev) => ({ ...(prev || {}), sectionMinutes: event.target.value }))}
                                  />
                                </Form.Group>
                              ) : null}
                              <div className="text-muted small mt-2">
                                This timer belongs to the section. Groups under the same section share it; Try Changes updates the browser copy only.
                              </div>
                            </div>

                            <div className="d-flex gap-2">
                              <Button
                                size="sm"
                                variant="outline-secondary"
                                onClick={() => setQuestionGroupInspectorDraft(buildQuestionGroupInspectorDraft(selectedQuestionGroupBlock, rawText))}
                                disabled={!selectedQuestionGroupBlock}
                              >
                                Reset
                              </Button>
                            </div>

                            <div className="border-top mt-3 pt-3">
                              <div className="text-muted small mb-2">Reorder within this section</div>
                              <div className="d-flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={!!proposal || selectedGroupMoveState.index <= 0}
                                  onClick={() => moveSelectedQuestionGroup(-1)}
                                >
                                  <ArrowUp className="me-1" /> Move Up
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={!!proposal || selectedGroupMoveState.index < 0 || selectedGroupMoveState.index >= selectedGroupMoveState.groups.length - 1}
                                  onClick={() => moveSelectedQuestionGroup(1)}
                                >
                                  <ArrowDown className="me-1" /> Move Down
                                </Button>
                              </div>
                            </div>

                            {selectedQuestionCodeBlock ? (
                              <div className="border-top mt-3 pt-3">
                                <div className="fw-semibold mb-2">{selectedQuestionCodeBlock.label} Starter Code</div>
                                <Form.Control
                                  as="textarea"
                                  rows={10}
                                  value={starterCodeDraft}
                                  spellCheck={false}
                                  disabled={!!proposal}
                                  className="creator-question-code-editor"
                                  onChange={(event) => setStarterCodeDraft(event.target.value)}
                                />
                                <Button size="sm" className="mt-2" variant="outline-primary" disabled={!!proposal} onClick={applyStarterCodeChanges}>
                                  Try Code Changes
                                </Button>
                              </div>
                            ) : null}

                            <div className="border-top mt-3 pt-3">
                              <Button
                                size="sm"
                                variant="outline-danger"
                                disabled={!!proposal}
                                onClick={() => removeQuestionGroup(selectedQuestionGroupBlock.groupId)}
                              >
                                <Trash className="me-1" /> Remove Question Group
                              </Button>
                            </div>
                          </>
                        ) : !selectedQuestionBlock ? (
                          !selectedAiBlock ? (
                            <div className="text-muted small">
                              Click a question or AI block in the Visual Editor to inspect and refine it without editing raw source.
                            </div>
                          ) : (
                            <>
                              <div className="text-muted small mb-3">
                                AI learning tool · group {selectedAiBlock.groupId}
                                {selectedAiBlock.parentQuestionId ? ` · legacy question ${selectedAiBlock.parentQuestionId}` : ''}
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
                                <Form.Label>AI Model</Form.Label>
                                <Form.Select
                                  value={aiInspectorDraft?.model || INLINE_AI_DEFAULT_MODEL}
                                  disabled={!aiInspectorDraft || !!proposal}
                                  onChange={(event) => setAiInspectorDraft((prev) => ({ ...(prev || {}), model: event.target.value }))}
                                >
                                  {INLINE_AI_MODEL_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </Form.Select>
                                <div className="text-muted small mt-1">Used only for this AI interaction.</div>
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

                            <div className="d-flex flex-wrap gap-2 mb-3">
                              <Button
                                size="sm"
                                variant="outline-success"
                                disabled={!activity?.id || !!proposal || sandboxBusy}
                                onClick={openCreatorTestRun}
                              >
                                {sandboxBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <PlayCircle className="me-1" />}
                                Open Test Run
                              </Button>
                            </div>
                            <div className="text-muted small mb-3">
                              Opens a creator-only test run for this question so you can check grading behavior and refine the rubric below.
                            </div>

                            {selectedQuestionBlock?.scores ? (
                              <div className="border rounded bg-light p-2 mb-3">
                                <div className="fw-semibold small mb-1">Current scoring</div>
                                <div className="d-flex flex-wrap gap-2 small">
                                  {[
                                    ['response', 'Written'],
                                    ['code', 'Code'],
                                    ['output', 'Output'],
                                  ].map(([key, label]) => {
                                    const score = selectedQuestionBlock?.scores?.[key];
                                    if (!score || !Number.isFinite(Number(score.points))) return null;
                                    const points = Number(score.points);
                                    return (
                                      <span key={`score-summary-${key}`} className="badge bg-light text-muted border">
                                        {label}: {points} pt{points !== 1 ? 's' : ''}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}

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

                            <div className="border-top mt-3 pt-3 mb-3">
                              <div className="fw-semibold mb-2">Scoring Rubric</div>
                              <div className="text-muted small mb-3">
                                These score bands are used when the question is graded in test mode. Edit them here to tune the grading for this question. Leave points blank or set them to 0 to remove a band.
                              </div>

                              {[
                                ['response', 'Written response', 'responseScorePoints', 'responseScoreInstructions'],
                                ['code', 'Code', 'codeScorePoints', 'codeScoreInstructions'],
                                ['output', 'Output', 'outputScorePoints', 'outputScoreInstructions'],
                              ].map(([type, label, pointsKey, instructionsKey]) => (
                                <div key={`rubric-${type}`} className="border rounded p-2 mb-2">
                                  <div className="fw-semibold mb-2">{label}</div>
                                  <Form.Group className="mb-2">
                                    <Form.Label className="small mb-1">Points</Form.Label>
                                    <Form.Control
                                      type="number"
                                      min="0"
                                      step="1"
                                      value={questionInspectorDraft?.[pointsKey] ?? ''}
                                      disabled={!questionInspectorDraft || !!proposal}
                                      onChange={(event) => setQuestionInspectorDraft((prev) => ({
                                        ...(prev || {}),
                                        [pointsKey]: event.target.value,
                                      }))}
                                    />
                                  </Form.Group>
                                  <Form.Group>
                                    <Form.Label className="small mb-1">Rubric notes</Form.Label>
                                    <Form.Control
                                      as="textarea"
                                      rows={2}
                                      value={questionInspectorDraft?.[instructionsKey] || ''}
                                      disabled={!questionInspectorDraft || !!proposal}
                                      onChange={(event) => setQuestionInspectorDraft((prev) => ({
                                        ...(prev || {}),
                                        [instructionsKey]: event.target.value,
                                      }))}
                                    />
                                  </Form.Group>
                                </div>
                              ))}
                            </div>

                            <Form.Group className="mb-3">
                              <Form.Check
                                type="switch"
                                id="question-multiple-choice"
                                label="Multiple-choice response"
                                checked={!!questionInspectorDraft?.multipleChoiceEnabled}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({
                                  ...(prev || {}),
                                  multipleChoiceEnabled: event.target.checked,
                                  responseLines: event.target.checked ? '' : prev?.responseLines,
                                }))}
                              />
                              <div className="text-muted small mt-1">
                                Choose single-select for one answer or multi-select for survey checkboxes.
                              </div>
                            </Form.Group>

                            {questionInspectorDraft?.multipleChoiceEnabled ? (
                              <div className="border rounded p-2 mb-3 bg-light">
                                <Form.Group className="mb-3">
                                  <Form.Label>Selection type</Form.Label>
                                  <Form.Select
                                    value={questionInspectorDraft?.multipleChoiceSelectionMode || 'single'}
                                    disabled={!!proposal}
                                    onChange={(event) => setQuestionInspectorDraft((prev) => ({
                                      ...(prev || {}),
                                      multipleChoiceSelectionMode: event.target.value,
                                      multipleChoiceAnswer: event.target.value === 'multiple' ? '' : prev?.multipleChoiceAnswer,
                                      multipleChoiceChoices: (prev?.multipleChoiceChoices || []).map((choice) => (
                                        event.target.value === 'multiple' ? { ...choice, points: null } : choice
                                      )),
                                    }))}
                                  >
                                    <option value="single">Choose one answer</option>
                                    <option value="multiple">Select all that apply (survey)</option>
                                  </Form.Select>
                                </Form.Group>
                                {questionInspectorDraft?.multipleChoiceSelectionMode !== 'multiple' ? (
                                <Form.Group className="mb-2">
                                  <Form.Label>Legacy Answer Key <span className="text-muted small">(optional; leave blank for surveys or choice-level scoring)</span></Form.Label>
                                  <Form.Control
                                    value={questionInspectorDraft?.multipleChoiceAnswer || ''}
                                    disabled={!!proposal}
                                    onChange={(event) => setQuestionInspectorDraft((prev) => ({
                                      ...(prev || {}),
                                      multipleChoiceAnswer: event.target.value,
                                    }))}
                                  />
                                </Form.Group>
                                ) : null}
                                <Form.Label className="mb-1">Choices</Form.Label>
                                {(questionInspectorDraft?.multipleChoiceChoices || []).map((choice, index) => (
                                  <div className="d-flex gap-2 mb-2" key={`multiple-choice-option-${index}`}>
                                    <Form.Control
                                      value={choice?.value ?? choice ?? ''}
                                      aria-label={`Choice ${index + 1}`}
                                      disabled={!!proposal}
                                      onChange={(event) => setQuestionInspectorDraft((prev) => {
                                        const choices = [...(prev?.multipleChoiceChoices || [])];
                                        choices[index] = { ...(typeof choices[index] === 'object' ? choices[index] : {}), value: event.target.value };
                                        return { ...(prev || {}), multipleChoiceChoices: choices };
                                      })}
                                    />
                                    {questionInspectorDraft?.multipleChoiceSelectionMode !== 'multiple' ? <Form.Control
                                      type="number"
                                      min="0"
                                      step="1"
                                      placeholder="Survey"
                                      value={choice?.points ?? ''}
                                      aria-label={`Points for choice ${index + 1}`}
                                      disabled={!!proposal}
                                      style={{ maxWidth: '6.5rem' }}
                                      onChange={(event) => setQuestionInspectorDraft((prev) => {
                                        const choices = [...(prev?.multipleChoiceChoices || [])];
                                        const rawPoints = event.target.value;
                                        choices[index] = {
                                          ...(typeof choices[index] === 'object' ? choices[index] : { value: choices[index] }),
                                          points: rawPoints === '' ? null : Number.parseInt(rawPoints, 10),
                                        };
                                        return { ...(prev || {}), multipleChoiceChoices: choices };
                                      })}
                                    /> : null}
                                    <Button
                                      size="sm"
                                      variant="outline-danger"
                                      disabled={!!proposal || (questionInspectorDraft?.multipleChoiceChoices?.length || 0) <= 2}
                                      onClick={() => setQuestionInspectorDraft((prev) => ({
                                        ...(prev || {}),
                                        multipleChoiceChoices: (prev?.multipleChoiceChoices || []).filter((_, choiceIndex) => choiceIndex !== index),
                                      }))}
                                      aria-label={`Remove choice ${index + 1}`}
                                    >
                                      <Trash />
                                    </Button>
                                  </div>
                                ))}
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={!!proposal}
                                  onClick={() => setQuestionInspectorDraft((prev) => ({
                                    ...(prev || {}),
                                    multipleChoiceChoices: [...(prev?.multipleChoiceChoices || []), { value: `Option ${(prev?.multipleChoiceChoices?.length || 0) + 1}`, points: null }],
                                  }))}
                                >
                                  <PlusLg className="me-1" /> Add Choice
                                </Button>
                                {multipleChoiceValidation.errors.length ? (
                                  <div className="text-danger small mt-2">
                                    {multipleChoiceValidation.errors.map((message) => <div key={message}>{message}</div>)}
                                  </div>
                                ) : null}
                                <div className="text-muted small mt-2">
                                  Leave every points field blank for a survey. To self-score a test question, give every choice a whole-number point value; partial credit is supported.
                                </div>
                              </div>
                            ) : null}

                            {!questionInspectorDraft?.multipleChoiceEnabled ? (
                            <Form.Group className="mb-3">
                              <Form.Label>Response Lines</Form.Label>
                              <Form.Control
                                type="number"
                                min="1"
                                placeholder="No written response"
                                value={questionInspectorDraft?.responseLines ?? ''}
                                disabled={!questionInspectorDraft || !!proposal}
                                onChange={(event) => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), responseLines: event.target.value }))}
                              />
                              <div className="d-flex gap-2 mt-2">
                                {selectedQuestionBlock?.sourceMeta?.textResponseLine ? (
                                  <Button size="sm" variant="outline-danger" disabled={!!proposal} onClick={removeResponseLines}>
                                    Remove Response Lines
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline-secondary"
                                    disabled={!questionInspectorDraft || !!proposal}
                                    onClick={() => setQuestionInspectorDraft((prev) => ({ ...(prev || {}), responseLines: prev?.responseLines || 3 }))}
                                  >
                                    Add Response Lines
                                  </Button>
                                )}
                              </div>
                              <div className="text-muted small mt-1">
                                Written responses are optional for code questions. Leave this blank to omit them; Try Changes updates the browser copy only.
                              </div>
                            </Form.Group>
                            ) : null}

                            <div className="d-flex gap-2">
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
                              <div className="fw-semibold mb-2">AI Revise This Question</div>
                              <Form.Control
                                as="textarea"
                                rows={3}
                                placeholder="Describe the change you want—for example, make the prompt more concrete or add a misconception check."
                                value={questionRevisionRequest}
                                disabled={questionRevisionBusy || !!proposal}
                                onChange={(event) => setQuestionRevisionRequest(event.target.value)}
                              />
                              <Button
                                size="sm"
                                className="mt-2"
                                variant="outline-primary"
                                disabled={!questionRevisionRequest.trim() || questionRevisionBusy || !!proposal}
                                onClick={requestQuestionRevision}
                              >
                                {questionRevisionBusy ? <Spinner animation="border" size="sm" className="me-1" /> : <Stars className="me-1" />}
                                Propose Revision
                              </Button>

                              {questionRevisionProposal ? (
                                <div className="mt-3">
                                  {questionRevisionProposal.summary?.length ? (
                                    <div className="small mb-2">
                                      <div className="fw-semibold">Proposed changes</div>
                                      <ul className="mb-0 ps-3">
                                        {questionRevisionProposal.summary.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
                                      </ul>
                                    </div>
                                  ) : null}
                                  <div className="text-muted small mb-1">Proposed activity output</div>
                                  <div className="border rounded bg-light p-2 creator-question-proposal-preview">
                                    {proposedQuestionPreview}
                                  </div>
                                  {questionRevisionProposal.warnings?.length ? (
                                    <Alert variant="warning" className="py-2 mt-2 mb-2">
                                      {questionRevisionProposal.warnings.join(' ')}
                                    </Alert>
                                  ) : null}
                                  {questionRevisionProposal.generationStatus !== 'generated' ? (
                                    <Alert variant="secondary" className="small py-2 mb-2">
                                      <div><strong>Revision diagnostics</strong> — status: {questionRevisionProposal.generationStatus}</div>
                                      {questionRevisionProposal.generationError ? (
                                        <div className="text-break mt-1">{questionRevisionProposal.generationError}</div>
                                      ) : null}
                                    </Alert>
                                  ) : null}
                                  <div className="d-flex gap-2 mt-2">
                                    <Button
                                      size="sm"
                                      variant="primary"
                                      onClick={applyQuestionRevision}
                                      disabled={questionRevisionProposal.proposedMarkup.trim() === questionRevisionProposal.currentMarkup.trim()}
                                    >
                                      Apply Revision
                                    </Button>
                                    <Button size="sm" variant="outline-secondary" onClick={() => setQuestionRevisionProposal(null)}>Discard</Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>

                            <div className="border-top mt-3 pt-3">
                              <div className="text-muted small mb-2">Reorder within this question group</div>
                              <div className="d-flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={!!proposal || selectedQuestionMoveState.index <= 0}
                                  onClick={() => moveSelectedQuestion(-1)}
                                >
                                  <ArrowUp className="me-1" /> Move Up
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline-secondary"
                                  disabled={!!proposal || selectedQuestionMoveState.index < 0 || selectedQuestionMoveState.index >= selectedQuestionMoveState.questions.length - 1}
                                  onClick={() => moveSelectedQuestion(1)}
                                >
                                  <ArrowDown className="me-1" /> Move Down
                                </Button>
                              </div>
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
              <div className="creator-source-editor-wrap">
                <div className="creator-source-line-gutter" ref={sourceGutterRef} aria-hidden="true">
                  {Array.from({ length: sourceLineCount }, (_, index) => (
                    <div key={index}>{index + 1}</div>
                  ))}
                </div>
                <Form.Control
                  as="textarea"
                  className="creator-markup-editor"
                  value={activeText}
                  readOnly={!!proposal}
                  spellCheck={false}
                  ref={sourceTextareaRef}
                  onScroll={() => {
                    if (sourceGutterRef.current && sourceTextareaRef.current) {
                      sourceGutterRef.current.scrollTop = sourceTextareaRef.current.scrollTop;
                    }
                  }}
                  onChange={(event) => {
                    setRawText(event.target.value);
                    setSandboxUrl('');
                    setVisualUndoStack([]);
                  }}
                />
              </div>
            ) : null}

            {rightMode === 'sandbox' || rightMode === 'test-run' ? (
              sandboxUrl ? (
                <iframe
                  title={rightMode === 'test-run' ? 'Creator test run' : 'Creator sandbox'}
                  className="creator-sandbox-frame"
                  src={sandboxUrl}
                />
              ) : (
                <div className="p-3"><Alert variant="secondary">{rightMode === 'test-run' ? 'Test run is not open.' : 'Sandbox is not open.'}</Alert></div>
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

      <Modal show={!!insertTarget} onHide={() => setInsertTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Add {insertTarget?.kind === 'group' ? 'Question Group' : 'Question'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small">Choose the kind of starter question to insert.</p>
          <div className="d-grid gap-2">
            {[
              ['written', 'Written Response', 'A text-response question with sample-answer and feedback fields.'],
              ['multiplechoice', 'Multiple Choice', 'A single-answer question with editable answer choices.'],
              ['python', 'Python', 'An editable local Python block.'],
              ['pythonremote', 'Python Remote', 'An editable remote Python block.'],
              ['pythonturtle', 'Python Turtle', 'An editable turtle canvas and Python block.'],
              ['cpp', 'C++', 'An editable C++ code block.'],
              ['ai', 'AI-Assisted Question', 'A text response paired with an inline AI coach block.'],
            ].map(([questionType, title, description]) => (
              <Button
                key={questionType}
                variant="outline-primary"
                className="text-start"
                onClick={() => {
                  if (insertTarget?.kind === 'group') {
                    insertStarterQuestionGroup(insertTarget.block, insertTarget.placement, questionType);
                  } else {
                    insertStarterQuestion(insertTarget?.block, insertTarget?.placement, questionType);
                  }
                  setInsertTarget(null);
                }}
              >
                <div className="fw-semibold">{title}</div>
                <div className="small text-muted">{description}</div>
              </Button>
            ))}
          </div>
        </Modal.Body>
      </Modal>

      <Modal show={showAdvanced} onHide={() => setShowAdvanced(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Advanced</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted small mb-3">
            These settings guide this draft. Section timers are set in the main Create Activity form.
          </p>

          <Form.Group className="mb-3">
            <Form.Label>Language</Form.Label>
            <Form.Control
              value={advancedDraft.language}
              onChange={(event) => setAdvancedDraft((prev) => ({ ...prev, language: event.target.value }))}
              placeholder="English"
            />
          </Form.Group>

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
          {activity?.id ? (
            <Button
              variant="primary"
              disabled={revisionBusy || !!proposal || !advancedPromptText}
              onClick={() => {
                setShowAdvanced(false);
                requestRevision('Apply the selected advanced settings to this activity.');
              }}
            >
              <Stars className="me-1" /> Apply to Draft
            </Button>
          ) : null}
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
      <Modal show={showRemoteSync} onHide={() => setShowRemoteSync(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Remote Google Doc</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted">
            Google is read-only from coLearn-AI. You can copy the local markup to paste into the Doc, or explicitly import the Doc into this activity.
          </p>
          {remoteBusy ? <div className="text-muted">Checking the linked Google Doc…</div> : null}
          {remoteError ? <Alert variant="danger" className="py-2">{remoteError}</Alert> : null}
          {remoteStatus ? (
            <>
              <div className="border rounded p-3 mb-3">
                <div>
                  <strong>Local version:</strong>{' '}
                  {remoteStatus.local?.revision ? `revision ${remoteStatus.local.revision} · ` : ''}
                  {remoteStatus.local?.updated_at ? formatLocalDateTime(remoteStatus.local.updated_at) : 'not recorded yet'}
                  {remoteStatus.local?.origin ? ` · ${remoteStatus.local.origin === 'google_import' ? 'imported from Google' : 'saved in Creator'}` : ''}
                </div>
                <div><strong>Google Doc version:</strong> {remoteStatus.remote?.updated_at ? formatLocalDateTime(remoteStatus.remote.updated_at) : 'unknown'}</div>
                <div className="mt-2"><strong>Status:</strong> {
                  ({
                    in_sync: 'Markup matches',
                    local_newer: 'Local markup is newer',
                    remote_newer: 'Google Doc markup is newer',
                    conflict: 'Both local markup and the Google Doc changed since their last sync',
                    remote_only: 'Only the Google Doc has markup',
                    different_unknown: 'Markup differs; timestamps are unavailable',
                  })[remoteStatus.comparison?.state] || 'Could not compare versions'
                }</div>
              </div>
              {remoteStatus.comparison?.state === 'local_newer' ? (
                <Alert variant="info" className="py-2">
                  <strong>Publish your local edit manually:</strong> copy the local markup, open the Google Doc in your own Google account, replace its contents, then return here and refresh the status.
                </Alert>
              ) : null}
              {remoteStatus.comparison?.state === 'remote_newer' ? (
                <Alert variant="warning" className="py-2 mb-3">
                  Google has changed since the local copy. Use <strong>Import Remote</strong> to bring that version into the database before editing locally.
                </Alert>
              ) : null}
              {remoteStatus.comparison?.state === 'conflict' ? (
                <Alert variant="danger" className="py-2 mb-3">
                  Do not import automatically: both copies changed after their last match. Open the Google Doc and preserve the local markup before choosing which copy should win.
                </Alert>
              ) : null}
              <div className="small text-muted">{remoteStatus.remote?.title || activity?.sheet_url}</div>
            </>
          ) : null}
        </Modal.Body>
        <Modal.Footer className="justify-content-between">
          <Button variant="outline-secondary" onClick={loadRemoteStatus} disabled={remoteBusy}>
            {remoteStatus?.comparison?.state === 'local_newer' ? 'I pasted into Google — Refresh' : 'Refresh status'}
          </Button>
          <div className="d-flex gap-2">
            <Button variant="outline-primary" onClick={copyLocalSource} disabled={!rawText}>Copy Local Markup</Button>
            <Button variant="outline-primary" onClick={openRemoteDocument}>Open Remote</Button>
            <Button
              variant="warning"
              onClick={importRemoteSource}
              disabled={remoteBusy || remoteStatus?.comparison?.state === 'conflict'}
              title={remoteStatus?.comparison?.state === 'conflict' ? 'Resolve the conflict deliberately before importing.' : undefined}
            >
              Import Remote
            </Button>
          </div>
        </Modal.Footer>
      </Modal>
      <Modal show={!!pendingNavigation} onHide={() => setPendingNavigation(null)} centered backdrop="static">
        <Modal.Header>
          <Modal.Title>Unsaved activity changes</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          You have changes in this browser that have not been saved to the activity. Save them, discard them, or keep editing.
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setPendingNavigation(null)}>Keep Editing</Button>
          <Button
            variant="outline-danger"
            onClick={() => {
              setRawText(savedSourceText);
              compileText(savedSourceText);
              setVisualUndoStack([]);
              navigate(pendingNavigation);
            }}
          >
            Discard Changes
          </Button>
          <Button
            variant="success"
            disabled={saveBusy}
            onClick={async () => {
              try {
                await saveSource(rawText);
                navigate(pendingNavigation);
              } catch (err) {
                setError(err?.message || 'Could not save before leaving.');
              }
            }}
          >
            Save Changes
          </Button>
        </Modal.Footer>
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
