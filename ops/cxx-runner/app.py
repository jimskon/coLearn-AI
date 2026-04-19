# ops/cxx-runner/app.py
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from typing import Dict, List, Optional, Union
import os
import tempfile
import shlex
import subprocess
import asyncio
import uuid
import shutil
import time
import json
import redis.asyncio as redis
import math

app = FastAPI(title="C++20 Runner", version="1.5")

# --- configuration ---
SESSION_TTL_SEC = 600
WALL_LIMIT_SEC = 60
IDLE_LIMIT_SEC = 15

r = redis.Redis(host="redis", port=6379, decode_responses=True)


def _session_key(sid: str) -> str:
    return f"cxx:sess:{sid}"


@app.get("/health")
async def health():
    return {"status": "ok"}


# ---------- models & helpers ----------

class RunReq(BaseModel):
    code: str = Field(..., min_length=1, max_length=20000)
    files: Optional[Union[Dict[str, str], List[Dict[str, str]]]] = None
    # NEW: optional per-request timeouts (milliseconds)
    timeout_ms: Optional[int] = None         # wall clock
    idle_timeout_ms: Optional[int] = None    # inactivity

class RunResp(BaseModel):
    ok: bool
    compile_stderr: str
    stdout: str
    stderr: str
    exit_code: int
    files: Dict[str, str] = {}


def _run_cmd(cmd: str, cwd: str, timeout: int):
    try:
        p = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            shell=True,
        )
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as e:
        return 124, (e.stdout or ""), (e.stderr or "") + "\n[TIMEOUT]\n"


def _materialize_files(td: str, files) -> List[str]:
    """
    Write provided files into td.
    Returns list of source file paths to compile (if any).
    """
    if not files:
        return []

    if isinstance(files, dict):
        items = list(files.items())
    else:
        items = [
            ((f.get("name") or "").strip(), f.get("content", ""))
            for f in files
            if (f.get("name") or "").strip()
        ]

    src_paths: List[str] = []

    for name, content in items:
        safe = os.path.basename(name)
        if not safe:
            continue
        path = os.path.join(td, safe)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content or "")
        if safe.endswith((".cpp", ".cc", ".cxx", ".c")):
            src_paths.append(path)

    return src_paths


def _collect_text_files(td: str, ignore: Optional[List[str]] = None) -> Dict[str, str]:
    """
    Collect small readable text files from td, excluding ignore.
    Used to surface outputs like out.txt back to the frontend.
    """
    ignore = set(ignore or [])
    out: Dict[str, str] = {}

    try:
        names = os.listdir(td)
    except OSError:
        return out

    for name in names:
        if name in ignore:
            continue

        path = os.path.join(td, name)
        if not os.path.isfile(path):
            continue

        try:
            size = os.path.getsize(path)
        except OSError:
            continue
        if size > 64 * 1024:
            # skip large files
            continue

        try:
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
        except (UnicodeDecodeError, OSError):
            continue

        out[name] = data

    return out


# ---------- non-interactive run (kept for compatibility) ----------

@app.post("/run", response_model=RunResp)
def run_cpp(req: RunReq):
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "main.cpp")
        bin_path = os.path.join(td, "a.out")

        with open(src, "w", encoding="utf-8") as f:
            f.write(req.code)

        extra_srcs = _materialize_files(td, req.files)

        compile_cmd = (
            "g++ -std=c++20 -O2 -pipe -static-libstdc++ -static-libgcc -s "
            f"-o {shlex.quote(bin_path)} {shlex.quote(src)}"
        )
        if extra_srcs:
            compile_cmd += " " + " ".join(shlex.quote(p) for p in extra_srcs)

        rc_c, _out_c, err_c = _run_cmd(compile_cmd, td, timeout=8)
        if rc_c != 0:
            return RunResp(
                ok=False,
                compile_stderr=err_c,
                stdout="",
                stderr="",
                exit_code=rc_c,
                files={},
            )

        run_cmdline = (
            "bash -lc "
            f"'ulimit -t 2 -c 0 -v 262144 -f 4096; timeout 2s {shlex.quote(bin_path)}'"
        )
        rc_r, out_r, err_r = _run_cmd(run_cmdline, td, timeout=3)

        files_out = _collect_text_files(td, ignore=["main.cpp", "a.out"])

        return RunResp(
            ok=True,
            compile_stderr=err_c or "",
            stdout=out_r,
            stderr=err_r,
            exit_code=rc_r,
            files=files_out,
        )


# ---------- interactive session endpoints ----------

class NewSessionReq(RunReq):
    pass


DEFAULT_WALL_LIMIT_SEC = 60
DEFAULT_IDLE_LIMIT_SEC = 15

@app.post("/session/new")
async def session_new(req: NewSessionReq):
    """
    Create a new interactive session:
    - writes main.cpp
    - materializes any provided files
    - compiles (with a guard timeout)
    - stores tmpdir/exe and per-session limits in Redis keyed by sessionId
    """
    td = tempfile.mkdtemp()
    src = os.path.join(td, "main.cpp")
    exe = os.path.join(td, "a.out")

    with open(src, "w", encoding="utf-8") as f:
        f.write(req.code)

    extra_srcs = _materialize_files(td, req.files)

    compile_cmd = [
        "g++", "-std=c++20", "-O2", "-pipe",
        "-static-libstdc++", "-static-libgcc", "-s",
        src, "-o", exe,
    ] + extra_srcs

    proc = await asyncio.create_subprocess_exec(
        *compile_cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=td,
    )

    try:
        _out, err = await asyncio.wait_for(proc.communicate(), timeout=10.0)
    except asyncio.TimeoutError:
        try:
            proc.kill()
        except Exception:
            pass
        try:
            await proc.wait()
        except Exception:
            pass
        shutil.rmtree(td, ignore_errors=True)
        return {"ok": False, "compile_error": "Compile timed out\n"}

    if proc.returncode != 0:
        shutil.rmtree(td, ignore_errors=True)
        return {"ok": False, "compile_error": err.decode(errors="ignore")}

    # Per-session limits (fall back to defaults if not provided)
    wall_sec = max(1, int((req.timeout_ms or DEFAULT_WALL_LIMIT_SEC * 1000) / 1000))
    idle_sec = max(1, int((req.idle_timeout_ms or DEFAULT_IDLE_LIMIT_SEC * 1000) / 1000))
    idle_sec = min(idle_sec, wall_sec)

    sid = str(uuid.uuid4())
    await r.hset(_session_key(sid), mapping={
        "tmpdir": td,
        "exe": exe,
        "created_at": str(time.time()),
        "wall_sec": str(wall_sec),
        "idle_sec": str(idle_sec),
    })
    await r.expire(_session_key(sid), SESSION_TTL_SEC)

    # Return limits so the client can log them
    return {"ok": True, "sessionId": sid, "wall_sec": wall_sec, "idle_sec": idle_sec}

@app.websocket("/session/ws/{sid}")
async def session_ws(ws: WebSocket, sid: str):
    """
    Interactive execution:
    - runs the compiled binary
    - streams stdout/stderr
    - forwards terminal input to stdin
    - enforces wall/idle limits
    - on exit, sends [FILES]{json} with any small text files
    """

    await ws.accept()

    key = _session_key(sid)
    meta = await r.hgetall(key)
    if not meta:
        await ws.send_text("Session not found\n")
        await ws.close()
        return

    tmpdir = meta["tmpdir"]
    exe = meta["exe"]

    # Pull per-session limits (fallback to defaults if missing)
    try:
        wall_sec = float(meta.get("wall_sec", DEFAULT_WALL_LIMIT_SEC))
    except Exception:
        wall_sec = float(DEFAULT_WALL_LIMIT_SEC)

    try:
        idle_sec = float(meta.get("idle_sec", DEFAULT_IDLE_LIMIT_SEC))
    except Exception:
        idle_sec = float(DEFAULT_IDLE_LIMIT_SEC)
    cpu_limit = max(1, int(math.ceil(wall_sec)))  # seconds of CPU time

    # Helpful debug line to the client
    #await ws.send_text(f"[server] limits: wall={int(wall_sec)}s idle={int(idle_sec)}s\n")

    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", "-lc",
            f"ulimit -t {cpu_limit} -c 0 -v 262144 -f 4096; "
            f"stdbuf -oL -eL {shlex.quote(exe)}",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=tmpdir,
)

    except Exception as e:
        await ws.send_text(f"Failed to start: {e}\n")
        await ws.close()
        await _kill_and_cleanup(key, tmpdir)
        return

    started_at = time.monotonic()
    last_output = time.monotonic()

    async def pump_stdout():
        nonlocal last_output
        try:
            while True:
                chunk = await proc.stdout.read(1024)
                if not chunk:
                    break
                last_output = time.monotonic()
                await ws.send_text(chunk.decode(errors="ignore"))
        except Exception:
            # don’t crash session for stdout issues
            pass

    async def watchdog():
        try:
            while True:
                await asyncio.sleep(0.5)
                now = time.monotonic()
                if proc.returncode is not None:
                    break
                if now - started_at > wall_sec:
                    await ws.send_text("\n[WALL TIME EXCEEDED]\n")
                    proc.kill()
                    break
                if now - last_output > idle_sec:
                    await ws.send_text("\n[IDLE TIME EXCEEDED]\n")
                    proc.kill()
                    break
        except Exception:
            pass

    t_pump = asyncio.create_task(pump_stdout())
    t_watch = asyncio.create_task(watchdog())

    try:
        while True:
            if proc.returncode is not None:
                break
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=0.2)
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break

            if proc.returncode is not None:
                break

            try:
                proc.stdin.write(data.encode())
                await proc.stdin.drain()
            except Exception:
                break
    finally:
        try:
            if proc.returncode is None:
                proc.kill()
        except Exception:
            pass

        await asyncio.gather(t_pump, t_watch, return_exceptions=True)

        # send back any small text files before cleanup
        try:
            files_out = _collect_text_files(tmpdir, ignore=["main.cpp", "a.out"])
            if files_out:
                await ws.send_text("[FILES]" + json.dumps(files_out))
        except Exception:
            pass

        try:
            await ws.close()
        except Exception:
            pass

        await _kill_and_cleanup(key, tmpdir)

async def _kill_and_cleanup(key: str, tmpdir: str):
    try:
        await r.delete(key)
    except Exception:
        pass
    try:
        shutil.rmtree(tmpdir, ignore_errors=True)
    except Exception:
        pass
