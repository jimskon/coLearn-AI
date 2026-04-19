import { findAllResponseEls, readResponseValue, assertUniqueResponseKeys } from "./responseDom";

export function collectResponses(root) {
  if (!root) throw new Error("collectResponses: root is null");

  // Catch “oops, rendered the same key twice” early
  assertUniqueResponseKeys(root);

  const out = {};
  const els = findAllResponseEls(root);

  for (const el of els) {
    const key = el.getAttribute("data-response-key");
    if (!key) continue;

    const val = readResponseValue(el);
    // normalize null -> "" if you prefer
    out[key] = val ?? "";
  }
  return out;
}
