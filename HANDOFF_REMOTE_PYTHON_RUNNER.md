# Handoff: Remote Python Runner

## Current Task

Explore adding a server-side Python runner while keeping the existing embedded/browser Python runner.

The proposed markup split is:

- `\python ... \endpython` for current client-side Skulpt execution.
- `\pythonremote ... \endpythonremote` for server-side CPython execution with packages like NumPy and Pandas.

## Decisions Made

- Do not replace embedded Python. Keep it for intro classes and client-distributed load.
- Add remote Python as a separate authored block, not a mode switch hidden behind `\python`.
- Reuse the C++ runner infrastructure where practical:
  - separate runner container
  - FastAPI-style service
  - session creation endpoint
  - WebSocket stdin/stdout
  - temp workspace per run
  - file materialization and returned file collection
  - nginx proxy pattern
  - xterm-based frontend terminal UI
- Continue the existing runtime limit model:
  - support optional timeouts such as `\pythonremote{5000}`
  - send `timeout_ms` / `idle_timeout_ms` to the runner
  - enforce wall, idle, CPU, memory, process, and file-size limits where practical
- Keep approved Python packages baked into the runner image. Do not support arbitrary package installs per run in the first draft.
- Avoid database changes for the first draft if possible. Treat remote Python as Python code with a remote runner flag rather than a new response type.

## Files Inspected

- `client/src/components/activity/ActivityPythonBlock.jsx`
- `client/src/components/activity/ActivityCppBlock.jsx`
- `client/src/utils/parseSheet.jsx`
- `client/src/pages/RunActivityPage.jsx`
- `ops/cxx-runner/app.py`
- `ops/cxx-runner/Dockerfile`
- `ops/cxx-runner/docker-compose.yml`
- `ops/nginx/cxx-run.conf`
- `server/activity_instances/controller.js`
- `server/ai/controller.js`
- `schema.sql`
- `MarkUp.md`

## Files Changed

- No implementation files changed during the design pass.
- This handoff note was added.

## Remaining TODOs

1. Add parser support for `\pythonremote` / `\endpythonremote`.
2. Add a remote Python block type to the rendered block model, likely `type: "pythonremote"` or `runner: "remote"`.
3. Create `ActivityRemotePythonBlock.jsx`, probably starting from `ActivityCppBlock.jsx` and changing:
   - syntax highlighting to Python
   - button text to `Run Python`
   - endpoint prefix from `/cxx-run` to `/py-run`
4. Add a Python runner service, modeled after `ops/cxx-runner/app.py`.
5. Add runner container files:
   - Dockerfile with CPython, NumPy, Pandas
   - docker-compose service
   - restart/deploy scripts similar to C++ runner
6. Add nginx proxy config for `/py-run/`.
7. Preserve existing file behavior:
   - send activity files into the temp directory
   - run from that directory
   - collect small generated text/CSV files back into `fileContents`
8. Update `MarkUp.md` with `\pythonremote` syntax and timeout behavior.
9. Add focused tests or manual checks for parsing, rendering, file input/output, timeout behavior, and AI feedback compatibility.

## Tests Run

- No tests were run. This was a read-only design/research pass.

