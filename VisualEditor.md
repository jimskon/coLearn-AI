# coLearn-AI Visual Activity Editor — Design Plan

**Author:** Jim Skon / Claude Sonnet 4.6  
**Date:** September 2026  
**Status:** Design only — no code changes proposed

---

## 1. Problem Statement

The existing activity editor (`ActivityEditor.jsx`) is a raw text editor: a textarea on the left, a live preview on the right. There is an "Auto Correct" button that calls an AI endpoint (`/api/ai/code/repair-markup`) to attempt to fix markup errors. This is the root of the corruption problem:

- AI-generated repair is **non-deterministic** — it infers intent, reorders content, rewrites entire blocks, and occasionally invents new markup
- The parser has strict structural rules (every `\question` inside `\questiongroup` inside `\section`, paired `\end*` tags, exact header fields) that AI does not reliably honour
- Even a single malformed tag can invalidate an entire activity file
- There is no rollback on a bad AI repair

The two existing helper functions (`swapSourceRanges`, `getSectionKeyAtLine` in `creatorVisualEdits.js`) show the correct instinct — line-range–based, structural, non-AI — but were never extended into a working UI.

---

## 2. Core Design Principle: Extract-Edit-Replace (EER)

Every edit follows exactly three steps:

```
1. EXTRACT   — Pull the target element's source lines out of the document.
               Replace those exact lines with an inert placeholder token.

2. EDIT      — Show a form-based editor for that element type only.
               User fills in structured fields (no free-form source editing).
               System generates new markup from a deterministic template.
               Validate the generated markup by parsing it in isolation.
               If the isolated parse has errors → block save, show errors.

3. REPLACE   — Splice the generated markup back in where the placeholder is.
               Run a full-document parse. If errors appear → rollback to
               the pre-extract text. Show the error. Never leave the document
               in a worse state than before.
```

Nothing is AI-generated in this flow. The markup output is produced by string templates, not language models.

---

## 3. The Markup Grammar as the Editor's Rule Engine

`parseSheet.jsx` already understands the markup grammar. The visual editor uses the parser's output — not its own invented rules — as the authoritative structure source. Every element the editor can create or modify must pass through the same parser the platform uses. The editor never writes markup the parser would reject.

The template system (Section 5 below) is derived directly from `MarkUp.md` and kept in sync with it. If the spec gains a new tag, a new template field is added; the UI blocks unchanged.

---

## 4. Document Model

Before any editing, the document is parsed into a **tree of positioned blocks**:

```
ActivityDocument
  meta: { title, name, mode, studentlevel, activitycontext, aicodeguidance, ... }
  sections: [
    Section {
      lineRange: { startLine, endLine }
      title: string
      questionGroups: [
        QuestionGroup {
          lineRange: { startLine, endLine }
          title: string
          questions: [
            Question {
              lineRange: { startLine, endLine }
              prompt: string
              responseBlocks: [ TextResponse | Code | MultipleChoice | Table | ... ]
              feedbackPrompt: string
              sampleResponses: string
              scoreBlock: ScoreBlock | null
            }
          ]
          aiBlocks: [ InlineAIBlock { lineRange, ... } ]
        }
      ]
    }
  ]
```

Every node carries `lineRange: { startLine, endLine }` (1-indexed, matching `swapSourceRanges` convention). This makes EER extraction a simple `lines.slice(startLine-1, endLine)` call.

---

## 5. Template System (Deterministic Markup Generation)

Each element type has a **template function** — a pure function from form values to markup string. Templates are kept in a single file (`markupTemplates.js`), one export per element type.

### 5.1 Section template

```
\section{<title>}
```
Fields: `title` (required, single line)

### 5.2 QuestionGroup template

```
\questiongroup{<title>}
<child elements, joined by \n>
\endquestiongroup
```
Fields: `title` (required, single line)  
Child ordering: questions in sequence, AI blocks interspersed where the user placed them.

### 5.3 Question template

```
\question{<prompt>}
[optional: \responsemode{<mode>}]
[optional: \aimode{<flags>}]
[response block — see 5.4]
[optional: \feedbackprompt{<text>}]
[optional: \sampleresponses{<text>}]
[optional: \followupprompt{<text>}]
[optional: score block — see 5.5]
\endquestion
```
Fields: `prompt` (required), `responseModeOverride` (optional), `aimodeOverride` (optional), `feedbackPrompt`, `sampleResponses`, `followupPrompt`, `scoreBlock`

### 5.4 Response block templates

| Type | Generated markup | Form fields |
|------|-----------------|-------------|
| Text response | `\textresponse{<n>}` | `lines` (integer, min 1) |
| Python | `\python[{timeout}]\n<code>\n\endpython` | `code` (multiline), `timeout` (optional ms) |
| Python Remote | same pattern with `\pythonremote` | same |
| Python Turtle | `\pythonturtle{<WxH>,<timeout>}\n<code>\n\endpythonturtle` | `width`, `height`, `timeout`, `code` |
| C++ | `\cpp[{timeout}]\n<code>\n\endcpp` | `code` (multiline), `timeout` (optional) |
| Multiple choice (graded) | `\multiplechoice{<correct>}\n\choice{...}\n...\n\endmultiplechoice` | `correctAnswer`, `choices[]` |
| Multiple choice (survey) | `\multiplechoice{multiple}\n\choice{...}\n...\n\endmultiplechoice` | `choices[]` |
| Table | `\table{<caption>}\n\row ...\n...\n\endtable` | `caption`, `rows[][]`, `editableCells[]` |

### 5.5 Score block template

```
\score{<points>,<type>}
<rubric lines>
\endscore
```
Fields: `points` (integer), `type` (select: response/code/output), `rubric` (multiline text)

### 5.6 Inline AI block template

```
\ai{<mode>}
\aimodel{<model>}
\aititle{<title>}
\aiprompt{<prompt>}
\aiguardrail{<guardrail>}
\aicontext{<context sources, comma-separated>}
\aiinput{<n>}
\endai
```
Fields: `mode` (select), `model` (select), `title`, `prompt`, `guardrail`, `contextSources[]` (checkboxes), `inputLines` (integer)

### 5.7 Preamble / document metadata template

All header fields appear once, before the first `\section`. Fields: `title`, `name`, `mode` (select), `studentLevel`, `activityContext`, `aiCodeGuidance`, `aiMode`, `language`, `retries`, `isTest` (boolean, only shown when mode=test). The template generates them in canonical order so the preamble never gets scrambled.

---

## 6. Validation Before Replace

The generated markup for each element is validated in two passes before the replace step proceeds:

**Pass 1 — Isolated parse**  
Wrap the generated element in a minimal valid document skeleton (add the required preamble and a dummy section/questiongroup wrapper if needed), run `parseSheetToBlocks`, and check for issues. If any errors appear, the Replace step is blocked and the errors are shown next to the form.

**Pass 2 — Full document parse**  
After the splice, run `parseSheetToBlocks` on the whole updated document text. If any new errors appear that were not present before the edit, roll back to the pre-extract text and surface the error.

Because the templates are derived from the spec, Pass 1 failures should be rare and only occur from invalid user input (e.g., an empty required field), not from malformed template output.

---

## 7. UI Layout

The visual editor is a new tab inside the existing editor, alongside the raw-text tab.

```
┌──────────────────────────────────────────────────────┐
│  Edit Activity: [title]        [Save] [Sandbox] ...  │
│  ┌────────┬────────────────────────────────────────┐ │
│  │ Source │ Visual                                 │ │
│  └────────┴────────────────────────────────────────┘ │
│                                                      │
│  [Visual tab active]                                 │
│  ┌──────────────────────────────────────────────┐   │
│  │ Preamble  ▼  [Edit]                          │   │
│  │  Title: For Loops  Mode: group  ...          │   │
│  ├──────────────────────────────────────────────┤   │
│  │ § Section 1: Introduction  [Edit] [+Group]   │   │
│  │  ┌───────────────────────────────────────┐   │   │
│  │  │ 🔵 Group: For Loop Basics  [Edit] [+Q]│   │   │
│  │  │  Q1. What does range(5) produce?  [✎] │   │   │
│  │  │  Q2. [Python code block]          [✎] │   │   │
│  │  └───────────────────────────────────────┘   │   │
│  │  [+ Add Question Group]                       │   │
│  ├──────────────────────────────────────────────┤   │
│  │ § Section 2: ...  [Edit] [+Group]  [↑] [↓]  │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

When the user clicks any `[Edit]` or `[✎]` button, an inline panel (or modal) opens with the form for that element type. The rest of the document is shown greyed out / locked while a form is open — only one element can be in edit mode at a time.

---

## 8. Reordering Elements

Sections, question groups, and questions can be reordered with up/down arrow buttons. This operation uses the existing `swapSourceRanges` function directly — no regeneration occurs. The source lines for the two adjacent elements are swapped wholesale.

Constraint: sections can only be reordered among other sections; groups can only be reordered within their own section (validated by `getSectionKeyAtLine`). Cross-section drag-and-drop is not supported in v1.

---

## 9. Adding New Elements

When the user clicks "+ Add Question" (inside a group), the editor:
1. Identifies the line of `\endquestiongroup` for that group
2. Opens a blank form for the question type
3. On Save, generates markup from the template + form values
4. Validates in isolation (Pass 1)
5. Splices the new markup on the line before `\endquestiongroup`
6. Runs full-document validate (Pass 2)

Adding a new question group works the same way targeting the `\endquestion` boundary of the last group in the section, then `\endsection` (if sections are explicit). Adding a new section targets the end of the last section.

New elements are never inserted at an arbitrary position — always at a structurally valid boundary determined by the parser output.

---

## 10. Deleting Elements

Deletion removes the source lines for the target element from the document, then runs the full-document parse. If that parse shows new errors, the deletion is blocked. For questions, the block includes from the `\question{...}` line through the matching `\endquestion`. For code blocks inside a question, the block spans from the opener (e.g., `\python`) through its `\endpython`.

A confirmation prompt is shown before any deletion. There is no undo in v1 — the user is advised to save before deleting.

---

## 11. Placeholder Token

During the EER edit-in-progress state, the extracted lines are replaced with:

```
% [VISUAL-EDITOR PLACEHOLDER: <elementType> lines <start>-<end>]
```

This is a comment in the markup language (starts with `%`, ignored by the parser). If the editor session is interrupted (navigation away, crash), the placeholder is detectable on next load and the document can be restored from the pre-extract backup held in `localStorage` under the key `activity-<id>-pre-edit`. The editor checks for this on mount and offers a "Restore pre-edit version" banner if found.

---

## 12. Changes to ActivityEditor.jsx

The existing raw-text editor tab is preserved unchanged. The visual editor is an additional `<Tab>` component. Switching tabs does not discard any in-progress edit — if a form is open and the user switches tabs, a warning is shown.

The raw-text tab already uses `localStorage` for autosave. The visual editor writes to the same `localStorage` key after every successful Replace, so the autosave is always the result of a valid edit.

The "Auto Correct" (AI repair) button is kept on the Source tab but removed from the Visual tab — the visual editor does not call the AI repair endpoint.

---

## 13. What Is Not Supported in v1

To maintain determinism and reliability, the following are intentionally out of scope for v1:

- Editing multi-line `\activitycontext` or `\aicodeguidance` values with complex inline formatting (`\textbf`, `\textit`, lists) — these are editable as plain text areas; formatting tags are preserved but not rendered in the form
- Drag-and-drop reordering (arrow buttons only)
- Cross-section question group moves
- Inline `\info` bubble placement (editing as raw text inside the question form)
- undo/redo history (pre-edit backup in localStorage is the sole safety net)
- Adding or editing `\file` and `\block` display-code blocks (kept as raw text in v1)

---

## 14. Implementation Order (Suggested)

1. **Document Model builder** — a function that takes `parseSheetToBlocks` output and attaches `lineRange` to each element. This is pure data work, no UI.
2. **Template functions** — one per element type in `markupTemplates.js`. Unit-testable in isolation, just like `swapSourceRanges`.
3. **EER engine** — `extract(sourceText, lineRange)` → `{ placeholder, extracted, backup }`, `replace(sourceText, placeholder, newMarkup)` → `newSourceText`. Unit-testable.
4. **Preamble editor form** — the simplest form; validates before touching structure.
5. **Question editor form** — the most-used form; covers most response types.
6. **Section / QuestionGroup name editor** — trivial forms, single field each.
7. **Reorder buttons** — thin wrapper around existing `swapSourceRanges`.
8. **Add / Delete** — uses EER engine with empty form initial state (Add) or zero-length replacement (Delete).
9. **Visual tab integration** — wire everything into a new tab in `ActivityEditor.jsx`.
10. **Placeholder recovery banner** — check `localStorage` on mount.

---

## 15. Key Invariants (The Editor Must Never Violate)

| Invariant | Enforcement |
|-----------|-------------|
| Every `\question` ends with `\endquestion` | Template always emits both; isolated parse checks before Replace |
| Every `\questiongroup` has `\endquestiongroup` | Same |
| Every `\questiongroup` is inside a `\section` | Document Model builder only produces groups inside sections; Add Group only targets a section boundary |
| Code block openers have matching closers | Template emits both opener and closer as a unit; cannot be split |
| Header fields appear exactly once | Preamble form replaces the entire preamble block; no duplicate detection needed |
| `\mode{test}` activates scoring requirements | When mode=test, the form requires `\score` blocks and generates them |
| Generated markup passes the full-document parse | Pass 2 rollback ensures this; no edit can leave the document in a parse-error state |

---

*End of design plan.*
