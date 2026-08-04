# coLearn-AI / POGIL Markup Language Cheat Sheet

Full Specification

---

## Overview

This markup defines how to author interactive activities for coLearn-AI.

The system supports:

- Collaborative learning mode (AI-guided)
- Test / quiz mode (graded)
- Playground mode (all groups visible, saved per-student sandbox)
- Demo mode (all groups visible, temporary disposable session)
- Runnable Python blocks (with optional timeout)
- Runnable Python Remote blocks (with optional timeout)
- Runnable C++ blocks (with optional timeout)
- Runnable Python Turtle blocks (with window size + timeout)
- Read-only Python and C++ display blocks for examples that should be shown but not edited or run
- Editable and readonly file blocks
- Inline AI help blocks for guided student questions
- Structured AI feedback directives
- Structured scoring rubrics
- Tables with editable cells
- Images (with captions and width control)
- Hyperlinks

All interactive content must appear inside a `\questiongroup`.

---

## 1. Document Metadata

| Syntax | Description | Example |
|--------|-------------|---------|
| `\title{...}` | Activity display title | `\title{Greedy Algorithms Quiz}` |
| `\name{...}` | Unique internal identifier | `\name{greedyquiz}` |
| `\studentlevel{...}` | Target audience | `\studentlevel{Second Year}` |
| `\activitycontext{...}` | Introductory paragraph | `\activitycontext{This activity explores...}` |
| `\aicodeguidance{...}` | Global AI behavior rules | See AI Guidance section below |
| `\mode{group}` | Normal in-class group activity. This is also the default when no mode is set. | `\mode{group}` |
| `\mode{assignment}` | Project-style lab assignment mode. Drafts can use milestones and are usually sectionless unless the creator explicitly asks for sections. | `\mode{assignment}` |
| `\mode{test}` | Graded assessment mode. Same behavior as `\test`. | `\mode{test}` |
| `\mode{playground}` | Instructor/student experimentation mode. All question groups are visible, there is no submit button, and each student edits a saved personal workspace. | `\mode{playground}` |
| `\mode{demo}` | Temporary demo or conference mode. All question groups are visible, there is no submit button, and the session is meant to be disposable. | `\mode{demo}` |
| `\test` | Marks activity as graded assessment | `\test` |
| `\section{...}` | Structural heading (non-interactive) | `\section{Introduction}` |

Notes:

- If no mode is set, the activity runs as `\mode{group}`.
- `\mode{group}` is the normal collaborative activity mode: each question group must be submitted before the next one opens.
- `\mode{assignment}` is for project-style lab assignments. It is a good fit for milestone-based work, code building, and revision over time. It usually skips the section structure unless the creator explicitly wants sections.
- `\mode{test}` switches the activity into grading mode. `\test` is still supported as a legacy alias.
- `\mode{playground}` opens every question group at once, hides submit controls, and saves each student's answers/code separately so the work can be revisited later.
- `\mode{demo}` opens every question group at once, hides submit controls, and is intended for temporary or disposable demo sessions.
- `\aicodeguidance` controls follow-ups, scope restrictions, checker tolerance, etc.
- `\section` is structural only.

---

## 2. Question Groups

```text
\questiongroup{Greedy Algorithms}
...
\endquestiongroup
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\questiongroup{...}` | Starts a group of related questions | `\questiongroup{Greedy Algorithms}` |
| `\endquestiongroup` | Ends the group | `\endquestiongroup` |

All answerable items (`\question`, `\textresponse`, code blocks, file blocks) must be inside a `\questiongroup`.

---

## 3. Questions and Responses

```text
\question{What is a greedy algorithm?}
\textresponse{4}
\endquestion
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\question{...}` | Begins a question | `\question{Explain Dijkstra’s algorithm.}` |
| `\endquestion` | Ends the question (required) | `\endquestion` |
| `\responsemode{answer}` | Declares a normal answer question; optional because `answer` is the default | `\responsemode{answer}` |
| `\responsemode{questions}` | Declares a question-writing task where the student should submit questions instead of answers | `\responsemode{questions}` |
| `\textresponse{n}` | Student response box (n lines tall) | `\textresponse{5}` |
| `\sampleresponses{...}` | Sample instructor solution (hidden) | `\sampleresponses{Chooses a local optimum.}` |
| `\feedbackprompt{...}` | AI grading guidance | `\feedbackprompt{Encourage elaboration.}` |
| `\followupprompt{...}` | Optional AI follow-up hint | `\followupprompt{Why might greedy fail?}` |
| `\multiplechoice{...}` | Begins a multiple-choice block; the optional value is the legacy answer key | `\multiplechoice{Ottawa}` |
| `\choice{value}{points}` | A multiple-choice option with optional test-mode points | `\choice{Ottawa}{2}` |

Every `\question` must explicitly end with `\endquestion`.

Notes:

- If `\responsemode{...}` is omitted, the default is `answer`.
- Use `\responsemode{questions}` for prompts that ask students to list or write questions (for example, patient interview questions or follow-up questions).
- In test mode, include an explicit `\score{points,type}` rubric block for every question that is not self-scoring multiple choice. Use only `response`, `code`, and `output` as score types.
- Scoring rubrics are documented in Section 5 below. A `\score{points,type}` block gives the grader the points possible and the grading category for a question.
- A blank `\multiplechoice{}` with unscored `\choice{...}` entries is a survey and remains ungraded. For self-scoring multiple choice (including partial credit), put points on every choice, such as `\choice{Partly correct}{1}`. The highest choice value becomes the question total; do not also add a `\score{...,response}` block.

---

## 3A. Inline AI Help Blocks

```text
\ai{explain}
\aititle{AI Coach}
\aiprompt{Ask the AI for help understanding what this code does.}
\aiguardrail{Help the student reason about the code without giving away the whole worksheet answer.}
\aicontext{current-question,current-code,student-response}
\aiinput{5}
\endai
```

`\\ai` blocks are currently supported only inside a `\\question`.

| Syntax | Description | Example |
|--------|-------------|---------|
| `\ai{mode}` | Starts an inline AI help block | `\ai{explain}` |
| `\aititle{...}` | Visible card title | `\aititle{AI Coach}` |
| `\aiprompt{...}` | Student-facing instructions | `\aiprompt{Ask the AI for help interpreting the loop.}` |
| `\aiguardrail{...}` | Creator-facing AI restriction / scope | `\aiguardrail{Guide the student but do not provide the final worksheet answer.}` |
| `\aicontext{...}` | Comma-separated context sources | `\aicontext{current-question,current-code}` |
| `\aiinput{n}` | Student input box height (minimum 2) | `\aiinput{5}` |
| `\endai` | Ends the AI help block | `\endai` |

### Supported Initial Modes

- `explain`
- `critique`
- `testgen`
- `generate`

### Supported Initial Context Sources

- `current-question`
- `current-code`
- `student-response`
- `nearby-text`

### Example

```text
\question{What does this loop do?}
\textresponse{4}

\python
for i in range(5):
    print(i * 2)
\endpython

\ai{explain}
\aititle{AI Coach}
\aiprompt{If you are unsure, ask the AI for help understanding the loop.}
\aiguardrail{Explain the behavior of the code and guide the student toward the pattern. Do not give away broader worksheet answers.}
\aicontext{current-question,current-code,student-response}
\aiinput{5}
\endai

\endquestion
```

---

## 4. Info Bubbles

```text
\info{target,seconds}{message}
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\info{target,seconds}{message}` | Short contextual help bubble rendered as a transient overlay near the target | `\info{textresponse,10}{The active student types here.}` |

### Supported Targets

- `questiongroup`
- `question`
- `textresponse`
- `coderesponse`
- `submitbutton`
- `aifeedback`

### Behavior

- `seconds` controls how long the bubble remains visible.
- The bubble fades in after a short delay and overlays the activity rather than taking up inline space.
- If `seconds` is missing or invalid, the bubble defaults to 8 seconds.
- Keep messages very short when possible, ideally about 5-12 words.
- The runtime may show only one bubble at a time and will favor action-oriented targets over section headings.
- Avoid long instructions or rubrics in `\info`; keep it as a short coach mark.
- The message supports the same limited safe inline formatting as the rest of the markup parser.
- Bubbles are dismissible with a close button.
- `textresponse` and `coderesponse` bubbles dismiss when the student starts typing.
- Repeated target types may only appear once per page session.
- Bubbles are local UI state only and can reappear after refresh.

### First-Draft Limitations

- Dismissed state is not saved anywhere.
- Placement is intentionally simple and may be approximate for some targets.
- `submitbutton` bubbles are shown near submit controls in run mode; in preview they may appear near the related group/question area.
- Top-level global infos outside a `\questiongroup` are ignored.

### Examples

```text
\questiongroup{Exploration}
\info{questiongroup,8}{This section is collaborative. One student types while others observe and discuss.}
...
\endquestiongroup
```

```text
\question{What does this program print?}
\info{question,5}{Read the code carefully before answering.}
\textresponse{4}
\info{textresponse,10}{The active student types here. Observers see the answer update live.}
\feedbackprompt{Check whether the student explained both the variable update and the final printed value.}
\info{aifeedback,10}{This AI feedback is meant to guide revision before continuing.}
\endquestion
```

---

## 5. Scoring Blocks (Assessment Mode)

```text
\score{6,response}
6: Clear, correct explanation with example
3-5: Mostly correct
1-2: Partial understanding
0: Incorrect or missing
\endscore
```

### Scoring Syntax

| Syntax | Description | Example |
|--------|-------------|---------|
| `\score{points,type}` | Begins grading rubric | `\score{5,response}` |
| `\endscore` | Ends scoring block | `\endscore` |

### Meaning of `type`

| Type | Meaning | Example |
|------|---------|---------|
| `response` | Written answer | `\score{6,response}` |
| `code` | Student-written code | `\score{10,code}` |
| `output` | Program output | `\score{4,output}` |

Multiple-choice questions also use `response`; do not invent a separate `choice` score type.

Scoring is controlled only by `\score{}` blocks.

---

## 6. Lists

```text
\begin{itemize}
\item First item
\item Second item
\end{itemize}

\begin{enumerate}
\item Step one
\item Step two
\end{enumerate}
```

Nested lists are discouraged in current sheet rendering.

---

## 7. Text Formatting

| Syntax | Description | Example |
|--------|-------------|---------|
| `\text{...}` | Paragraph | `\text{This is a paragraph.}` |
| `\textbf{...}` | Bold text | `\textbf{Important}` |
| `\textit{...}` | Italic text | `\textit{Optional}` |

---

## 8. Tables

```text
\table{Example Table}
\row Name & Age & Major
\row Alice & 20 & \tresponse
\row Bob & 21 & Computer Science
\endtable
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\table{caption}` | Begins table | `\table{Student Data}` |
| `\row ...` | Defines row (cells separated by `&`) | `\row Alice & 20 & CS` |
| `\endtable` | Ends table | `\endtable` |
| `\tresponse` | Editable cell marker | `\row Alice & 20 & \tresponse` |

---

## 9. Code Blocks

### Python

Supports optional timeout: `\python{50000}`

```text
\python
# code here
\endpython
```

### Python Display

Use this when you want to show Python code without letting students edit or run it.

```text
\pythondisplay
# read-only example code
\endpythondisplay
```

### Python Remote

Runs on the server with the same file-handling pattern as C++.

Supports optional timeout: `\pythonremote{50000}`

```text
\pythonremote
import pandas as pd
\endpythonremote
```

### C++

Supports optional timeout: `\cpp{50000}`

```text
\cpp
#include <iostream>
int main() { }
\endcpp
```

### C++ Display

Use this when you want to show C++ code without letting students edit or run it.

```text
\cppdisplay
#include <iostream>
int main() { }
\endcppdisplay
```

---

## 10. Python Turtle

Supports window size + timeout:

```text
\pythonturtle{900x600,50000}
# turtle code here
\endpythonturtle
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\pythonturtle{WxH,timeout}` | Turtle window size + timeout | `\pythonturtle{900x600,50000}` |
| `\endpythonturtle` | Ends turtle block | `\endpythonturtle` |

---

## 11. Images

```text
\image{URL}
\image{URL}{Caption}
\image{URL}{Caption}{50%}
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\image{URL}` | Image only | `\image{https://...}` |
| `\image{URL}{Caption}` | Image with caption | `\image{...}{Example}` |
| `\image{URL}{Caption}{Width}` | Image with width | `\image{...}{Example}{50%}` |

---

## 12. Hyperlinks

```text
\link{URL}{Text}
```

| Syntax | Description | Example |
|--------|-------------|---------|
| `\link{URL}{Text}` | Hyperlink | `\link{https://...}{Read more}` |

---

## Core Design Principles

1. All interactive content must be inside `\questiongroup`.
2. Every `\question` must end with `\endquestion`.
3. Learning tags never grade.
4. Grading is controlled only by `\score{}`.
5. AI must respond only to what students actually submit.
6. No scope creep beyond stated requirements.
7. Python Turtle is a first-class execution environment.
