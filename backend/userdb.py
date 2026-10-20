"""Where student accounts, progress and teacher edits are kept.

The question bank ships with the code in data/sat.db, which a fresh deploy
replaces. Everything people create while using the site (accounts, profiles,
the school list, feedback, hidden questions, edited answers, teacher
questions) goes through `connect()` instead:

* with DATABASE_URL set (a Postgres link, e.g. a free Neon database) it is
  stored there and survives redeploys;
* without it, it falls back to the same SQLite file as the bank.

SQL is written once in the subset both understand: `?` placeholders,
`ON CONFLICT ... DO UPDATE/NOTHING`, and `insert()` for new ids.
"""
import atexit
import os
import re
import threading

import db

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

_pool = None
_pool_lock = threading.Lock()


class Row(dict):
    """A dict row that, like sqlite3.Row, also takes a column number."""

    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self.values())[key]
        return super().__getitem__(key)


def _row_factory(cursor):
    names = [c.name for c in cursor.description or []]
    return lambda values: Row(zip(names, values))


def _sql(query):
    return query.replace("?", "%s")


class _PgConn:
    """Enough of sqlite3.Connection's interface for this app, over psycopg."""

    def __init__(self, pool):
        self._pool = pool
        self._conn = pool.getconn()

    def execute(self, query, params=()):
        return self._conn.execute(_sql(query), params or None)

    def executemany(self, query, rows):
        cur = self._conn.cursor()
        cur.executemany(_sql(query), rows)
        return cur

    def executescript(self, script):
        for statement in script.split(";"):
            if statement.strip():
                self._conn.execute(statement)

    def commit(self):
        self._conn.commit()

    def close(self):
        if self._conn is not None:
            self._conn.rollback()  # end a read-only transaction (uncommitted writes are dropped, as in sqlite3)
            self._pool.putconn(self._conn)
            self._conn = None


def _get_pool():
    global _pool
    with _pool_lock:
        if _pool is None:
            from psycopg_pool import ConnectionPool
            # Neon closes idle connections, so each one is checked before use.
            _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=5, open=True,
                                   check=ConnectionPool.check_connection,
                                   kwargs={"row_factory": _row_factory})
            atexit.register(_pool.close)
    return _pool


def connect():
    if POSTGRES:
        return _PgConn(_get_pool())
    return db.get_conn()


def insert(conn, query, params=()):
    """Run an INSERT and return the new row's id."""
    if POSTGRES:
        return conn.execute(query + " RETURNING id", params).fetchone()["id"]
    return conn.execute(query, params).lastrowid


def create_tables(script):
    """CREATE TABLE statements written for SQLite, adapted for Postgres."""
    conn = connect()
    if POSTGRES:
        script = script.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
        script = script.replace(" COLLATE NOCASE", "")  # emails are stored lower-case
        script = re.sub(r"\bREAL\b", "DOUBLE PRECISION", script)
    conn.executescript(script)
    conn.commit()
    conn.close()
