# Offline production-export → local staging clone rehearsal

This step is an **offline safety exercise**, not a Turso migration or permission to cut over.

The script accepts one *previously exported and checkpointed* SQLite file,
verified against an **independently recorded SHA-256**, and creates a **NEW**
local clone while preserving every existing table, ID, review event, state,
index, trigger and view. It then adds exactly one staging identity table
in the clone and runs the read-only full schema/data parity audit.

It NEVER connects to remote Turso or production. The source is opened
read-only/immutable. All operations require local paths, the destination
must not exist, and a failed clone is removed. Source and report remain
outside GitHub and public artifacts. The separate copy is not a backup strategy
for a live Turso instance.

## Local use (after a trusted checkpointed export exists)

Record the export SHA-256 through a separate, trustworthy channel.

```bash
export KIOKUDO_LOCAL_CLONE_MARKER='<unique-local-only-marker-at-least-24-characters>'
python3 scripts/prepare_local_staging_clone.py \
  --source /secure/verified-production-export.db \
  --output /secure/disposable-local-clone.db \
  --report /secure/disposable-clone-audit.json \
  --expected-sha256 '<independently-recorded-64-hex-sha256>'
```

Do not use the public fixture marker
`kiokudo-local-json-fixture-not-production-v1` for a real export.
The script requires a new destination and new report path and fails closed if
the source is corrupted, has a foreign-key violation or differs from its
expected checksum. If the clone is deliberately modified in experiments,
rollback is **discarding the clone and creating another from the verified export**,
not applying writes to production.

### Scope and limits

- SQLite `backup()` preserves raw data and DDL, unlike the earlier 316-card
  vocabulary rehearsal which creates synthetic fixture IDs.
- The audit compares all application rows/IDs/review logs. The only permitted
  extra table is `kiokudo_deployment_identity`.
- This script never provisions or writes to remote staging Turso.
- A live database using WAL must be exported safely using the supported Turso
  backup/export mechanism, with a consistent checkpoint. Never point this tool
  at an active SQLite file.
- Do not commit the source export, cloned database or report.
- This rehearsal does not prove that the export matches the *current* production
  data, nor validate permissions, OAuth redirects, FE parity or real Turso schema.

### Blocked next external gate

Obtain a separate Turso **staging** database with independently verified
organization, database ID and scoped credential, plus a trustworthy,
checkpointed export of production. Compare full local exports before any
approved remote staging import. Do not paste credentials into chat.
