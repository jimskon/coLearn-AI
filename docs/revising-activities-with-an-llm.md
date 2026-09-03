# Revising a whole activity with an LLM

The Creator Workbench used to have a **Revise Draft** button: you described a
change, the server sent the activity to a model, and whatever came back replaced
the document.

It was removed. Two reasons.

**It failed silently.** The model returned a complete-looking activity that had
quietly dropped sample answers, feedback prompts and rubrics — the parts
students never see, which is exactly why a model treats them as scaffolding.
A truncated or thinned response still started with `\title{` and still parsed,
so nothing downstream could tell the difference between a good revision and a
lossy one.

**One blind shot is the wrong shape for the job.** A rewrite worth making
usually takes a few rounds of "no, keep the C++ example" — a conversation. The
in-app version could not have one.

So the app now does the two things it is actually well placed to do: hand you a
correct briefing for the model, and refuse to write back a result without
telling you what it removes. The model in between is yours to choose.

Per-question revision is unchanged. It stays in the app because one question is
small enough to read in full before accepting, and a bad one cannot damage the
rest of the document.

## The workflow

1. **Duplicate First** (optional, recommended for large rewrites). Makes a copy
   of the activity in the same class and opens it. Work on the copy, test-run
   it, and only then bring the change over. The original — and any student work
   attached to it — is untouched throughout.
2. **Copy for LLM.** Puts the complete activity on your clipboard, preceded by
   a briefing: the tag vocabulary, how blocks pair and close, the fixed value
   sets, and the rules that matter most (return the whole document; do not
   remove anything you were not asked to remove; do not invent tags).
3. Paste that into your LLM. Replace the `<<< describe your change here >>>`
   line with what you want. Iterate as long as you like.
4. **Paste the result back** into the box in the Creator Workbench and press
   **Review Pasted Revision.** Fences and surrounding chatter are stripped
   automatically — you do not have to clean the reply up by hand.
5. The revision loads as a **pending proposal**: the workbench previews it, the
   left panel lists what changed, and everything else is locked until you decide.
   If the revision removes anything, it is listed explicitly.
6. **Accept** or **Reject.** Accepting asks once more to confirm any removals.
   Rejecting leaves the activity exactly as it was.

## What the briefing contains

Not a hand-maintained copy of the syntax. `shared/llmRevisionPrimer.cjs` builds
it from `shared/activityGrammar.cjs`, the single syntax authority — the tag
lists, the closers, and the value sets are read from the grammar at runtime, so
a tag added to the language cannot go missing from the instructions a model is
given. Only the prose around them is written by hand.

`server/tests/llmRevisionPrimer.test.js` asserts that every tag the grammar
defines appears in the briefing, so the two cannot drift apart quietly.

## If the paste-back is refused

- **"Resolve parser errors before accepting this proposal."** The revision does
  not parse. The preview shows where. Usually a dropped `\endquestion` or an
  invented tag — paste the error back to the model and ask it to fix it.
- **A removal list you did not expect.** The model dropped something. Ask it to
  return the document again with that content restored, rather than accepting
  and re-adding by hand; the list tells you exactly what to name.
- **The clipboard button does nothing.** Some browsers refuse clipboard access
  on an insecure origin. The workbench falls back to opening the Source pane so
  you can select and copy the markup yourself — but you then only have the
  activity, not the briefing.

## Advanced settings

The **Advanced** dialog's *Apply to Draft* used to route through the same
whole-activity AI revision — risking the entire document to change two lines.
It now edits the `\language{}` and `\retries{}` headers directly. Difficulty and
info boxes remain generation-time hints; they guide a new draft and have no
markup to apply to an existing one.
