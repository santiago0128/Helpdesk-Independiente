#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/home/dev/Helpdesk"
ENV_FILE="$APP_DIR/.env"
BACKUP_DIR="$APP_DIR/backups"
DB_BACKUP_DIR="$BACKUP_DIR/database"
ATTACHMENT_BACKUP_DIR="$BACKUP_DIR/attachments"
STATE_BACKUP_DIR="$BACKUP_DIR/state"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$DB_BACKUP_DIR" "$ATTACHMENT_BACKUP_DIR" "$STATE_BACKUP_DIR"
cd "$APP_DIR"
/usr/bin/node scripts/export-db.mjs "$DB_BACKUP_DIR/helpdesk-$STAMP.json.gz"
tar -czf "$ATTACHMENT_BACKUP_DIR/attachments-$STAMP.tar.gz" -C "$APP_DIR/storage" uploads
tar -czf "$STATE_BACKUP_DIR/state-$STAMP.tar.gz" -C "$APP_DIR/storage" state
find "$DB_BACKUP_DIR" "$ATTACHMENT_BACKUP_DIR" "$STATE_BACKUP_DIR" -type f -mtime +14 -delete
echo "Backup completado: $STAMP"
