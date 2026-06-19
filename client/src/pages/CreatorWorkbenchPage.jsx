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
  Save,
  Stars,
  X,
} from 'react-bootstrap-icons';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';
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

  const renderedActivity = useMemo(() => renderBlocks(activeBlocks, {
    mode: 'preview',
    editable: true,
    isInstructor: true,
    allowLocalToggle: false,
    fileContents,
    setFileContents: updateFileContents,
    infoBubbleSession: infoBubbleSessionRef.current,
  }), [activeBlocks, fileContents, updateFileContents, infoBubbleSessionRef]);

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
      const data = await res.json();
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
        .creator-sandbox-frame {
          width: 100%;
          height: 100%;
          border: 0;
          background: #fff;
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
                  <Eye className="me-1" /> Preview
                </Button>
                <Button variant={rightMode === 'edit' ? 'primary' : 'outline-primary'} onClick={() => selectRightMode('edit')}>
                  <PencilSquare className="me-1" /> Edit
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
                  <Alert variant="secondary" className="mb-0">Create a draft to preview it here.</Alert>
                ) : (
                  <div className="creator-preview-surface">{renderedActivity}</div>
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
            <div className="border-top p-2" style={{ maxHeight: 180, overflow: 'auto' }}>
              {activeIssues.map((issue, index) => (
                <Alert
                  key={`creator-issue-${index}`}
                  variant={issue.severity === 'error' ? 'danger' : 'warning'}
                  className="py-1 px-2 mb-1 small"
                >
                  <strong>{String(issue.severity || '').toUpperCase()}</strong>
                  {typeof issue.line === 'number' ? ` line ${issue.line}` : ''}: {issue.message}
                </Alert>
              ))}
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
