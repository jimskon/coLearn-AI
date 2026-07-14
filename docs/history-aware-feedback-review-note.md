# History-Aware Feedback Review Note

## Goal
Make AI feedback feel like a continuing tutoring conversation for a collaborative group instead of a one-off reply.

The intent is that each new submit can look at:
- the full question text
- the current answer or code
- the previous group attempts and prior AI feedback for that same question

That way, the model can respond with:
- smaller, more helpful nudges early on
- more specific guidance after repeated group tries
- less repetitive wording across attempts

## What changed

### `server/ai/controller.js`
Added a small server-side history layer that builds a compact “prior group attempts” context from the `responses` table.

New helper behavior:
- normalizes a question id to its base question key
- filters out metadata rows like scores, retry counters, and hidden state keys
- groups rows by `submit_id`
- keeps answer, code, output, and feedback rows together for the same attempt
- compresses the history into a structured group thread so it can be embedded in the prompt

Then that history context is injected into:
- `evaluateStudentResponse(...)`
- `evaluateCode(...)`

The model instructions now explicitly say:
- treat the history as one collaborative group conversation
- build on earlier hints
- avoid repeating the same wording verbatim
- become more specific as the group keeps trying
- avoid singling out the active typer

### `client/src/pages/RunActivityPage.jsx`
Added `qid` to the request body for the text-response AI evaluation call.

That gives the server a stable question key so it can load the correct attempt history.

### `server/responses/controller.js`
Updated the code-draft feedback path to pass:
- `instanceId`
- `qid`

So code questions can use the same history-aware feedback path.

### `server/tests/aiRoutes.validation.test.js`
Added a validation test that checks the prompt sent to OpenAI includes:
- the “prior attempts” block
- earlier answer/feedback lines
- the tutoring-context instruction text

## Why this design

This was kept server-side and group-scoped on purpose.

Reasons:
- the server already owns the response history
- the client does not need to assemble or understand attempt history
- keeping it in one place avoids a broader refactor
- the prompt can evolve without changing the UI or storage model
- in this activity model, `activity_instance_id` is the collaborative group attempt, so prior feedback belongs to the group even when the active typer changes

I also kept it compact:
- only the last few visible group attempts are included
- repeated identical attempt lines are collapsed
- hidden bookkeeping rows are excluded

That should help the prompt stay useful without getting bloated.

## Things to double-check

Please review these carefully:

1. **Question-id normalization**
   The helper maps question ids and derived keys back to a base question id. It covers the patterns I saw in the codebase, but there may be other suffix forms used elsewhere.

2. **History completeness**
   The history is built from the `responses` table, not drafts. That was intentional for a first pass, but if you want “live in-progress typing history,” that would need a different source.

3. **Prompt size**
   If a question has many submits, the context could still grow. Right now it is capped and trimmed, but it may still be worth watching token usage.

4. **Code path coverage**
   The code evaluator also gets the history context now, but it is explicitly told to judge correctness from the current code/output and use history only to calibrate feedback specificity.

5. **History grouping**
   The current grouping is based on `submit_id`. That matches the existing response history model, but if a submit is partially written or rows arrive in an odd order, the grouping should be rechecked.

## Tests and verification

What I ran:
- syntax checks on the changed server files using the bundled Node runtime

What did not fully run here:
- the `node --test server/tests/aiRoutes.validation.test.js` path could not complete in this shell because `express` is not installed in the local environment here

## Suggested next review

If another model is looking at this, the best question to ask is:

> Does this prompt shape actually encourage better scaffolding across repeated attempts, or should we compress the history into a smaller summary before sending it to the model?

The current draft now uses a structured group thread:
- prior group attempts
- group answer/code/output
- AI feedback already given
- current group attempt number
- a simple specificity ladder for later attempts

The next possible improvement would be to summarize what changed between attempts before sending it to the model. That could produce even cleaner tutoring behavior, but it is intentionally not implemented yet.
