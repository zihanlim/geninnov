"""
Apply one or more SQL migration files to the live Supabase database.
Usage: python apply_migration.py <migration_file.sql> [migration_file2.sql ...]
"""
from __future__ import annotations

import os
import sys

import psycopg2
from dotenv import load_dotenv

load_dotenv()


def get_db_params() -> dict:
    host = os.getenv("SUPABASE_DB_HOST")
    port = os.getenv("SUPABASE_DB_PORT", "5432")
    dbname = os.getenv("SUPABASE_DB_NAME", "postgres")
    user = os.getenv("SUPABASE_DB_USER", "postgres")
    password = os.getenv("SUPABASE_DB_PASSWORD")
    if not password:
        password = os.getenv("SUPABASE_SERVICE_KEY", "")
    if not host or not password:
        raise RuntimeError("Missing SUPABASE_DB_HOST / SUPABASE_DB_PASSWORD in environment")
    return {
        "host": host,
        "port": port,
        "dbname": dbname,
        "user": user,
        "password": password,
        "sslmode": "require",
    }


def apply_migration(sql_path: str) -> None:
    with open(sql_path, encoding="utf-8") as f:
        sql = f.read()

    conn = psycopg2.connect(**get_db_params())
    conn.autocommit = True
    cur = conn.cursor()

    migration_name = os.path.basename(sql_path)
    print(f"Applying {migration_name} ...")

    try:
        cur.execute(sql)
        print(f"  OK: {migration_name} applied")
    except psycopg2.Error as e:
        print(f"  FAIL: {migration_name} failed: {e.pgerror}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python apply_migration.py <file.sql> [file2.sql ...]")
        sys.exit(1)
    for path in sys.argv[1:]:
        apply_migration(path)
