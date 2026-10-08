#!/usr/bin/env python3
"""Create an audited, disposable LOCAL SQLite staging clone from a verified export.

No network, Turso credentials, cloud API or production database connections.
Source is opened immutable/read-only; destination must be a NEW local file.
"""
import argparse
import hashlib
import os
from pathlib import Path
import re
import sqlite3
import sys

from audit_snapshots import compare, connect_read_only, inspect, MANDATORY

IDENTITY = "kiokudo_deployment_identity"
FIXTURE_MARKER = "kiokudo-local-json-fixture-not-production-v1"
EXTENSIONS = {".db", ".sqlite", ".sqlite3"}


def check_new_file(path: str, name: str) -> Path:
    if path.startswith("file:") or "://" in path:
        raise ValueError(f"{name} must be a local file path, not a database URL")
    raw = Path(path).expanduser().absolute()
    if raw.exists() or raw.is_symlink():
        raise ValueError(f"{name} already exists; refusing overwrite")
    dest = raw.resolve(strict=False)
    if dest.suffix.lower() not in (EXTENSIONS if name == "output" else {".json"}):
        raise ValueError(f"{name} must end in the expected local file extension")
    if dest.exists() or dest.is_symlink():
        raise ValueError(f"{name} already exists; refusing overwrite")
    if not dest.parent.is_dir():
        raise ValueError(f"{name} parent directory does not exist")
    return dest


def check_marker(marker: str) -> None:
    if len(marker) < 24 or not marker.strip() or marker == FIXTURE_MARKER:
        raise ValueError("Provide a distinct 24+ character local staging marker (not the public JSON-fixture marker)")


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as src:
        for part in iter(lambda: src.read(1 << 20), b""):
            h.update(part)
    return h.hexdigest()


def require_integrity(cx: sqlite3.Connection, context: str) -> None:
    row = cx.execute("PRAGMA integrity_check").fetchone()
    if row is None or row[0] != "ok":
        raise ValueError(f"{context}: SQLite integrity_check failed")
    if cx.execute("PRAGMA foreign_key_check").fetchone() is not None:
        raise ValueError(f"{context}: foreign_key_check failed")


def prepare_local_clone(
    source: str,
    output: str,
    report: str,
    marker: str,
    expected_source_sha256: str,
) -> dict:
    """Fail-closed: never overwrite; clean up only files created by this invocation."""
    if not re.fullmatch(r"[0-9a-fA-F]{64}", expected_source_sha256):
        raise ValueError("expected_source_sha256 must be independently verified 64-digit SHA-256")
    check_marker(marker)
    destination = check_new_file(output, "output")
    report_path = check_new_file(report, "report")
    if destination == report_path:
        raise ValueError("output and report must be different files")

    # inspect() enforces checkpointed, immutable read-only file access.
    before = inspect(source)
    source_file = Path(source).resolve(strict=True)
    if source_file == destination or source_file == report_path:
        raise ValueError("Source, destination and report must be distinct files")
    if before["file_sha256"].lower() != expected_source_sha256.lower():
        raise ValueError("Source export checksum differs from expected hash")
    if before["issues"] or not MANDATORY.issubset(before["tables"]):
        raise ValueError("Source export lacks required learning tables")
    if before["staging_identity_table_present"]:
        raise ValueError("Source already carries a staging marker: not a clean baseline export")

    source_cx, _ = connect_read_only(source)
    try:
        require_integrity(source_cx, "baseline")
    finally:
        source_cx.close()

    # O_EXCL guarantees no existing file can be clobbered by a concurrent run.
    fd = os.open(destination, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(fd)
    successful = False
    report_created = False
    try:
        source_cx, _ = connect_read_only(source)
        dest_cx = sqlite3.connect(str(destination))
        try:
            source_cx.backup(dest_cx)
            dest_cx.commit()
            require_integrity(dest_cx, "new clone before marker")
            # Add ONLY the explicitly expected staging-only metadata table.
            dest_cx.execute(
                "CREATE TABLE kiokudo_deployment_identity "
                "(environment TEXT PRIMARY KEY, marker TEXT NOT NULL)"
            )
            dest_cx.execute(
                "INSERT INTO kiokudo_deployment_identity(environment,marker) VALUES (?,?)",
                ("staging", marker),
            )
            dest_cx.commit()
            require_integrity(dest_cx, "new clone after marker")
            actual_marker = dest_cx.execute(
                "SELECT marker FROM kiokudo_deployment_identity WHERE environment='staging'"
            ).fetchone()
            if actual_marker != (marker,):
                raise ValueError("Staging marker verification failed")
        finally:
            dest_cx.close()
            source_cx.close()

        after = inspect(source)
        if after["file_sha256"] != before["file_sha256"]:
            raise ValueError("Source export changed while copying: discard clone")
        actual = inspect(str(destination))
        result = compare(before, actual)
        if not result["passed"]:
            raise ValueError("Local clone schema/content parity failed; discard clone")

        result["provenance"] = {
            "kind": "local-checkpointed-sqlite-export-clone",
            "source_sha256_verified": True,
            "baseline_unchanged": True,
            "remote_turso_used": False,
            "staging_marker_verified": True,
        }
        # x mode avoids report overwrites; caller stores this privately.
        import json
        report_fd = os.open(report_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        report_created = True
        with os.fdopen(report_fd, "w", encoding="utf-8") as handle:
            json.dump(result, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
        successful = True
        return result
    finally:
        if not successful:
            destination.unlink(missing_ok=True)
            if report_created:
                report_path.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, help="local checkpointed SQLite export (never live DB)")
    parser.add_argument("--output", required=True, help="NEW, disposable local .db/.sqlite destination")
    parser.add_argument("--report", required=True, help="NEW, PRIVATE local .json report")
    parser.add_argument("--expected-sha256", required=True, help="independently recorded source export SHA-256")
    args = parser.parse_args()
    marker = os.environ.get("KIOKUDO_LOCAL_CLONE_MARKER", "")
    try:
        result = prepare_local_clone(
            args.source, args.output, args.report, marker, args.expected_sha256
        )
        print(
            "PASS: offline clone; ",
            len(result["baseline"]["tables"]),
            "application tables match source export (including all data values).",
        )
        return 0
    except (ValueError, OSError, sqlite3.Error) as err:
        print(f"BLOCKED: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
