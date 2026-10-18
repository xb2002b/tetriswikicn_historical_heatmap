#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Compare the live revision set with the planned 2020-07-19 import split."""
import collections
from pathlib import Path

from fetch_edits import (FLAG_ANON, FLAG_BOT, FLAG_DELETED, FLAG_IMPORTED,
                         FLAG_SYSTEM, base_flags, fetch_allusers, load_raw,
                         parse_ts)

ROOT = Path(__file__).resolve().parent.parent
CUT = parse_ts("2020-07-18T16:16:06Z")  # 2020-07-19 00:16:06 CST, 铁桶
records = load_raw(ROOT / "data/raw/revisions.jsonl")
records += load_raw(ROOT / "data/raw/deleted.jsonl")
allusers = {u["name"]: u for u in fetch_allusers()}

sides = {"before": collections.Counter(), "after": collections.Counter()}
first_after = None
last_special = None
for r in records:
    name = r.get("user") or ""
    uid = int(r.get("userid") or 0)
    groups = (allusers.get(name) or {}).get("groups") or []
    f = base_flags(name, uid, groups)
    if r.get("_deleted"):
        f |= FLAG_DELETED
    ts = parse_ts(r.get("timestamp"))
    side = "before" if ts < CUT else "after"
    c = sides[side]
    c["all"] += 1
    if not (f & (FLAG_BOT | FLAG_SYSTEM | FLAG_IMPORTED | FLAG_ANON)):
        c["human"] += 1
        if side == "after" and (first_after is None or ts < first_after[0]):
            first_after = (ts, name, r.get("_title"), r.get("revid"))
    if f & FLAG_IMPORTED:
        c["imported_name"] += 1
    if f & FLAG_ANON:
        c["anon"] += 1
    if f & FLAG_SYSTEM:
        c["system"] += 1
    if f & FLAG_BOT:
        c["bot"] += 1
    if r.get("_deleted"):
        c["deleted"] += 1
    if name.startswith(">"):
        if last_special is None or ts > last_special[0]:
            last_special = (ts, name, r.get("_title"))

print("cut 2020-07-18T16:16:06Z")
for side in ("before", "after"):
    print(side, dict(sides[side]))
print("allusers sum", sum(int(u.get("editcount") or 0) for u in allusers.values()))
print("first human after cut", first_after)
print("last special import", last_special)
