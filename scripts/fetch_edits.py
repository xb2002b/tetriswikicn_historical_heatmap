#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""TetrisWiki CN historical heatmap data fetcher/builder.

Run from the project root:
    python scripts/fetch_edits.py --max-pages 40 --fetch-only
    python scripts/fetch_edits.py --max-pages 40 --fetch-only
    python scripts/fetch_edits.py --build-only

The first full fetch is about 82 API requests (500 revisions each). The
script uses maxlag, a 1 s delay and a resumable continue token. The viewer
reads the generated data/*.js files and never calls the API for the heatmap.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
API = "https://tetriswiki.cn/api.php"
SITE = "https://tetriswiki.cn"
UA = "TetrisWikiCN-HistoricalHeatmap/0.1 (local history analysis)"
CST = timezone(timedelta(hours=8))
SYSTEM_USERS = {"Maintenance script", "MediaWiki default"}
FLAG_MINOR = 1
FLAG_BOT = 2
FLAG_ANON = 4
FLAG_IMPORTED = 8
FLAG_SYSTEM = 16
FLAG_REVERTED = 32
FLAG_HIDDEN = 64
FLAG_DELETED = 128


def api_get(params: dict, retries: int = 6) -> dict:
    p = dict(params)
    p.setdefault("format", "json")
    p.setdefault("formatversion", "2")
    p.setdefault("maxlag", "5")
    url = API + "?" + urllib.parse.urlencode(p)
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UA,
            "Accept": "application/json",
        })
        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                raw = resp.read()
            data = json.loads(raw.decode("utf-8"))
            err = data.get("error")
            if not err:
                return data
            code = err.get("code", "")
            if code not in {"maxlag", "ratelimited", "readonly",
                            "internal_api_error_DBQueryError"}:
                raise RuntimeError(f"API error {code}: {err.get('info', '')}")
            last = err.get("info", code)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}"
            if e.code not in {429, 500, 502, 503, 504}:
                raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            last = str(e)
        wait = min(60, 2 ** attempt)
        print(f"  ! {last}; retry in {wait}s ({attempt + 1}/{retries})", flush=True)
        time.sleep(wait)
    raise RuntimeError(f"API failed after {retries} attempts: {last}")


def fetch_allusers() -> list[dict]:
    users: list[dict] = []
    cont = None
    while True:
        p = {"action": "query", "list": "allusers", "aulimit": "500",
             "auprop": "editcount|groups|registration"}
        if cont:
            p["aucontinue"] = cont
        data = api_get(p)
        users.extend(data.get("query", {}).get("allusers", []))
        cont = data.get("continue", {}).get("aucontinue")
        if not cont:
            break
        time.sleep(0.5)
    return users


def fetch_siteinfo() -> dict:
    data = api_get({"action": "query", "meta": "siteinfo",
                    "siprop": "general"})
    return data.get("query", {}).get("general", {})


def fetch_statistics() -> dict:
    data = api_get({"action": "query", "meta": "siteinfo",
                    "siprop": "statistics"})
    return data.get("query", {}).get("statistics", {})


def fetch_revisions(args, raw_dir: Path) -> None:
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / "revisions.jsonl"
    state_path = raw_dir / "state.json"
    if args.fresh:
        for p in (raw_path, state_path):
            if p.exists():
                p.unlink()
    state = {"continue": None, "pages": 0, "revisions": 0,
             "lastTs": None, "lastRevid": None}
    if state_path.exists():
        state.update(json.loads(state_path.read_text(encoding="utf-8")))
    if state.get("continue") is None and state.get("pages", 0) > 0 and not args.fresh:
        print("State has no continue token; fetch appears complete. "
              "Use --fresh to refetch.")
        return
    base = {
        "action": "query", "list": "allrevisions", "arvdir": "newer",
        "arvlimit": "500",
        "arvprop": "ids|timestamp|user|userid|comment|flags|size|tags",
    }
    params = dict(base)
    if state.get("continue"):
        params["arvcontinue"] = state["continue"]
    else:
        params["arvstart"] = args.start
        if args.end:
            params["arvend"] = args.end
    pages_this_run = 0
    with raw_path.open("a", encoding="utf-8") as f:
        while True:
            data = api_get(params)
            pages = data.get("query", {}).get("allrevisions", [])
            n = 0
            for page in pages:
                title = page.get("title", "")
                ns = page.get("ns", 0)
                pageid = page.get("pageid", 0)
                for rev in page.get("revisions", []):
                    rec = dict(rev)
                    rec["_pageid"] = pageid
                    rec["_ns"] = ns
                    rec["_title"] = title
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    n += 1
                    state["lastTs"] = rec.get("timestamp")
                    state["lastRevid"] = rec.get("revid")
            f.flush()
            state["pages"] += 1
            state["revisions"] += n
            pages_this_run += 1
            cont = data.get("continue", {}).get("arvcontinue")
            state["continue"] = cont
            state_path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8")
            print(f"  page {state['pages']}: +{n} revs, "
                  f"total {state['revisions']:,}, continue={cont}", flush=True)
            if not cont:
                break
            if args.max_pages and pages_this_run >= args.max_pages:
                print(f"  stopped after {pages_this_run} pages; rerun to resume.")
                break
            params = dict(base)
            params["arvcontinue"] = cont
            time.sleep(args.delay)


def fetch_deleted_revisions(args, raw_dir: Path) -> None:
    """Fetch revisions of deleted pages.

    The wiki's anonymous API users can read deleted revisions, but not
    deleted comments; adrprop therefore intentionally omits comment.
    """
    raw_dir.mkdir(parents=True, exist_ok=True)
    raw_path = raw_dir / "deleted.jsonl"
    state_path = raw_dir / "deleted_state.json"
    if args.fresh:
        for p in (raw_path, state_path):
            if p.exists():
                p.unlink()
    state = {"continue": None, "pages": 0, "revisions": 0,
             "lastTs": None, "lastRevid": None}
    if state_path.exists():
        state.update(json.loads(state_path.read_text(encoding="utf-8")))
    if state.get("continue") is None and state.get("pages", 0) > 0 and not args.fresh:
        print("Deleted-revision state complete.")
        return
    base = {
        "action": "query", "list": "alldeletedrevisions",
        "adrdir": "newer", "adrlimit": "500",
        "adrprop": "ids|timestamp|user|userid|flags|size|tags",
    }
    params = dict(base)
    if state.get("continue"):
        params["adrcontinue"] = state["continue"]
    pages_this_run = 0
    with raw_path.open("a", encoding="utf-8") as f:
        while True:
            data = api_get(params)
            pages = data.get("query", {}).get("alldeletedrevisions", [])
            n = 0
            for page in pages:
                title = page.get("title", "")
                ns = page.get("ns", 0)
                pageid = page.get("pageid", 0)
                for rev in page.get("revisions", []):
                    rec = dict(rev)
                    rec["_pageid"] = pageid
                    rec["_ns"] = ns
                    rec["_title"] = title
                    rec["_deleted"] = True
                    rec.setdefault("comment", "")
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                    n += 1
                    state["lastTs"] = rec.get("timestamp")
                    state["lastRevid"] = rec.get("revid")
            f.flush()
            state["pages"] += 1
            state["revisions"] += n
            pages_this_run += 1
            cont = data.get("continue", {}).get("adrcontinue")
            state["continue"] = cont
            state_path.write_text(
                json.dumps(state, ensure_ascii=False, indent=2),
                encoding="utf-8")
            print(f"  deleted page {state['pages']}: +{n} revs, "
                  f"total {state['revisions']:,}, continue={cont}", flush=True)
            if not cont:
                break
            if args.max_pages and pages_this_run >= args.max_pages:
                print(f"  stopped after {pages_this_run} deleted pages; "
                      "rerun to resume.")
                break
            params = dict(base)
            params["adrcontinue"] = cont
            time.sleep(args.delay)


def parse_ts(s: str | None) -> int:
    if not s:
        return 0
    return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())


# 2020-07-17 22:07:43 CST: the wiki's first local revision. The API's
# siteinfo birthtimestamp points at the oldest imported revision (2006).
SITE_CREATED = parse_ts("2020-07-17T14:07:43Z")
# 2020-07-19 00:16:06 CST, the first local human edit after the import block.
ORGANIC_START = parse_ts("2020-07-18T16:16:06Z")
# Counts from the planning analysis (statistics + allusers).
EXPECTED_TOTAL = 40582
EXPECTED_REGISTERED = 33812
EXPECTED_HUMAN = 30664


def local_str(ts: int | None) -> str:
    if not ts:
        return ""
    return datetime.fromtimestamp(ts, CST).strftime("%Y-%m-%d %H:%M:%S")


def base_flags(name: str, uid: int, groups: list[str]) -> int:
    f = 0
    if name.startswith("imported>") or name.startswith(">"):
        f |= FLAG_IMPORTED
    elif name in SYSTEM_USERS:
        f |= FLAG_SYSTEM
    elif "bot" in groups:
        f |= FLAG_BOT
    elif uid == 0:
        f |= FLAG_ANON
    return f


def load_raw(raw_path: Path) -> list[dict]:
    by_revid: dict[int, dict] = {}
    if not raw_path.exists():
        raise SystemExit(f"Raw file not found: {raw_path}")
    with raw_path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            rid = rec.get("revid")
            if rid is not None:
                by_revid[rid] = rec
    return sorted(by_revid.values(),
                  key=lambda r: (r.get("timestamp", ""), r.get("revid", 0)))


def js_assign(var: str, obj, indent=None) -> str:
    text = json.dumps(obj, ensure_ascii=False, indent=indent,
                      separators=(",", ":") if indent is None else None)
    # A literal </script> inside a classic <script src> file would end the tag.
    text = text.replace("</", "<\\/")
    return f"window.{var} = {text};\n"


def build(args) -> dict:
    raw_dir = ROOT / args.raw_dir
    data_dir = ROOT / args.data_dir
    data_dir.mkdir(parents=True, exist_ok=True)
    stats = fetch_statistics()
    general = fetch_siteinfo()
    allusers_list = fetch_allusers()
    allusers = {u["name"]: u for u in allusers_list}
    records = load_raw(raw_dir / "revisions.jsonl")
    deleted_path = raw_dir / "deleted.jsonl"
    if deleted_path.exists():
        records += load_raw(deleted_path)
    merged: dict[int, dict] = {}
    for r in records:
        merged[r.get("revid")] = r
    records = sorted(merged.values(),
                     key=lambda r: (r.get("timestamp", ""), r.get("revid", 0)))

    users: dict[str, dict] = {}
    pages: dict[tuple[str, int], int] = {}
    edits = []
    for rec in records:
        name = rec.get("user") or "已隐藏"
        uid = int(rec.get("userid") or 0)
        au = allusers.get(name, {})
        groups = au.get("groups") or []
        base = base_flags(name, uid, groups)
        revflags = base
        if rec.get("minor"):
            revflags |= FLAG_MINOR
        if "mw-reverted" in (rec.get("tags") or []):
            revflags |= FLAG_REVERTED
        if rec.get("userhidden") or rec.get("commenthidden"):
            revflags |= FLAG_HIDDEN
        if rec.get("_deleted"):
            revflags |= FLAG_DELETED
        if name not in users:
            users[name] = {"n": name, "i": uid, "g": groups, "f": base,
                           "c": 0, "a": None, "b": None,
                           "r": au.get("registration"),
                           "e": au.get("editcount")}
        u = users[name]
        u["c"] += 1
        ts = parse_ts(rec.get("timestamp"))
        if u["a"] is None or ts < u["a"]:
            u["a"] = ts
        if u["b"] is None or ts > u["b"]:
            u["b"] = ts
        title = rec.get("_title", "")
        ns = int(rec.get("_ns") or 0)
        pkey = (title, ns)
        if pkey not in pages:
            pages[pkey] = len(pages)
        edits.append([int(rec.get("revid") or 0), name, ts, pages[pkey],
                      int(rec.get("parentid") or 0),
                      int(rec.get("size") or 0), revflags,
                      rec.get("comment") or ""])
    edits.sort(key=lambda e: (e[2], e[0]))
    user_names = sorted(users, key=lambda n: (-users[n]["c"], n))
    uidx = {n: i for i, n in enumerate(user_names)}
    page_list: list[list] = [["", 0]] * len(pages)
    for (title, ns), i in pages.items():
        page_list[i] = [title, ns]
    users_out = []
    for n in user_names:
        u = users[n]
        users_out.append([n, u["i"], u["g"], u["f"], u["c"], u["a"],
                          u["b"], u.get("r"), u.get("e")])
    edits_out = [[e[0], uidx[e[1]], e[2], e[3], e[4], e[5], e[6], e[7]]
                 for e in edits]

    total = len(edits_out)
    registered = sum(1 for e in edits_out if users_out[e[1]][1] > 0)
    imported = sum(1 for e in edits_out if e[6] & FLAG_IMPORTED)
    anon = sum(1 for e in edits_out if e[6] & FLAG_ANON)
    system = sum(1 for e in edits_out if e[6] & FLAG_SYSTEM)
    bot = sum(1 for e in edits_out if e[6] & FLAG_BOT)
    human = sum(1 for e in edits_out
                if not (e[6] & (FLAG_BOT | FLAG_SYSTEM | FLAG_IMPORTED | FLAG_ANON)))
    minor = sum(1 for e in edits_out if e[6] & FLAG_MINOR)
    reverted = sum(1 for e in edits_out if e[6] & FLAG_REVERTED)
    hidden = sum(1 for e in edits_out if e[6] & FLAG_HIDDEN)
    deleted = sum(1 for e in edits_out if e[6] & FLAG_DELETED)

    human_edits = [e for e in edits_out
                   if not (e[6] & (FLAG_BOT | FLAG_SYSTEM | FLAG_IMPORTED | FLAG_ANON))]
    first_h = next((e for e in human_edits if e[2] >= ORGANIC_START), None)
    xb_edits = [e for e in human_edits
                if users_out[e[1]][0] == "Xb2002b" and e[2] >= ORGANIC_START]
    first_xb = xb_edits[0] if xb_edits else None
    mig_cut = parse_ts("2024-10-24T00:00:00Z")
    indep = [e for e in human_edits if e[2] >= mig_cut]
    migrated_edit = indep[0] if indep else None
    migrated = migrated_edit[2] if migrated_edit else mig_cut
    created = SITE_CREATED
    if not created:
        created = edits_out[0][2] if edits_out else 0
    farm_h = sum(1 for e in human_edits if created <= e[2] < migrated)
    indep_h = sum(1 for e in human_edits if e[2] >= migrated)
    farm_total = sum(1 for e in edits_out if created <= e[2] < migrated)
    indep_total = sum(1 for e in edits_out if e[2] >= migrated)
    last = edits_out[-1][2] if edits_out else 0

    def point(e):
        if not e:
            return None
        return {"ts": e[2], "local": local_str(e[2]),
                "user": users_out[e[1]][0],
                "title": page_list[e[3]][0], "revid": e[0]}

    human_users = [u for u in users_out if u[3] == 0]
    human_users.sort(key=lambda u: (-u[4], u[0]))
    top = [{"name": u[0], "count": u[4], "uid": u[1], "groups": u[2],
            "first": u[5], "last": u[6],
            "firstLocal": local_str(u[5]), "lastLocal": local_str(u[6])}
           for u in human_users[:20]]
    bot_users = [{"name": u[0], "count": u[4], "uid": u[1], "groups": u[2]}
                 for u in users_out if u[3] & FLAG_BOT]
    bot_users.sort(key=lambda x: -x["count"])
    system_users = [{"name": u[0], "count": u[4], "uid": u[1]}
                    for u in users_out if u[3] & FLAG_SYSTEM]
    system_users.sort(key=lambda x: -x["count"])
    import_users = [{"name": u[0], "count": u[4]}
                    for u in users_out if u[3] & FLAG_IMPORTED]
    import_users.sort(key=lambda x: -x["count"])

    api_edits = int(stats.get("edits") or 0)
    all_sum = sum(int(u.get("editcount") or 0) for u in allusers_list)
    expected_human = EXPECTED_HUMAN
    top_diffs = []
    for u in users_out:
        if u[1] > 0 and u[8] is not None:
            api_count = int(u[8] or 0)
            diff = u[4] - api_count
            if diff:
                top_diffs.append({"name": u[0], "api": api_count,
                                  "fetched": u[4], "diff": diff})
    top_diffs.sort(key=lambda x: -abs(x["diff"]))
    verification = {
        "statisticsEdits": api_edits, "fetchedTotal": total,
        "matchTotal": api_edits == total,
        "allusersEditSum": all_sum, "fetchedRegistered": registered,
        "matchRegistered": all_sum == registered,
        "system": system, "bot": bot, "human": human,
        "expectedHuman": expected_human, "matchHuman": expected_human == human,
        "expectedTotal": EXPECTED_TOTAL,
        "expectedRegistered": EXPECTED_REGISTERED,
        "usersWithDiff": len(top_diffs), "topDiffs": top_diffs[:20],
        "deleted": deleted,
    }

    meta = {
        "site": SITE,
        "siteInfo": general,
        "api": API,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "timezone": "Asia/Shanghai",
        "source": "MediaWiki allrevisions (arvdir=newer, 500/page)",
        "statistics": stats,
        "allusersCount": len(allusers_list),
        "allusersEditSum": all_sum,
        "counts": {
            "total": total, "registered": registered,
            "anonymous": anon, "imported": imported,
            "anonymousImported": anon + imported,
            "system": system, "bot": bot, "human": human,
            "minor": minor, "reverted": reverted, "hidden": hidden,
            "deleted": deleted,
        },
        "timeline": {
            "created": {"ts": created, "local": local_str(created)},
            "firstOrganic": point(first_h),
            "firstXb2002b": point(first_xb),
            "migrated": point(migrated_edit),
            "last": {"ts": last, "local": local_str(last)},
        },
        "periods": {
            "farm": {"start": created, "end": migrated,
                     "startLocal": local_str(created),
                     "endLocal": local_str(migrated),
                     "human": farm_h, "total": farm_total},
            "independent": {"start": migrated, "end": last,
                            "startLocal": local_str(migrated),
                            "endLocal": local_str(last),
                            "human": indep_h, "total": indep_total},
        },
        "topEditors": top,
        "botEditors": bot_users,
        "systemEditors": system_users,
        "importUsers": import_users,
        "verification": verification,
        "defaultFilters": {"excludeBots": True, "excludeImports": True,
                           "excludeAnon": True, "excludeSystem": True,
                           "includeMinor": True, "includeReverted": True,
                           "includeDeleted": True, "namespace": "all"},
        "caveats": [
            "导入历史（`imported>…`、`>…`）的时间戳是导入时间；带真实用户名的旧 wiki 历史保留原始时间戳（最早 2006 年）。默认仅按用户名前缀排除导入。",
            "2024-10-24 18:34 UTC（2024-10-25 02:34 CST）的 Maintenance script 是文件导入，默认排除。",
            "账号注册时间大多是 2024-10-26，不能用于判断首次编辑；请使用 first 字段。",
            "时区 Asia/Shanghai（UTC+8）；跨日边界按 +8 计算。",
            "差异查看按需请求 action=compare，不在热力图加载时抓取。",
            "已删除修订的评论无法通过当前 API 权限读取；日详情中标记为已删除。",
        ],
    }
    data = {"generatedAt": meta["generatedAt"], "users": users_out,
            "pages": page_list, "edits": edits_out}
    edits_path = data_dir / "edits.js"
    meta_path = data_dir / "meta.js"
    summary_path = data_dir / "summary.json"
    edits_path.write_text(js_assign("TETRISWIKI_DATA", data), encoding="utf-8")
    meta_path.write_text(js_assign("TETRISWIKI_META", meta, indent=2),
                         encoding="utf-8")
    summary_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2),
                            encoding="utf-8")

    print("\n=== Build ===")
    print(f"records {total:,} | users {len(users_out):,} | pages {len(page_list):,}")
    print(f"registered {registered:,} | imported {imported:,} | anon {anon:,} | "
          f"system {system:,} | bot {bot:,} | human {human:,}")
    print(f"deleted revisions: {deleted:,}")
    print(f"farm human {farm_h:,} / total {farm_total:,} | "
          f"independent human {indep_h:,} / total {indep_total:,}")
    if first_h:
        print(f"first organic: {local_str(first_h[2])} CST by "
              f"{users_out[first_h[1]][0]} — {page_list[first_h[3]][0]}")
    if first_xb:
        print(f"first Xb2002b: {local_str(first_xb[2])} CST — "
              f"{page_list[first_xb[3]][0]}")
    print(f"migration: {local_str(migrated)} CST")
    print(f"verify total: stats {api_edits:,} vs fetched {total:,} -> "
          f"{'OK' if verification['matchTotal'] else 'DIFF'}")
    print(f"verify registered: allusers {all_sum:,} vs fetched {registered:,} -> "
          f"{'OK' if verification['matchRegistered'] else 'DIFF'}")
    print(f"verify human: expected {expected_human:,} vs fetched {human:,} -> "
          f"{'OK' if verification['matchHuman'] else 'DIFF'}")
    if top_diffs:
        print(f"users with count diff: {len(top_diffs)} (top: "
              + ", ".join(f"{x['name']} {x['diff']:+d}" for x in top_diffs[:5]) + ")")
    print("top: " + ", ".join(f"{x['name']} {x['count']:,}" for x in top[:8]))
    print(f"wrote {edits_path} ({edits_path.stat().st_size / 1048576:.1f} MB)")
    print(f"wrote {meta_path}")
    print(f"wrote {summary_path}")
    return meta


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Fetch tetriswiki.cn revisions and build static JS data.")
    ap.add_argument("--start", default="2000-01-01T00:00:00Z")
    ap.add_argument("--end", default=None)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--max-pages", type=int, default=0)
    ap.add_argument("--raw-dir", default="data/raw")
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--fresh", action="store_true")
    ap.add_argument("--fetch-only", action="store_true")
    ap.add_argument("--build-only", action="store_true")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args()
    if not args.build_only and not args.verify_only:
        fetch_revisions(args, ROOT / args.raw_dir)
        fetch_deleted_revisions(args, ROOT / args.raw_dir)
        if args.fetch_only:
            return
    meta = build(args)
    v = meta["verification"]
    if args.strict and not (v["matchTotal"] and v["matchRegistered"]
                            and v["matchHuman"]):
        sys.exit(2)


if __name__ == "__main__":
    main()
