"""Cron jobs da VM: os do Hermes (jobs.json) e os do sistema (crontab/systemd).

O historico de execucao sai do executions.db do proprio Hermes. Cada fonte e
lida em isolado: se o crontab nao existir, os jobs do Hermes ainda aparecem.
"""
import json
import sqlite3
import subprocess
from datetime import datetime

from . import config

def _jobs_path():
    return config.CRON_DIR / "jobs.json"


def _exec_db():
    return config.CRON_DIR / "executions.db"


def _hermes_jobs():
    if not _jobs_path().exists():
        return [], None
    try:
        with open(_jobs_path()) as f:
            data = json.load(f)
    except (OSError, ValueError) as e:
        return [], str(e)
    if isinstance(data, dict):
        # aceita tanto {id: job} quanto um job solto
        if all(isinstance(v, dict) for v in data.values()) and data:
            jobs = [dict(v, id=v.get("id", k)) for k, v in data.items()]
        else:
            jobs = [data]
    elif isinstance(data, list):
        jobs = [j for j in data if isinstance(j, dict)]
    else:
        return [], f"formato inesperado em {_jobs_path()}"
    out = []
    for job in jobs:
        out.append({
            "id": str(job.get("id") or job.get("name") or "?"),
            "name": job.get("name") or job.get("id") or "?",
            "schedule": job.get("schedule") or job.get("cron") or job.get("expression") or "?",
            "command": job.get("command") or job.get("prompt") or job.get("task") or "",
            "enabled": job.get("enabled", True),
            "last_run": job.get("last_run"),
            "next_run": job.get("next_run"),
            "source": "hermes",
        })
    return out, None


def _system_crontab():
    try:
        proc = subprocess.run(["crontab", "-l"], text=True,
                              capture_output=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    jobs = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" in line.split()[0]:
            continue
        parts = line.split(None, 5)
        if len(parts) < 6:
            continue
        jobs.append({
            "id": f"crontab:{len(jobs)}",
            "name": parts[5][:60],
            "schedule": " ".join(parts[:5]),
            "command": parts[5],
            "enabled": True,
            "source": "crontab",
        })
    return jobs


def _systemd_timers():
    try:
        proc = subprocess.run(
            ["systemctl", "list-timers", "--all", "--no-pager", "--no-legend"],
            text=True, capture_output=True, timeout=5,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if proc.returncode != 0:
        return []
    timers = []
    for line in proc.stdout.splitlines():
        parts = line.split()
        if len(parts) < 2 or not any(p.endswith(".timer") for p in parts):
            continue
        unit = next(p for p in parts if p.endswith(".timer"))
        timers.append({
            "id": f"timer:{unit}", "name": unit, "schedule": "systemd timer",
            "command": unit, "enabled": True, "source": "systemd",
            "next_run": " ".join(parts[:3]),
        })
    return timers


def _executions(limit=60):
    if not _exec_db().exists():
        return [], None
    try:
        conn = sqlite3.connect(f"file:{_exec_db()}?mode=ro", uri=True)
    except sqlite3.OperationalError as e:
        return [], str(e)
    try:
        c = conn.cursor()
        c.execute("""SELECT job_id, start_time, end_time, exit_code, output_bytes
                     FROM executions ORDER BY start_time DESC LIMIT ?""", (limit,))
        cols = [d[0] for d in c.description]
        rows = [dict(zip(cols, row)) for row in c.fetchall()]
    except sqlite3.OperationalError as e:
        return [], str(e)
    finally:
        conn.close()
    for row in rows:
        row["duration_s"] = _duration(row.get("start_time"), row.get("end_time"))
        row["ok"] = row.get("exit_code") == 0
    return rows, None


def _duration(start, end):
    for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return round((datetime.strptime(end, fmt) - datetime.strptime(start, fmt))
                         .total_seconds(), 1)
        except (TypeError, ValueError):
            continue
    return None


def overview():
    jobs, jobs_error = _hermes_jobs()
    jobs += _system_crontab()
    jobs += _systemd_timers()
    executions, exec_error = _executions()

    stats = {}
    for run in executions:
        entry = stats.setdefault(run["job_id"], {"runs": 0, "failures": 0, "last": None})
        entry["runs"] += 1
        if not run["ok"]:
            entry["failures"] += 1
        if entry["last"] is None or str(run["start_time"]) > str(entry["last"]):
            entry["last"] = run["start_time"]
    for job in jobs:
        job["history"] = stats.get(job["id"], {"runs": 0, "failures": 0, "last": None})

    return {
        "jobs": jobs,
        "executions": executions,
        "total_runs": len(executions),
        "failed_runs": sum(1 for r in executions if not r["ok"]),
        "sources": sorted({j["source"] for j in jobs}),
        "jobs_error": jobs_error,
        "executions_error": exec_error,
        "cron_dir": str(config.CRON_DIR),
    }
