// client/src/pages/ActivityPreview.jsx
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Container, Button } from 'react-bootstrap';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import 'prismjs/components/prism-python';
import { parseSheetToBlocks, renderBlocks } from '../utils/parseSheet';
import { API_BASE_URL } from '../config';

export default function ActivityPreview() {

  const { activityId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [parseMeta, setParseMeta] = useState(null);

  const params = new URLSearchParams(location.search);
  const returnTo = params.get('returnTo'); // null if missing

  const [activity, setActivity] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [fileContents, setFileContents] = useState({});
  const [renderedElements, setRenderedElements] = useState([]);
  const [skulptLoaded, setSkulptLoaded] = useState(false);

  // NEW: local state used by renderBlocks / code blocks
  const [codeViewMode, setCodeViewMode] = useState({}); // { responseKey: 'active'|'local' }
  const [localCode, setLocalCode] = useState({});       // { responseKey: string }

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

        setActivity(activityData);

        const url = String(activityData?.sheet_url || '').trim();
        console.log("[ActivityPreview] activity loaded", { id: activityData?.id, url });

        if (!url || url === 'undefined') {
          console.warn("[ActivityPreview] No sheet_url on activity; nothing to preview.");
          setBlocks([]);
          setFileContents({});
          return;
        }

        const docRes = await fetch(
          `${API_BASE_URL}/api/activities/preview-doc?docUrl=${encodeURIComponent(url)}`,
          { credentials: 'include' }
        );
        if (!docRes.ok) throw new Error(`preview-doc failed ${docRes.status}`);

        const body = await docRes.json();
        const lines = body?.lines || [];

        const computedIsTest = Array.isArray(lines) && lines.some(
          (line) => String(line).trim() === '\\test'
        ) ? 1 : 0;

        // Persist only if different (avoids spamming)
        const dbIsTest = (activityData?.is_test === 1) ? 1 : 0;

        if (computedIsTest !== dbIsTest) {
          try {
            await fetch(`${API_BASE_URL}/api/activities/${activityId}/is-test`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ is_test: computedIsTest }),
            });

            // keep local state consistent (optional but nice)
            activityData.is_test = computedIsTest;
            setActivity({ ...activityData });
          } catch (e) {
            console.error('[ActivityPreview] Failed to persist is_test', e);
          }
        }


        console.log("[ActivityPreview] preview-doc lines", { count: lines.length });

        const parsedRes = parseSheetToBlocks(lines, { returnIssues: true });
        const parsed = parsedRes.blocks;
        setParseMeta(parsedRes.meta);

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
    const rendered = renderBlocks(blocks, {
      mode: 'preview',
      editable: true,
      isActive: true,              // allow editing in preview
      isObserver: false,
      allowLocalToggle: true,      // needed for Edit / View buttons
      fileContents,
      setFileContents: handleUpdateFileContents,

      // hook up code editing just like RunActivityPage (but local-only)
      codeViewMode,
      onToggleViewMode: toggleCodeViewMode,
      localCode,
      onLocalCodeChange: updateLocalCode,
      onCodeChange: handleCodeChange,
    });
    setRenderedElements(rendered);
  }, [blocks, fileContents, codeViewMode, localCode]);

  useEffect(() => {
    Prism.highlightAll();
  }, [renderedElements]);

  return (
    <Container>
      <div className="d-flex justify-content-between align-items-center mt-2 mb-2">
        <h2 className="mb-0">Preview: {activity?.title}</h2>
        {parseMeta && (
          <div className="alert alert-secondary py-2 my-2">
            <div>
              <strong>Retries:</strong> sheet default = {parseMeta.retriesDefault}
            </div>

            <div className="small mt-1">
              Per-group effective:{' '}
              {Object.keys(parseMeta.groupRetries).length
                ? Object.entries(parseMeta.groupRetries)
                  .sort((a, b) => Number(a[0]) - Number(b[0]))
                  .map(([gid, v]) => `G${gid}=${v}`)
                  .join(' · ')
                : 'none'}
            </div>
          </div>
        )}
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

      {!skulptLoaded ? (
        <p>Loading Python engine (Skulpt)...</p>
      ) : (
        renderedElements
      )}
    </Container>
  );
}
