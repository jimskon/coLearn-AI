import { useCallback, useRef } from 'react';

// A burst of this many loads inside the window is treated as a loop, not as
// legitimate activity. One submit or one becomes-active transition is a single
// load, so real usage stays far below this.
// A real instance row always carries its own id. An error body ({error: ...})
// and a null parse do not, which is what makes this a reliable discriminator.
function isLoadedInstance(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data) && data.id != null;
}

const RELOAD_BURST_LIMIT = 6;
const RELOAD_BURST_WINDOW_MS = 4000;
const RELOAD_BURST_COOLDOWN_MS = 5000;

import { API_BASE_URL } from '../../config';
import { parseSheetToBlocks } from '../../utils/parseSheet';
import { parseUtcDbDatetime } from '../../utils/time';

export default function useRunActivityData({
  instanceId,
  user,
  loadResponses = true,
  canRefreshInstanceMetadata = true,
  setActivity,
  setActiveStudentId,
  setGroupMembers,
  setExistingAnswers,
  setCodeFeedbackShown,
  setTextFeedbackShown,
  setFollowupAnswers,
  setNonLegacyForUI,
  setFileContents,
  setGroups,
  setPreamble,
  setFollowupsShown,
  dirtyKeysRef,
  dirtyTextQidsRef,
  qidsNoFURef,
  fileContentsRef,
  loadingRef,
  stripHtml,
  isNoAI,
  isTestMode = false,
}) {
  const loadActivityCallsRef = useRef([]);
  const loadActivityStormRef = useRef(false);

  return useCallback(async function loadActivity() {
    if (loadingRef.current) {
      return;
    }

    // Runaway-reload circuit breaker.
    //
    // loadActivity fetches /active-student and calls setActiveStudentId, and
    // that endpoint is not a pure read -- it reassigns the active student and
    // writes to the DB. Setting activeStudentId can flip isActive, and the
    // isActive effect in RunActivityPage calls loadActivity again, so there is
    // a real feedback edge here. When it engages, the page reloads in a tight
    // loop: every pass re-parses the sheet and rewrites activity/groups, which
    // makes the floating section timer flicker on and off at the top of the
    // screen and hammers the server.
    //
    // Normal use never reloads this often -- a submit or a becomes-active
    // transition is one load. So treat a burst as a bug: refuse it, and log the
    // stack once so the offending caller is identifiable in the wild rather
    // than only under a debugger.
    const nowMs = Date.now();
    const recent = (loadActivityCallsRef.current = loadActivityCallsRef.current
      .filter((t) => nowMs - t < RELOAD_BURST_WINDOW_MS));

    if (recent.length >= RELOAD_BURST_LIMIT) {
      if (!loadActivityStormRef.current) {
        loadActivityStormRef.current = true;
        console.error(
          `[RUN] Runaway loadActivity: ${recent.length} reloads in ` +
          `${RELOAD_BURST_WINDOW_MS}ms. Suppressing further reloads for ` +
          `${RELOAD_BURST_COOLDOWN_MS}ms. Caller stack follows.`
        );
        console.trace('[RUN] loadActivity caller');
      }
      if (nowMs - recent[recent.length - 1] < RELOAD_BURST_COOLDOWN_MS) {
        return;
      }
      loadActivityCallsRef.current = [];
      loadActivityStormRef.current = false;
    }

    loadActivityCallsRef.current.push(nowMs);
    loadingRef.current = true;

    try {
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`, {
        credentials: 'include',
      });
      const instanceData = await instanceRes.json().catch(() => null);

      // Never publish a failed read into `activity`.
      //
      // A non-ok response still parses as JSON -- typically {error: "..."} --
      // and writing that object into activity silently strips every real field.
      // The visible symptom is chrome derived from those fields blinking out
      // and back: the submitted/score banner disappears for one render, as does
      // the section timer, because submitted_at and section_timer_* are simply
      // absent from the error payload. Keeping the previous good activity is
      // always better than replacing it with an error body.
      if (!instanceRes.ok || !isLoadedInstance(instanceData)) {
        console.warn('[RUN] Ignoring bad activity-instance response; keeping previous state.', {
          status: instanceRes.status,
          body: instanceData,
        });
        return;
      }

      // MERGE, never replace.
      //
      // instanceData is the activity_instances row. It carries no `meta`,
      // because mode/context/level are parsed out of the sheet further down and
      // folded in by the setActivity near the end of this function.
      //
      // Replacing wholesale therefore publishes a activity that momentarily
      // claims meta is absent, and activityMode falls back to 'group'. For an
      // assignment that is not cosmetic: isAssignmentMode gates the
      // submitted/score banner (so it blinks out), and it is a term of isActive
      // (so isActive drops to false and then back to true when meta lands).
      // The isActive effect in RunActivityPage reloads on that false -> true
      // edge, which starts the next load, which repeats the whole dance -- an
      // endless reload loop that only appears on assignments, since a group
      // activity derives isActive from activeStudentId instead.
      //
      // Merging keeps the parsed fields from the previous load in place, so the
      // edge happens once on genuine first load and never again.
      setActivity((prev) => ({ ...prev, ...instanceData }));

      let effective = instanceData;

      if (!effective.total_groups && canRefreshInstanceMetadata) {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`, {
          credentials: 'include',
        });

        const updatedRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`, {
          credentials: 'include',
        });
        const updatedData = await updatedRes.json().catch(() => null);

        if (updatedRes.ok && isLoadedInstance(updatedData)) {
          // Same reasoning as above: this is a row refresh, not a whole activity.
          setActivity((prev) => ({ ...prev, ...updatedData }));
          effective = updatedData;
        }
      }

      const activeRes = await fetch(
        `${API_BASE_URL}/api/activity-instances/${instanceId}/active-student`,
        {
          credentials: 'include',
        }
      );
      const activeData = await activeRes.json();
      setActiveStudentId(activeData.activeStudentId);

      const groupRes = await fetch(`${API_BASE_URL}/api/groups/instance/${instanceId}`, {
        credentials: 'include',
      });
      const groupData = await groupRes.json();
      let userGroup = null;
      if (user?.id) {
        userGroup = groupData.groups.find((g) =>
          g.members.some((m) => m.student_id === user.id)
        );
      }

      if (userGroup) {
        setGroupMembers(userGroup.members);
      } else {
        const elevated =
          user?.role === 'instructor' ||
          user?.role === 'root' ||
          user?.role === 'creator';
        if (elevated) {
          const activeId = activeData?.activeStudentId;
          const activeGroup = groupData.groups.find((g) =>
            g.members.some((m) => String(m.student_id) === String(activeId))
          );
          const fallbackGroup = groupData.groups?.[0];
          setGroupMembers(
            activeGroup?.members || fallbackGroup?.members || []
          );
        }
      }

      if (loadResponses) {
        const answersRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/responses`, {
          credentials: 'include',
        });
        const answersData = await answersRes.json();

        setExistingAnswers((prev) => {
          const next = { ...prev };

          for (const [k, v] of Object.entries(answersData || {})) {
            if (dirtyKeysRef.current.has(k)) continue;
            next[k] = v;
          }

          return next;
        });

        if (!isTestMode) {
          setCodeFeedbackShown((prev) => {
            const merged = { ...prev };
            for (const [key, entry] of Object.entries(answersData)) {
              if (
                entry &&
                Object.prototype.hasOwnProperty.call(entry, 'python_feedback')
              ) {
                merged[key] = entry.python_feedback;
              }
            }
            return merged;
          });

          const restoredTextFeedback = {};

          for (const [key, entry] of Object.entries(answersData || {})) {
            if (!key.endsWith('F1')) continue;
            const qid = key.slice(0, -2);

            if (dirtyTextQidsRef.current.has(qid)) continue;

            const text = (entry?.response || '').trim();
            if (!text) continue;

            // Restore the accepted/needs-revision colour along with the text.
            //
            // The UI reads this as {text, positive} and treats a bare string as
            // not-positive, so storing just the text made every restored answer
            // render yellow ("needs revision") after a reload -- including ones
            // the AI had accepted. <qid>FM records which it was, and is already
            // in this same payload.
            const marker = (answersData?.[`${qid}FM`]?.response || '')
              .trim()
              .toLowerCase();

            restoredTextFeedback[qid] = {
              text,
              positive: marker === 'accepted',
            };
          }

          setTextFeedbackShown((prev) => ({ ...prev, ...restoredTextFeedback }));

          const restoredFollowups = {};
          for (const [key, entry] of Object.entries(answersData)) {
            if (!key.endsWith('FA1')) continue;
            const text = (entry?.response || '').trim();
            if (text) {
              restoredFollowups[key] = text;
            }
          }
          if (Object.keys(restoredFollowups).length > 0) {
            setFollowupAnswers((prev) => ({ ...prev, ...restoredFollowups }));
          }
        } else {
          setCodeFeedbackShown({});
          setTextFeedbackShown({});
          setFollowupAnswers({});
          setFollowupsShown({});
        }
      } else {
        setExistingAnswers({});
        setCodeFeedbackShown({});
        setTextFeedbackShown({});
        setFollowupAnswers({});
        setFollowupsShown({});
      }

      {
        const docRes = await fetch(
          `${API_BASE_URL}/api/activity-instances/${instanceId}/preview-doc`
        );
        if (!docRes.ok) throw new Error(`instance preview failed ${docRes.status}`);
        const { lines } = await docRes.json();

        const isTestNow =
          (!!instanceData?.test_start_at && Number(instanceData?.test_duration_minutes) > 0) ||
          instanceData?.is_test === 1;

        const cutoff = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
        const startNow = instanceData?.test_start_at
          ? parseUtcDbDatetime(instanceData.test_start_at)
          : null;

        const isNonLegacyNow =
          isTestNow && startNow && startNow.getTime() >= cutoff.getTime();

        console.log('[RUN] parse flags:', {
          test_start_at: instanceData?.test_start_at,
          startNow,
          isTestNow,
          isNonLegacyNow,
        });
        setNonLegacyForUI(!!isNonLegacyNow);

        const parsed = parseSheetToBlocks(lines, {
          legacyTestNumbering: !isNonLegacyNow,
          returnIssues: true,
        });

        const blocks = parsed.blocks;
        const meta = parsed.meta || {};

        const activityContextBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'activitycontext'
        );
        const studentLevelBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'studentlevel'
        );
        const aiCodeGuideBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'aicodeguidance'
        );
        const languageBlock = blocks.find(
          (b) => b.type === 'header' && b.tag === 'language'
        );

        const activitycontext = stripHtml(activityContextBlock?.content || '');
        const studentlevel = stripHtml(studentLevelBlock?.content || '');
        const aicodeguidance = stripHtml(aiCodeGuideBlock?.content || '');
        const language = stripHtml(languageBlock?.content || meta.language || 'English') || 'English';

        setActivity((prev) => ({
          ...prev,
          ...instanceData,
          activitycontext,
          studentlevel,
          aicodeguidance,
          language,
          meta,
        }));

        const files = {};
        for (const block of blocks) {
          if (block.type === 'file' && block.filename) {
            files[block.filename] = block.content || '';
          }
        }
        setFileContents(() => {
          const updated = { ...files };
          fileContentsRef.current = updated;
          return updated;
        });

        const grouped = [];
        const preamble = [];
        let seenAnyGroup = false;
        let currentGroup = null;
        let betweenGroups = [];
        let activeSection = null;

        for (const block of blocks) {
          if (block.type === 'section') {
            activeSection = {
              key: block.key || null,
              title: block.title || '',
              minutes: Number(block.minutes) || null,
            };
          }

          if (block.type === 'groupIntro') {
            if (currentGroup) grouped.push(currentGroup);
            currentGroup = {
              intro: block,
              prelude: [],
              content: [],
              section: activeSection ? { ...activeSection } : null,
            };
            if (seenAnyGroup && betweenGroups.length) {
              currentGroup.prelude.push(...betweenGroups);
              betweenGroups = [];
            }
            seenAnyGroup = true;
            continue;
          }
          if (block.type === 'endGroup') {
            if (currentGroup) {
              grouped.push(currentGroup);
              currentGroup = null;
            }
            continue;
          }
          if (currentGroup) {
            currentGroup.content.push(block);
          } else {
            if (!seenAnyGroup) preamble.push(block);
            else betweenGroups.push(block);
          }
        }
        if (currentGroup) grouped.push(currentGroup);
        if (betweenGroups.length) {
          if (grouped.length)
            grouped[grouped.length - 1].content.push(...betweenGroups);
          else preamble.push(...betweenGroups);
        }

        setGroups(grouped);

        const noSet = new Set();
        for (const g of grouped) {
          for (const b of [g.intro, ...(g.content || [])]) {
            if (b?.type === 'question') {
              const qid = `${b.groupId}${b.id}`;
              if (
                isNoAI(b?.followups?.[0]) ||
                isNoAI(b?.feedback?.[0])
              ) {
                noSet.add(qid);
              }
            }
          }
        }
        qidsNoFURef.current = noSet;
        setPreamble(preamble);
        setFollowupsShown((prev) => {
          const next = { ...prev };
          for (const qid of qidsNoFURef.current) delete next[qid];
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to load activity data', err);
    } finally {
      loadingRef.current = false;
    }
  }, [
    instanceId,
    user,
    loadResponses,
    canRefreshInstanceMetadata,
    setActivity,
    setActiveStudentId,
    setGroupMembers,
    setExistingAnswers,
    setCodeFeedbackShown,
    setTextFeedbackShown,
    setFollowupAnswers,
    setNonLegacyForUI,
    setFileContents,
    setGroups,
    setPreamble,
    setFollowupsShown,
    dirtyKeysRef,
    dirtyTextQidsRef,
    qidsNoFURef,
    fileContentsRef,
    loadingRef,
    stripHtml,
    isNoAI,
  ]);
}
