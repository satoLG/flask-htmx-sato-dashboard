"""Metricas da VM lidas de /proc e do df/du.

Preferimos /proc a parsear a saida do `top`/`free`: o formato de texto dessas
ferramentas muda entre versoes do procps (foi assim que o dashboard antigo
passou a mostrar 100% de CPU numa VM ociosa), enquanto /proc e estavel.
"""
import os
import shutil
import subprocess
import time
from pathlib import Path

_cache = {}


def _cached(key, ttl, producer):
    hit = _cache.get(key)
    now = time.time()
    if hit and now - hit[0] < ttl:
        return hit[1]
    value = producer()
    _cache[key] = (now, value)
    return value


def _read(path):
    try:
        return Path(path).read_text()
    except OSError:
        return ""


def _cpu_lines():
    """[(nome, [jiffies...])] para 'cpu' agregado e cada 'cpuN'."""
    out = []
    for line in _read("/proc/stat").splitlines():
        if not line.startswith("cpu"):
            break
        parts = line.split()
        out.append((parts[0], [int(v) for v in parts[1:]]))
    return out


def _busy_idle(vals):
    # user nice system idle iowait irq softirq steal ...
    idle = vals[3] + (vals[4] if len(vals) > 4 else 0)
    return sum(vals) - idle, idle


def cpu_usage(sample_seconds=0.15):
    """Uso de CPU agregado e por core, por delta de dois snapshots de /proc/stat."""
    first = _cpu_lines()
    if not first:
        return {"total": None, "cores": []}
    time.sleep(sample_seconds)
    second = _cpu_lines()
    total = None
    cores = []
    for (name, a), (_n, b) in zip(first, second):
        busy_a, idle_a = _busy_idle(a)
        busy_b, idle_b = _busy_idle(b)
        d_busy, d_idle = busy_b - busy_a, idle_b - idle_a
        span = d_busy + d_idle
        pct = round(d_busy / span * 100, 1) if span > 0 else 0.0
        if name == "cpu":
            total = pct
        else:
            cores.append({"core": name.replace("cpu", ""), "usage": pct})
    return {"total": total, "cores": cores, "count": len(cores)}


def memory():
    info = {}
    for line in _read("/proc/meminfo").splitlines():
        key, _, rest = line.partition(":")
        parts = rest.split()
        if parts and parts[0].isdigit():
            info[key] = int(parts[0]) * 1024  # kB -> bytes
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    swap_total = info.get("SwapTotal", 0)
    swap_free = info.get("SwapFree", 0)
    return {
        "total": total,
        "available": available,
        "used": total - available,
        "free": info.get("MemFree", 0),
        "buffers": info.get("Buffers", 0),
        "cached": info.get("Cached", 0),
        "used_percent": round((total - available) / total * 100, 1) if total else 0,
        "swap_total": swap_total,
        "swap_used": swap_total - swap_free,
        "swap_percent": round((swap_total - swap_free) / swap_total * 100, 1) if swap_total else 0,
    }


SKIP_FS = {"tmpfs", "devtmpfs", "squashfs", "overlay", "proc", "sysfs", "cgroup2", "efivarfs"}


def filesystems():
    """Montagens reais com tamanho/uso, da maior para a menor."""
    out = []
    seen = set()
    for line in _read("/proc/mounts").splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
        device, mount, fstype = parts[0], parts[1], parts[2]
        if fstype in SKIP_FS or mount in seen or not mount.startswith("/"):
            continue
        try:
            usage = shutil.disk_usage(mount)
        except OSError:
            continue
        if usage.total == 0:
            continue
        seen.add(mount)
        out.append({
            "device": device, "mount": mount, "fstype": fstype,
            "total": usage.total, "used": usage.used, "free": usage.free,
            "used_percent": round(usage.used / usage.total * 100, 1),
        })
    out.sort(key=lambda d: d["total"], reverse=True)
    return out


def disk_breakdown(path="/", limit=12, timeout=25):
    """O que ocupa espaco dentro de `path`, um nivel abaixo.

    `du` numa raiz grande e caro, entao o resultado fica em cache por 10 min e a
    chamada tem timeout: melhor devolver 'nao deu tempo' do que segurar a request.
    """
    def run():
        try:
            proc = subprocess.run(
                ["du", "-x", "-b", "--max-depth=1", path],
                text=True, capture_output=True, timeout=timeout,
            )
        except subprocess.TimeoutExpired:
            return {"path": path, "entries": [], "error": f"du passou de {timeout}s"}
        except (OSError, subprocess.SubprocessError) as e:
            return {"path": path, "entries": [], "error": str(e)}
        entries = []
        root_total = 0
        for line in proc.stdout.splitlines():
            size, _, name = line.partition("\t")
            if not size.strip().isdigit():
                continue
            size = int(size)
            if os.path.normpath(name) == os.path.normpath(path):
                root_total = size
                continue
            entries.append({"name": os.path.basename(name) or name,
                            "path": name, "size": size})
        entries.sort(key=lambda e: e["size"], reverse=True)
        top = entries[:limit]
        rest = sum(e["size"] for e in entries[limit:])
        if rest:
            top.append({"name": "outros", "path": "", "size": rest})
        return {"path": path, "total": root_total or sum(e["size"] for e in entries),
                "entries": top}

    return _cached(f"du:{path}", 600, run)


def top_processes(limit=8):
    try:
        out = subprocess.run(
            ["ps", "-eo", "pcpu,pmem,pid,comm", "--sort=-pcpu"],
            text=True, capture_output=True, timeout=5,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    procs = []
    for line in out.splitlines()[1:]:
        parts = line.split(None, 3)
        if len(parts) < 4:
            continue
        procs.append({"cpu": float(parts[0]), "mem": float(parts[1]),
                      "pid": parts[2], "command": parts[3]})
        if len(procs) >= limit:
            break
    return procs


def uptime_seconds():
    raw = _read("/proc/uptime").split()
    return float(raw[0]) if raw else 0.0


def load_average():
    raw = _read("/proc/loadavg").split()
    if len(raw) < 3:
        return {}
    cores = os.cpu_count() or 1
    load1 = float(raw[0])
    return {"1min": load1, "5min": float(raw[1]), "15min": float(raw[2]),
            "cores": cores, "per_core": round(load1 / cores * 100, 1)}


def snapshot(with_breakdown=True):
    from datetime import datetime
    fs = filesystems()
    root = fs[0]["mount"] if fs else "/"
    data = {
        "cpu": cpu_usage(),
        "memory": memory(),
        "filesystems": fs,
        "load": load_average(),
        "uptime_seconds": uptime_seconds(),
        "top_processes": top_processes(),
        "hostname": _read("/proc/sys/kernel/hostname").strip() or "?",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
    if with_breakdown:
        data["disk_breakdown"] = disk_breakdown(root)
    return data
