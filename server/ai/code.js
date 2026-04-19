// server/ai/code.js
//const { callLLMJsonStrict } = require("./controller");

const MAX_DOC_CHARS = 200_000;

const STRUCTURAL_CODES = new Set([
    "UNCLOSED_QUESTION",
    "UNCLOSED_ITEMIZE",
    "UNCLOSED_QUESTIONGROUP",
    "ENDQUESTION_WITHOUT_START",
    "END_ITEMIZE_WITHOUT_START",
    "END_QUESTIONGROUP_WITHOUT_START",
    "NESTED_ITEMIZE",          // renderer can’t handle
    "SCORE_OUTSIDE_QUESTION",
    "QUESTION_OUTSIDE_QUESTIONGROUP",
    "UNCLOSED_PYTHON",
    "UNCLOSED_CPP",
    "ENDPYTHON_WITHOUT_START",
    "ENDCPP_WITHOUT_START",
    "UNCLOSED_FILE",
    "ENDFILE_WITHOUT_START",
    "UNCLOSED_BLOCK",
    "ENDBLOCK_WITHOUT_START",
]);

function contract(proposedDocText, summary = [], warnings = []) {
    return {
        proposedDocText: typeof proposedDocText === "string" ? proposedDocText : "",
        summary: Array.isArray(summary) ? summary.filter((s) => typeof s === "string") : [],
        warnings: Array.isArray(warnings) ? warnings.filter((w) => typeof w === "string") : [],
    };
}

function badRequest(res, msg) {
    return res.status(400).json(contract("", [], [msg]));
}

function preflightValidateMarkup(docText) {
    const issues = [];

    const lines = String(docText || "").split(/\r?\n/);

    // Simple stacks for structural matching
    const questionStack = [];
    const itemizeStack = [];
    const qgroupStack = [];
    const pythonStack = [];
    const cppStack = [];
    const fileStack = [];
    const blockStack = [];

    // Track illegal “top-level” blocks (very conservative heuristics)
    let currentContext = { inQGroup: false, inQuestion: false };

    const pushIssue = (code, message, lineNum) => {
        issues.push({
            code,
            message,
            line: lineNum != null ? lineNum : null,
        });
    };

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const line = lines[i];

        // Normalize a trimmed view for tag detection
        const t = line.trim();

        // --- questiongroup tracking ---
        if (/^\\questiongroup\{/.test(t)) {
            qgroupStack.push({ line: lineNum });
            currentContext.inQGroup = true;
        }
        if (/^\\endquestiongroup\b/.test(t)) {
            if (!qgroupStack.length) {
                pushIssue("END_QUESTIONGROUP_WITHOUT_START", "\\endquestiongroup without matching \\questiongroup{...}", lineNum);
            } else {
                qgroupStack.pop();
            }
            currentContext.inQGroup = qgroupStack.length > 0;
        }

        // --- question tracking ---
        if (/^\\question\{/.test(t)) {
            if (!currentContext.inQGroup) {
                pushIssue(
                    "QUESTION_OUTSIDE_QUESTIONGROUP",
                    "\\question{...} must appear inside \\questiongroup{...}.",
                    lineNum
                );
            }
            questionStack.push({ line: lineNum });
            currentContext.inQuestion = true;
        }
        if (/^\\endquestion\b/.test(t)) {
            if (!questionStack.length) {
                pushIssue("ENDQUESTION_WITHOUT_START", "\\endquestion without matching \\question{...}", lineNum);
            } else {
                questionStack.pop();
            }
            currentContext.inQuestion = questionStack.length > 0;
        }

        // 2) Scores must be inside a question
        if (/^\\score\{/.test(t) && !currentContext.inQuestion) {
            pushIssue(
                "SCORE_OUTSIDE_QUESTION",
                "\\score{...} must appear inside a \\question{...} ... \\endquestion block.",
                lineNum
            );
        }

        // Optional: if you have \\endscore or a score block, add similar checks.
        // --- itemize nesting detection ---
        if (/^\\begin\{itemize\}/.test(t)) {
            // If already inside itemize, that’s nested lists (your renderer can’t handle it)
            if (itemizeStack.length > 0) {
                pushIssue("NESTED_ITEMIZE", "Nested \\begin{itemize} detected (nested lists are not supported).", lineNum);
            }
            itemizeStack.push({ line: lineNum });
        }
        if (/^\\end\{itemize\}/.test(t)) {
            if (!itemizeStack.length) {
                pushIssue("END_ITEMIZE_WITHOUT_START", "\\end{itemize} without matching \\begin{itemize}", lineNum);
            } else {
                itemizeStack.pop();
            }
        }
        if (/^\\python\b/i.test(t)) pythonStack.push({ line: lineNum });
        if (/^\\endpython\b/i.test(t)) {
            if (!pythonStack.length) pushIssue("ENDPYTHON_WITHOUT_START", "\\endpython without matching \\python", lineNum);
            else pythonStack.pop();
        }

        if (/^\\cpp\b/i.test(t)) cppStack.push({ line: lineNum });
        if (/^\\endcpp\b/i.test(t)) {
            if (!cppStack.length) pushIssue("ENDCPP_WITHOUT_START", "\\endcpp without matching \\cpp", lineNum);
            else cppStack.pop();
        }

        // --- file blocks ---
        if (/^\\file\{/.test(t)) fileStack.push({ line: lineNum });
        if (/^\\endfile\b/.test(t)) {
            if (!fileStack.length) pushIssue("ENDFILE_WITHOUT_START", "\\endfile without matching \\file{...}", lineNum);
            else fileStack.pop();
        }

        // --- block blocks ---
        if (/^\\block\{/.test(t)) blockStack.push({ line: lineNum });
        if (/^\\endblock\b/.test(t)) {
            if (!blockStack.length) pushIssue("ENDBLOCK_WITHOUT_START", "\\endblock without matching \\block{...}", lineNum);
            else blockStack.pop();
        }

    }

    for (const p of pythonStack) pushIssue("UNCLOSED_PYTHON", "Unclosed \\python (missing \\endpython).", p.line);
    for (const c of cppStack) pushIssue("UNCLOSED_CPP", "Unclosed \\cpp (missing \\endcpp).", c.line);
    for (const f of fileStack) pushIssue("UNCLOSED_FILE", "Unclosed \\file{...} (missing \\endfile).", f.line);
    for (const b of blockStack) pushIssue("UNCLOSED_BLOCK", "Unclosed \\block{...} (missing \\endblock).", b.line);
    // Unclosed stacks
    if (questionStack.length) {
        for (const q of questionStack) {
            pushIssue("UNCLOSED_QUESTION", "Unclosed \\question{...} (missing \\endquestion).", q.line);
        }
    }
    if (itemizeStack.length) {
        for (const it of itemizeStack) {
            pushIssue("UNCLOSED_ITEMIZE", "Unclosed \\begin{itemize} (missing \\end{itemize}).", it.line);
        }
    }
    if (qgroupStack.length) {
        for (const g of qgroupStack) {
            pushIssue("UNCLOSED_QUESTIONGROUP", "Unclosed \\questiongroup{...} (missing \\endquestiongroup).", g.line);
        }
    }

    return issues;
}

function issuesToWarnings(issues) {
    return issues.map((it) => `[${it.code}] line ${it.line ?? "?"}: ${it.message}`);
}

const BOUNDARY_TAGS = new Set([
    "title", "name", "studentlevel", "activitycontext", "aicodeguidance", "section",
    "questiongroup", "endquestiongroup",
    "question", "endquestion",
    "textresponse", "sampleresponses", "feedbackprompt", "followupprompt",
    "score",
    "python", "endpython",
    "cpp", "endcpp",
    "file", "endfile",
    "block", "endblock",
    "table", "endtable", "row",
    "image", "link",
]);

function braceFixPass(docText) {
    const lines = String(docText || "").split(/\r?\n/);
    const out = [...lines];
    const summary = [];
    const warnings = [];

    // We only enforce: a \tag{ opener must be closed before the next \tag... line.
    // But ignore inside "protected blocks" where braces are normal code/data.
    let protectedStack = []; // values: 'python'|'cpp'|'file'|'block'

    const isProtected = () => protectedStack.length > 0;

    const pushProtIfStart = (t, lineNum) => {
        if (/^\\python\b/i.test(t)) protectedStack.push({ type: "python", line: lineNum });
        else if (/^\\cpp\b/i.test(t)) protectedStack.push({ type: "cpp", line: lineNum });
        else if (/^\\file\{/.test(t)) protectedStack.push({ type: "file", line: lineNum });
        else if (/^\\block\{/.test(t)) protectedStack.push({ type: "block", line: lineNum });
    };

    const popProtIfEnd = (t) => {
        if (/^\\endpython\b/i.test(t) && protectedStack.at(-1)?.type === "python") protectedStack.pop();
        else if (/^\\endcpp\b/i.test(t) && protectedStack.at(-1)?.type === "cpp") protectedStack.pop();
        else if (/^\\endfile\b/i.test(t) && protectedStack.at(-1)?.type === "file") protectedStack.pop();
        else if (/^\\endblock\b/i.test(t) && protectedStack.at(-1)?.type === "block") protectedStack.pop();
    };

    const getTagName = (t) => {
        const m = t.match(/^\\([A-Za-z]+)\b/);
        return m ? m[1] : null;
    };

    const isBoundaryTagLine = (t) => {
        const name = getTagName(t);
        return name && BOUNDARY_TAGS.has(name);
    };

    const isTagWithBraceOpen = (t) => /^\\[A-Za-z]+(?:\*?)\{/.test(t);

    // One outstanding “brace-opened tag” at a time, per your rule.
    let pending = null; // { lineNum, tagName }

    const closePendingBefore = (beforeLineNum) => {
        if (!pending) return;

        // Insert '}' at end of the line right before beforeLineNum (or at pending line if needed)
        const insertAt = pending.lineNum; // always close on opener line
        out[insertAt - 1] = (out[insertAt - 1] ?? "") + "}";

        summary.push(`Inserted missing "}" to close \\${pending.tagName}{...} (opened line ${pending.lineNum}) before line ${beforeLineNum}.`);
        warnings.push(`Auto-closed missing "}" for \\${pending.tagName}{ opened at line ${pending.lineNum} before line ${beforeLineNum}.`);
        pending = null;
    };

    const braceBalanceFromFirstOpen = (t) => {
        const idx = t.indexOf("{");
        if (idx < 0) return 0;
        const rest = t.slice(idx);
        let bal = 0;
        for (const ch of rest) {
            if (ch === "{") bal++;
            else if (ch === "}") bal--;
            if (bal === 0) break; // closed within the line
        }
        return bal; // >0 means missing at least one }
    };

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const t = String(lines[i] ?? "").trim();

        // maintain protected stack first
        pushProtIfStart(t, lineNum);
        if (isProtected()) {
            popProtIfEnd(t);
            continue;
        }

        // If we hit ANY new tag line and we have a pending brace-open, close it first.
        if (pending && isBoundaryTagLine(t)) {
            closePendingBefore(lineNum);
        }

        // If this line starts a \tag{, check if it closes on the same line.
        if (isTagWithBraceOpen(t)) {
            const m = t.match(/^\\([A-Za-z]+(?:\*?))\{/);
            const tagName = m ? m[1] : "tag";
            const bal = braceBalanceFromFirstOpen(t);

            if (bal > 0) {
                // missing closing } somewhere before next tag line
                pending = { lineNum, tagName };
            } else {
                pending = null;
            }
        }

        // End protected block if on this line (rare because we continue above, but safe)
        popProtIfEnd(t);
    }

    // If doc ends with a pending open brace tag, close at EOF.
    if (pending) {
        const lastLineNum = lines.length;
        out[lastLineNum - 1] = (out[lastLineNum - 1] ?? "") + "}";
        summary.push(`Inserted missing "}" to close \\${pending.tagName}{...} at EOF (opened line ${pending.lineNum}).`);
        warnings.push(`Auto-closed missing "}" for \\${pending.tagName}{ opened at line ${pending.lineNum} at EOF.`);
        pending = null;
    }

    return {
        text: out.join("\n"),
        summary,
        warnings,
        changed: summary.length > 0,
    };
}

function repairPass(docText) {
    const lines = String(docText || "").split(/\r?\n/);
    const out = [];
    const summary = [];
    const warnings = [];

    // Stack of open blocks: { type, line }
    const stack = [];

    const startMatchers = [
        { type: "questiongroup", re: /^\\questiongroup\{/ },
        { type: "question", re: /^\\question\{/ },
        { type: "itemize", re: /^\\begin\{itemize\}/ },
        { type: "file", re: /^\\file\{/ },
        { type: "block", re: /^\\block\{/ },
        { type: "python", re: /^\\python\b/i },
        { type: "cpp", re: /^\\cpp\b/i },
    ];

    const endMatchers = [
        { type: "questiongroup", re: /^\\endquestiongroup\b/, endLine: "\\endquestiongroup" },
        { type: "question", re: /^\\endquestion\b/, endLine: "\\endquestion" },
        { type: "itemize", re: /^\\end\{itemize\}/, endLine: "\\end{itemize}" },
        { type: "file", re: /^\\endfile\b/, endLine: "\\endfile" },
        { type: "block", re: /^\\endblock\b/, endLine: "\\endblock" },
        { type: "python", re: /^\\endpython\b/i, endLine: "\\endpython" },
        { type: "cpp", re: /^\\endcpp\b/i, endLine: "\\endcpp" },
    ];

    const top = () => stack[stack.length - 1] || null;
    const hasOpen = (type) => stack.some((b) => b.type === type);
    const nearestOpen = (type) => {
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i].type === type) return i;
        return -1;
    };

    function closeTop(reason, insertBeforeLineNum) {
        const b = stack.pop();
        if (!b) return;

        const end = endMatchers.find((e) => e.type === b.type);
        if (!end) return;

        out.push(end.endLine);
        summary.push(`Inserted ${end.endLine} (${reason}).`);
        warnings.push(`Auto-closed ${b.type} opened at line ${b.line} before line ${insertBeforeLineNum}.`);
    }

    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const t = lines[i].trim();

        // Detect starts
        const start = startMatchers.find((m) => m.re.test(t));
        if (start) {
            // Rule: question must be inside questiongroup
            if (start.type === "question" && !hasOpen("questiongroup")) {
                warnings.push(`\\question starts outside \\questiongroup at line ${lineNum}.`);
            }

            // Rule: no nested itemize
            if (start.type === "itemize" && hasOpen("itemize")) {
                warnings.push(`Nested itemize detected at line ${lineNum} (not supported).`);
                // We do NOT auto-fix nesting; just warn.
            }

            // If starting a new question while another question is open, auto-close previous question
            if (start.type === "question" && hasOpen("question")) {
                // Close only the nearest open question (top should usually be question)
                const idx = nearestOpen("question");
                // Close blocks above it first (conservative)
                while (stack.length - 1 > idx) closeTop("closing inner block before starting new question", lineNum);
                closeTop("missing end before new \\question", lineNum);
            }

            // If starting a new questiongroup while one is open, auto-close previous group
            if (start.type === "questiongroup" && hasOpen("questiongroup")) {
                const idx = nearestOpen("questiongroup");
                while (stack.length - 1 > idx) closeTop("closing inner block before starting new questiongroup", lineNum);
                closeTop("missing end before new \\questiongroup", lineNum);
            }

            stack.push({ type: start.type, line: lineNum });
            out.push(lines[i]);
            continue;
        }

        // Detect ends
        const end = endMatchers.find((m) => m.re.test(t));
        if (end) {
            const idx = nearestOpen(end.type);
            if (idx < 0) {
                // Unmatched end tag: keep it but warn (or drop it if you prefer)
                warnings.push(`Unmatched ${end.endLine} at line ${lineNum}.`);
                out.push(lines[i]);
                continue;
            }

            // Close any inner blocks above it first
            while (stack.length - 1 > idx) closeTop("closing inner block to match explicit end tag", lineNum);

            // Pop the matching block and keep the explicit end line
            stack.pop();
            out.push(lines[i]);
            continue;
        }

        // Normal line
        out.push(lines[i]);
    }

    // Close remaining open blocks at EOF
    while (stack.length) {
        const b = top();
        closeTop("missing end at EOF", lines.length + 1);
        // closeTop already popped; loop continues
    }

    return {
        text: out.join("\n"),
        summary,
        warnings,
        changed: summary.length > 0,
    };
}

async function repairMarkup(req, res) {
    try {
        const { docText, mode, notes, rules } = req.body ?? {};

        if (typeof docText !== "string" || docText.trim().length === 0) {
            return badRequest(res, "docText is required and must be a non-empty string.");
        }
        if (docText.length > MAX_DOC_CHARS) {
            return badRequest(res, `docText is too large (max ${MAX_DOC_CHARS} chars).`);
        }
        if (mode !== undefined && mode !== "activity" && mode !== "test") {
            return badRequest(res, 'mode must be "activity" or "test" if provided.');
        }
        if (notes !== undefined && typeof notes !== "string") {
            return badRequest(res, "notes must be a string if provided.");
        }
        if (rules !== undefined && (!Array.isArray(rules) || rules.some((r) => typeof r !== "string"))) {
            return badRequest(res, "rules must be an array of strings if provided.");
        }

        // Pass 0: brace repair (must happen before structural repair)
        const pass0 = braceFixPass(docText);
        const afterBraces = pass0.changed ? pass0.text : docText;

        // Pass 1: structural repair (end tags, nesting, etc)
        const pass1 = repairPass(afterBraces);
        const repaired = pass1.changed ? pass1.text : afterBraces;

        // Preflight after repair
        const issues = preflightValidateMarkup(repaired);

        // Separate structural vs policy
        const structural = issues.filter(i => STRUCTURAL_CODES.has(i.code));
        const policyOnly = issues.filter(i => !STRUCTURAL_CODES.has(i.code));

        // Merge everything deterministically
        const summary = [
            ...(pass0.summary || []),
            ...(pass1.summary || []),
        ];

        const warnings = [
            ...(pass0.warnings || []),
            ...(pass1.warnings || []),
            ...issuesToWarnings(structural),
            ...issuesToWarnings(policyOnly),
        ];

        return res.json(contract(repaired, summary, warnings));

    } catch (err) {
        console.error("❌ /code/repair-markup failed:", err);
        // Still return 200 with original doc to keep UI reliable
        const fallback = typeof req.body?.docText === "string" ? req.body.docText : "";
        return res.json(contract(
            fallback,
            [],
            ["Repair pass crashed; returned original docText."]
        ));
    }
}

module.exports = { repairMarkup };