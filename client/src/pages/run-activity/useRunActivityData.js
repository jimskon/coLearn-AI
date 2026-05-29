import { useCallback } from 'react';

import { API_BASE_URL } from '../../config';
import { parseSheetToBlocks } from '../../utils/parseSheet';
import { parseUtcDbDatetime } from '../../utils/time';

export default function useRunActivityData({
  instanceId,
  user,
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
}) {
  return useCallback(async function loadActivity() {
    if (loadingRef.current) {
      return;
    }

    loadingRef.current = true;

    try {
      const instanceRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`, {
        credentials: 'include',
      });
      const instanceData = await instanceRes.json();

      setActivity(instanceData);

      let effective = instanceData;

      if (!effective.total_groups) {
        await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}/refresh-groups`, {
          credentials: 'include',
        });

        const updatedRes = await fetch(`${API_BASE_URL}/api/activity-instances/${instanceId}`, {
          credentials: 'include',
        });
        const updatedData = await updatedRes.json();

        setActivity(updatedData);
        effective = updatedData;
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

        restoredTextFeedback[qid] = text;
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

        const activitycontext = stripHtml(activityContextBlock?.content || '');
        const studentlevel = stripHtml(studentLevelBlock?.content || '');
        const aicodeguidance = stripHtml(aiCodeGuideBlock?.content || '');

        setActivity((prev) => ({
          ...prev,
          ...instanceData,
          activitycontext,
          studentlevel,
          aicodeguidance,
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

