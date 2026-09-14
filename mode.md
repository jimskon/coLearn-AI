# System modes

# Assignment Mode

Assignment mode is a new mode for student programming lab assignments.

## What it is for

Assignment mode is for work that sits between an activity and a test:

- more open-ended than a test
- more structured than a playground
- more project-oriented than a typical activity

It is a good fit for programming labs where students:

- start from a goal or problem
- work through several smaller steps
- write and test helper functions
- build toward a complete solution
- revise earlier work as they go
- receive AI help at selected points
- get a final graded review when they submit

## How it differs from the other modes

| Mode | Primary use | Student flow | Feedback while working | Typical grading |
|---|---|---|---|---|
| Activity | Guided class work | Mostly structured, often collaborative | Yes, often immediate | Low to moderate |
| Playground | Instructor-led exploration | Open, experimental, demo-friendly | Yes | Usually none or light |
| Test | Closed assessment | One main submission path | No feedback until submit | Auto-graded, instructor-reviewed |
| Assignment | Independent lab/project | Flexible, step-based, revisitable | Optional, at checkpoints | Mixed: step rubrics + final rubric |

## Core idea

Assignment mode should feel like a workbench, not a worksheet.

Students should be able to:

- work on steps in any order
- run code repeatedly
- ask AI for help
- revise earlier steps after learning something new
- submit a final solution for grading

## Suggested structure

An assignment can be organized into these parts:

- project goal
- background or context
- optional collaboration setting
- step-by-step milestones
- optional starter code
- optional test cases
- optional AI help blocks
- optional graded checkpoints
- final submission and review

## Step types

A step can be any of the following:

- a thinking prompt
- an algorithm design prompt
- a small coding task
- a function-writing task
- a testing task
- an integration task
- a final assembly task

A step can also be:

- ungraded guidance
- a checkpoint with feedback only
- a graded checkpoint with a rubric

## Grading model

The grading model should be mixed:

- some steps are just guidance
- some steps are check-ins
- some steps are graded
- the final submission is graded again at the end

A simple rule could be:

- if a step has a rubric, it is gradeable
- if it has no rubric, it is guidance only

## AI support

Assignment mode can include AI help in a controlled way.

Examples:

- ask for a hint
- ask for help with an algorithm
- ask for help debugging code
- ask for feedback on a function
- ask for feedback on the final assembled program

The AI should help students move forward without taking the work away from them.

## Example use case

A programming assignment might look like this:

- project goal
- plan the approach
- write `loadStopList()`
- write `isStopWord(aWord, stopWords)`
- write `loadWords(filename, stopList)`
- write `countWord(wordList, aWord)`
- write `pickRandomWord(wordList)`
- assemble the final program
- test against supplied cases
- submit the final solution

That kind of workflow fits assignment mode very naturally.

## Design principles

Assignment mode should:

- support non-linear progress
- allow revision of earlier work
- avoid forcing a strict worksheet sequence
- support optional grading at checkpoints
- keep the authoring model simple
- reuse existing blocks where possible

## Recommended overall shape

A clean way to think about the four modes is:

- Activity = guided class learning
- Playground = instructor-led experimentation
- Test = closed assessment
- Assignment = student-driven project work

## Summary

Assignment mode is best viewed as a project/lab mode for independent programming work.

It should give students:

- a clear goal
- a sequence of manageable steps
- optional AI help
- optional checkpoint grading
- a final graded submission

That makes it more flexible than a test, more structured than a playground, and better suited to programming labs than a standard activity.
