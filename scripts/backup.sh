#!/bin/bash
# Backup script for PostgreSQL database
# Usage: ./scripts/backup.sh

# Ensure we are in the project root (or wherever the script is run from, assuming it's the backend root)
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$(dirname "$DIR")"

cd "$PROJECT_ROOT" || exit 1

# Load environment variables from .env if it exists
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL is not set. Please check your .env file."
  exit 1
fi

# Define backup directory and ensure it exists
BACKUP_DIR="$PROJECT_ROOT/backups"
mkdir -p "$BACKUP_DIR"

# Generate backup filename with timestamp
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="$BACKUP_DIR/xpertlink_db_$TIMESTAMP.dump"

echo "Starting database backup..."
# Use custom format (-F c) for easy restoration with pg_restore
pg_dump "$DATABASE_URL" -F c -f "$BACKUP_FILE"

if [ $? -eq 0 ]; then
  echo "✅ Backup successfully saved to $BACKUP_FILE"
  # Keep only the last 7 days of backups
  find "$BACKUP_DIR" -type f -name "*.dump" -mtime +7 -exec rm {} \;
  echo "Old backups cleaned up."
else
  echo "❌ Backup failed!"
  exit 1
fi
