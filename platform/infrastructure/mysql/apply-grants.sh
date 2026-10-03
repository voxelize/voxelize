#!/bin/sh
# Grants the runtime application user table-level privileges after every
# migration. Append-only tables get SELECT and INSERT only, so no bug in
# the application can rewrite ledger or audit history (docs/SECURITY.md §6).
set -eu

APPEND_ONLY="ledger_entries ledger_transactions audit_logs game_tickets"
mysql_cmd() {
  mysql -h"$DB_HOST" -P"${DB_PORT:-3306}" -uroot -p"$MYSQL_ROOT_PASSWORD" -N -B "$@"
}

mysql_cmd -e "CREATE USER IF NOT EXISTS '$APP_DB_USER'@'%' IDENTIFIED BY '$APP_DB_PASSWORD'; REVOKE ALL PRIVILEGES, GRANT OPTION FROM '$APP_DB_USER'@'%';"

for table in $(mysql_cmd -e "SELECT table_name FROM information_schema.tables WHERE table_schema = '$DB_DATABASE'"); do
  case " $APPEND_ONLY " in
    *" $table "*) privileges="SELECT, INSERT" ;;
    *) privileges="SELECT, INSERT, UPDATE, DELETE" ;;
  esac
  mysql_cmd -e "GRANT $privileges ON \`$DB_DATABASE\`.\`$table\` TO '$APP_DB_USER'@'%';"
done
mysql_cmd -e "FLUSH PRIVILEGES;"
echo "grants applied for $APP_DB_USER on $DB_DATABASE"
