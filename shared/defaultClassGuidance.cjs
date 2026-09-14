/*
 * The system-default AI feedback policy for a class.
 *
 * Shared so the server and the browser cannot drift. The server falls back to
 * this whenever a class stores no ai_guidance of its own, and the Manage
 * Classes dialog shows it as the placeholder and as the starting text when an
 * instructor chooses to edit it. Those two must be the same words: the dialog
 * presents the text as "the system default", so a stale copy would tell
 * instructors their activities behave in a way they do not.
 */
(function attachDefaultClassGuidance(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnDefaultClassGuidance = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {
  const DEFAULT_CLASS_GUIDANCE = "Accept any response that shows the student is engaging with the question and thinking about the concept. Only push back when a response is gibberish, completely off-prompt, contains a clear error, or fails the single core requirement of the question. When pushing back, ask one focused question or suggest one small addition — never list multiple failures. Do not demand completeness, perfect wording, or extra detail beyond what the question asks for. Do not request input validation, error handling, refactoring, or extra features. Do not evaluate variable-name style. If the checker encounters an internal error, allow the group to continue.";

  return { DEFAULT_CLASS_GUIDANCE };
}));
