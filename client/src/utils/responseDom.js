// client/src/utils/responseDom.js

export function makeResponseAttrs({ key, kind, qid = "", group = "", role = "" }) {
  return {
    "data-response-key": key,
    "data-response-kind": kind,
    ...(qid ? { "data-qid": qid } : {}),
    ...(group ? { "data-group": String(group) } : {}),
    ...(role ? { "data-role": role } : {}),
  };
}

export function findResponseEl(root, key) {
  if (!root) throw new Error("findResponseEl: root is null");
  return root.querySelector(`[data-response-key="${cssEscape(key)}"]`);
}

export function findAllResponseEls(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(`[data-response-key]`));
}

export function readResponseValue(el) {
  if (!el) return null;
  // inputs/textarea/select
  if ("value" in el) return el.value;
  // contenteditable fallback
  if (el.getAttribute("contenteditable") === "true") return el.textContent ?? "";
  return null;
}

export function assertUniqueResponseKeys(root, { allowOutsideRoot = false } = {}) {
  const els = findAllResponseEls(root);
  const map = new Map();
  for (const el of els) {
    const k = el.getAttribute("data-response-key");
    if (!k) continue;
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(el);
  }
  const dups = [...map.entries()].filter(([, arr]) => arr.length > 1);
  if (dups.length) {
    const msg = dups.map(([k, arr]) => `${k}(${arr.length})`).join(", ");
    throw new Error(`Duplicate data-response-key(s) in scope: ${msg}`);
  }

  if (allowOutsideRoot) return;

  // Optional: enforce that *all* known keys are inside root (depends on your design)
}

function cssEscape(s) {
  // minimal escape for quotes/backslashes
  return String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
