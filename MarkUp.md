# coLearn-AI / POGIL Markup Language Cheat Sheet

Full Specification

---

## Overview

This markup defines how to author interactive activities for coLearn-AI.

The system supports:

- Collaborative learning mode (AI-guided)
- Test / quiz mode (graded)
- Runnable Python blocks (with optional timeout)
- Runnable C++ blocks (with optional timeout)
- Runnable Python Turtle blocks (with window size + timeout)
- Editable and readonly file blocks
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
| `\test` | Marks activity as graded assessment | `\test` |
| `\section{...}` | Structural heading (non-interactive) | `\section{Introduction}` |

Notes:

- `\test` switches the activity into grading mode.
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
| `\textresponse{n}` | Student response box (n lines tall) | `\textresponse{5}` |
| `\sampleresponses{...}` | Sample instructor solution (hidden) | `\sampleresponses{Chooses a local optimum.}` |
| `\feedbackprompt{...}` | AI grading guidance | `\feedbackprompt{Encourage elaboration.}` |
| `\followupprompt{...}` | Optional AI follow-up hint | `\followupprompt{Why might greedy fail?}` |

Every `\question` must explicitly end with `\endquestion`.

---

## 4. Scoring Blocks (Assessment Mode)

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
| custom | Custom metadata | `\score{5,analysis}` |

Scoring is controlled only by `\score{}` blocks.

---

## 5. Lists

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

## 6. Text Formatting

| Syntax | Description | Example |
|--------|-------------|---------|
| `\text{...}` | Paragraph | `\text{This is a paragraph.}` |
| `\textbf{...}` | Bold text | `\textbf{Important}` |
| `\textit{...}` | Italic text | `\textit{Optional}` |

---

## 7. Tables

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

## 8. Code Blocks

### Python

Supports optional timeout: `\python{50000}`

```text
\python
# code here
\endpython
```

### C++

Supports optional timeout: `\cpp{50000}`

```text
\cpp
#include <iostream>
int main() { }
\endcpp
```

---

## 9. Python Turtle

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

## 10. Images

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

## 11. Hyperlinks

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
