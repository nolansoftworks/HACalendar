#!/bin/sh
# Back up Home Assistant's config volume -- Phase 5.
#
# This runs INSIDE the HA container, called by `shell_command.backup_config`
# from a nightly automation. That is deliberate: this is HA *Container*, so
# there is no Supervisor and no snapshot button ([ADR-0011], [ADR-0023]), and
# doing it in-container means the schedule works the same whether the server
# is Windows, macOS or Linux -- no host cron, no Task Scheduler, nothing that
# has to be set up twice.
#
# What is in that volume: every `local_calendar` .ics, every `local_todo` list,
# the label registry that *is* the household roster ([ADR-0026]), and the
# entity registry that ties them together. Losing it loses the family's
# calendar and every chore. There is nowhere else it lives.
#
# Busybox `sh`, not bash -- the HA image is Alpine. No arrays, no [[ ]], and
# `ls -1t | tail -n +N` rather than anything clever for retention.

set -eu

DEST=${BACKUP_DEST:-/backup}
# Keep two weeks. Enough to notice "the calendar has been wrong since Tuesday"
# and still have a copy from before it was.
KEEP=${BACKUP_KEEP:-14}
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/nolanhaus-$STAMP.tar.gz"

if [ ! -d "$DEST" ]; then
  echo "backup: $DEST is not mounted -- add it to docker-compose.yml" >&2
  exit 1
fi

# Excluded on purpose:
#   home-assistant_v2.db*  the recorder history. Large, rebuilt on its own, and
#                          a live SQLite file is the one thing tar cannot copy
#                          consistently. The logbook's chore record lives here
#                          ([ADR-0014]) -- history is worth less than a
#                          restorable calendar, and copying it torn is worse
#                          than not copying it.
#   www/hacalendar         build output. `npm run build` remakes it.
#   deps, tts, *.log       caches and noise.
tar czf "$OUT" \
  --exclude='config/home-assistant_v2.db' \
  --exclude='config/home-assistant_v2.db-wal' \
  --exclude='config/home-assistant_v2.db-shm' \
  --exclude='config/www/hacalendar' \
  --exclude='config/deps' \
  --exclude='config/tts' \
  --exclude='config/*.log' \
  --exclude='config/*.log.*' \
  -C / config

SIZE=$(wc -c < "$OUT" | tr -d ' ')

# A backup nobody checks is a backup nobody has. Fail loudly on an absurdly
# small archive -- an empty tar still exits 0, and would quietly "succeed"
# every night for a year.
#
# Delete it too. A run of these would otherwise age out every real backup
# through the retention rule below, which is the exact failure the check
# exists to catch.
if [ "$SIZE" -lt 4096 ]; then
  rm -f "$OUT"
  echo "backup: archive was only $SIZE bytes -- discarded, /config looks empty" >&2
  exit 1
fi

# Retention. Newest first, drop everything past $KEEP.
ls -1t "$DEST"/nolanhaus-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) |
  while read -r old; do
    rm -f "$old"
    echo "backup: pruned $old"
  done

HELD=$(ls -1 "$DEST"/nolanhaus-*.tar.gz 2>/dev/null | wc -l | tr -d ' ')
echo "backup: wrote $OUT ($SIZE bytes), $HELD kept"
