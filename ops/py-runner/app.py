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

app = FastAPI(title="Python Runner", version="1.0")

SESSION_TTL_SEC = 600
WALL_LIMIT_SEC = 60
IDLE_LIMIT_SEC = 15

r = redis.Redis(host="redis", port=6379, decode_responses=True)


def _session_key(sid: str) -> str:
    return f"pyr:sess:{sid}"


@app.get("/health")
async def health():
    return {"status": "ok"}


class RunReq(BaseModel):
    code: str = Field(..., min_length=1, max_length=20000)
    files: Optional[Union[Dict[str, str], List[Dict[str, str]]]] = None
    timeout_ms: Optional[int] = None
    idle_timeout_ms: Optional[int] = None


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

    out_paths: List[str] = []
    for name, content in items:
        safe = os.path.basename(name)
        if not safe:
            continue
        path = os.path.join(td, safe)
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(content or "")
        if safe.endswith(".py"):
            out_paths.append(path)

    return out_paths


def _collect_text_files(td: str, ignore: Optional[List[str]] = None) -> Dict[str, str]:
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
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = f.read()
        except (UnicodeDecodeError, OSError):
            continue
        out[name] = data

    return out


@app.post("/run", response_model=RunResp)
def run_python(req: RunReq):
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "main.py")
        with open(src, "w", encoding="utf-8") as f:
            f.write(req.code)

        _materialize_files(td, req.files)

        run_cmdline = (
            "bash -lc "
            f"'ulimit -t 2 -c 0 -v 524288 -f 4096; timeout 2s python3 -u {shlex.quote(src)}'"
        )
        rc, out, err = _run_cmd(run_cmdline, td, timeout=3)
        files_out = _collect_text_files(td, ignore=["main.py"])

        return RunResp(
            ok=True,
            compile_stderr="",
            stdout=out,
            stderr=err,
            exit_code=rc,
            files=files_out,
        )


class NewSessionReq(RunReq):
    pass


@app.post("/session/new")
async def session_new(req: NewSessionReq):
    td = tempfile.mkdtemp()
    src = os.path.join(td, "main.py")

    with open(src, "w", encoding="utf-8") as f:
        f.write(req.code)

    _materialize_files(td, req.files)

    wall_sec = max(1, int((req.timeout_ms or WALL_LIMIT_SEC * 1000) / 1000))
    idle_sec = max(1, int((req.idle_timeout_ms or IDLE_LIMIT_SEC * 1000) / 1000))
    idle_sec = min(idle_sec, wall_sec)

    sid = str(uuid.uuid4())
    await r.hset(_session_key(sid), mapping={
        "tmpdir": td,
        "src": src,
        "created_at": str(time.time()),
        "wall_sec": str(wall_sec),
        "idle_sec": str(idle_sec),
    })
    await r.expire(_session_key(sid), SESSION_TTL_SEC)
    return {"ok": True, "sessionId": sid, "wall_sec": wall_sec, "idle_sec": idle_sec}


@app.websocket("/session/ws/{sid}")
async def session_ws(ws: WebSocket, sid: str):
    await ws.accept()

    key = _session_key(sid)
    meta = await r.hgetall(key)
    if not meta:
        await ws.send_text("Session not found\n")
        await ws.close()
        return

    tmpdir = meta["tmpdir"]
    src = meta["src"]

    try:
        wall_sec = float(meta.get("wall_sec", WALL_LIMIT_SEC))
    except Exception:
        wall_sec = float(WALL_LIMIT_SEC)

    try:
        idle_sec = float(meta.get("idle_sec", IDLE_LIMIT_SEC))
    except Exception:
        idle_sec = float(IDLE_LIMIT_SEC)

    cpu_limit = max(1, int(math.ceil(wall_sec)))

    try:
        proc = await asyncio.create_subprocess_exec(
            "bash", "-lc",
            f"ulimit -t {cpu_limit} -c 0 -v 524288 -f 4096; "
            f"stdbuf -oL -eL python3 -u {shlex.quote(src)}",
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

        try:
            files_out = _collect_text_files(tmpdir, ignore=["main.py"])
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
