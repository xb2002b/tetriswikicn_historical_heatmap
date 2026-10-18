#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Quick diagnostics for the raw JSONL files."""
import collections
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

for name in ("revisions.jsonl", "deleted.jsonl"):
    path = ROOT / "data" / "raw" / name
    if not path.exists():
        print(name, "missing")
        continue
    ns = collections.Counter()
    years = collections.Counter()
    cats = collections.Counter()
    users = collections.Counter()
    n = 0
    first = None
    last = None
    for line in path.open(encoding="utf-8"):
        line = line.strip()
        if not line:
            continue
        r = json.loads(line)
        n += 1
        ns[r.get("_ns")] += 1
        ts = r.get("timestamp") or ""
        years[ts[:4]] += 1
        name_ = r.get("user") or ""
        if name_.startswith(">"):
            cat = "imported"
        elif (r.get("userid") or 0) == 0:
            cat = "anon"
        else:
            cat = "registered"
        cats[cat] += 1
        users[name_] += 1
        if ts and (first is None or ts < first):
            first = ts
        if ts and (last is None or ts > last):
            last = ts
    print(f"\n{name}: {n:,} revisions")
    print("  first/last:", first, last)
    print("  ns:", sorted(ns.items()))
    print("  years:", sorted(years.items()))
    print("  cats:", dict(cats))
    print("  top users:", users.most_common(15))
