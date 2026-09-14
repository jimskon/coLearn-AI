/*
 * What language should this activity speak?
 *
 * Three answers, in order of authority:
 *
 *   1. the activity's own \language{...}
 *   2. the deployment's default (DEFAULT_ACTIVITY_LANGUAGE)
 *   3. English
 *
 * Before this file, step 3 was written out as the literal 'English' in
 * fourteen places -- four AI prompt builders, eight handler parameter
 * defaults, the parser, the run-activity loader -- and step 2 did not exist.
 * A Swedish-speaking deployment therefore had no way to say so once, and any
 * attempt to add one would have had to find all fourteen.
 *
 * The distinction that makes a deployment default possible at all: an activity
 * with no \language{} tag must report *nothing*, not 'English'. If the parser
 * fills the gap with 'English' the server can no longer tell "the author did
 * not say" from "the author said English", and the deployment default can
 * never apply. So the empty string means unset, everywhere, and only this
 * module turns unset into a real answer.
 */
(function attachActivityLanguage(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.coLearnActivityLanguage = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function factory() {

  /** The answer when nothing else has one. */
  const FALLBACK_LANGUAGE = 'English';

  /** The environment variable a deployment sets to change the default. */
  const LANGUAGE_ENV_VAR = 'DEFAULT_ACTIVITY_LANGUAGE';

  /**
   * A language name fit to drop into a prompt, or '' when there isn't one.
   *
   * The value reaches here from activity markup, so it can carry braces,
   * newlines and stray markup. It is interpolated into model instructions,
   * which is why it is flattened to a single short line rather than passed
   * through.
   */
  function normalizeLanguageName(value) {
    return String(value == null ? '' : value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/[{}\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  /**
   * The deployment default, or '' if this deployment has not set one.
   */
  function configuredDefaultLanguage(env) {
    const source = env || (typeof process !== 'undefined' ? process.env : null) || {};
    return normalizeLanguageName(source[LANGUAGE_ENV_VAR]);
  }

  /**
   * The language to actually use: the activity's own, else the deployment
   * default, else English.
   */
  function resolveActivityLanguage(activityLanguage, deploymentDefault) {
    return normalizeLanguageName(activityLanguage)
      || normalizeLanguageName(deploymentDefault)
      || FALLBACK_LANGUAGE;
  }

  return {
    FALLBACK_LANGUAGE,
    LANGUAGE_ENV_VAR,
    normalizeLanguageName,
    configuredDefaultLanguage,
    resolveActivityLanguage,
  };
}));
