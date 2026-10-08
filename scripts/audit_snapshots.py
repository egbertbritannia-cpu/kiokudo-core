#!/usr/bin/env python3
"""Read-only comparison of two independently exported SQLite snapshots.

No network access; never connects to Turso; never modifies either SQLite file.
Only prints aggregated schema, counts and content hashes (no personal card data).
"""
import argparse
import base64
import hashlib
import json
import sqlite3
import sys
from pathlib import Path
from urllib.parse import quote

MANDATORY = {"cards", "decks", "review_logs"}
# Staging identity is staging-specific: it is not a learner-data table.
STAGING_ONLY = {"kiokudo_deployment_identity"}


def sql_identifier(value: str) -> str:
    return '"' + value.replace('"', '""') + '"'


def connect_read_only(path: str):
    db = Path(path).resolve(strict=True)
    if not db.is_file() or db.suffix not in {".sqlite", ".db", ".sqlite3"}:
        raise ValueError("Snapshot must be an existing .sqlite/.db/.sqlite3 file")
    # immutable mode avoids applying WAL/journal; requires exported, checkpointed copy.
    uri = "file:" + quote(str(db), safe="/") + "?mode=ro&immutable=1"
    cx = sqlite3.connect(uri, uri=True)
    cx.execute("PRAGMA query_only=ON")
    return cx, db


def canon_value(value):
    if isinstance(value, bytes):
        return {"blob_base64": base64.b64encode(value).decode("ascii")}
    return value


def digest_table(cx, table: str, columns: list[dict]):
    names = [c["name"] for c in columns]
    if not names:
        return {"count": 0, "sha256": None}
    # Sorting by all columns is deterministic independently of rowid/insertion order.
    ordering = ", ".join(sql_identifier(s) for s in names)
    sql = "SELECT * FROM " + sql_identifier(table) + " ORDER BY " + ordering
    digest = hashlib.sha256()
    count = 0
    for row in cx.execute(sql):
        raw = json.dumps([canon_value(v) for v in row], ensure_ascii=False,
                         separators=(",", ":"), allow_nan=False)
        digest.update(raw.encode("utf-8") + b"\n")
        count += 1
    return {"count": count, "sha256": digest.hexdigest()}


def inspect(path: str):
    cx, file = connect_read_only(path)
    try:
        tables = [r[0] for r in cx.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence') ORDER BY name"
        )]
        # Capture raw DDL including CHECK constraints, views, expression-index SQL
        # and triggers, not just column/foreign-key/index summaries.
        schema_objects = [
            {"type": typ, "name": name, "table": tbl, "sql": sql}
            for typ, name, tbl, sql in cx.execute(
                "SELECT type,name,tbl_name,sql FROM sqlite_master "
                "WHERE (name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence') "
                "AND tbl_name <> ? ORDER BY type,name",
                ("kiokudo_deployment_identity",),
            )
        ]
        issues = []
        if not MANDATORY.issubset(tables):
            issues.append("Missing required tables: " + ",".join(sorted(MANDATORY - set(tables))))
        result = {}
        for name in tables:
            if name in STAGING_ONLY:
                continue
            columns = [
                {"name": r[1], "type": r[2], "notnull": bool(r[3]),
                 "default": r[4], "pk": int(r[5])}
                for r in cx.execute("PRAGMA table_info(" + sql_identifier(name) + ")")
            ]
            fk = [list(r)[1:] for r in cx.execute(
                "PRAGMA foreign_key_list(" + sql_identifier(name) + ")")]
            indexes = []
            for ix in cx.execute("PRAGMA index_list(" + sql_identifier(name) + ")"):
                idx_name = ix[1]
                indexes.append({
                    "name": idx_name, "unique": bool(ix[2]), "origin": ix[3],
                    "partial": bool(ix[4]),
                    "columns": [c[2] for c in cx.execute(
                        "PRAGMA index_info(" + sql_identifier(idx_name) + ")")],
                })
            indexes.sort(key=lambda item: item["name"])
            result[name] = {
                "columns": columns, "foreign_keys": fk, "indexes": indexes,
                **digest_table(cx, name, columns),
            }
        # Includes only file digest, no raw records or secret tokens.
        file_sha = hashlib.sha256()
        with file.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                file_sha.update(chunk)
        return {
            "file_name": file.name, "file_sha256": file_sha.hexdigest(),
            "tables": result, "issues": issues, "schema_objects": schema_objects,
            "staging_identity_table_present": "kiokudo_deployment_identity" in tables,
        }
    finally:
        cx.close()


def compare(baseline: dict, candidate: dict):
    diffs = []
    base_tables = baseline["tables"]
    dest_tables = candidate["tables"]
    for name in sorted(set(base_tables) | set(dest_tables)):
        a = base_tables.get(name)
        b = dest_tables.get(name)
        if a is None or b is None:
            diffs.append({"table": name, "kind": "table_missing_or_extra",
                          "baseline_present": a is not None, "staging_present": b is not None})
            continue
        for key in ("columns", "foreign_keys", "indexes", "count", "sha256"):
            if a[key] != b[key]:
                diff = {"table": name, "kind": key}
                if key in ("count", "sha256"):
                    diff.update({"baseline": a[key], "staging": b[key]})
                diffs.append(diff)
    if baseline["schema_objects"] != candidate["schema_objects"]:
        diffs.append({"table": "*", "kind": "schema_objects"})
    if not candidate["staging_identity_table_present"]:
        diffs.append({"table": "kiokudo_deployment_identity", "kind": "staging_marker_table_missing"})
    return {
        "passed": not diffs and not baseline["issues"] and not candidate["issues"],
        "baseline": {
            "file_sha256": baseline["file_sha256"],
            "tables": {k: {"count": v["count"], "sha256": v["sha256"]}
                       for k, v in base_tables.items()},
            "issues": baseline["issues"],
        },
        "staging": {
            "file_sha256": candidate["file_sha256"],
            "tables": {k: {"count": v["count"], "sha256": v["sha256"]}
                       for k, v in dest_tables.items()},
            "issues": candidate["issues"],
            "staging_identity_table_present": candidate["staging_identity_table_present"],
        },
        "differences": diffs,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, help="verified read-only production EXPORT snapshot (local file)")
    parser.add_argument("--staging", required=True, help="separate checkpointed staging EXPORT snapshot (local file)")
    parser.add_argument("--report", required=True, help="new local JSON report path (never commit)")
    args = parser.parse_args()
    try:
        baseline = inspect(args.baseline)
        candidate = inspect(args.staging)
        report = compare(baseline, candidate)
        out = Path(args.report)
        if out.exists():
            raise ValueError("Report already exists; refusing overwrite")
        import os
        fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
        print("PASS" if report["passed"] else "FAIL",
              "- snapshot content/schema parity (report: " + str(out) + ")")
        sys.exit(0 if report["passed"] else 1)
    except (ValueError, OSError, sqlite3.Error) as exc:
        print("BLOCKED: " + str(exc), file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
