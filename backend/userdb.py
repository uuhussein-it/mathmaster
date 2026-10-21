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

from flask import g, has_app_context

import db

DATABASE_URL = os.environ.get("DATABASE_URL", "").strip()
POSTGRES = DATABASE_URL.startswith(("postgres://", "postgresql://"))

_pool = None
_pool_pid = None
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

    _conn = None

    def __init__(self, pool=None):
        """From the pool, or (pool=None) a direct connection of its own."""
        self._pool = pool
        if pool is None:
            import psycopg
            self._conn = psycopg.connect(DATABASE_URL, connect_timeout=15, **_CONN_KWARGS)
        else:
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
            conn, self._conn = self._conn, None
            try:
                conn.rollback()  # end a read-only transaction (uncommitted writes are dropped, as in sqlite3)
            except Exception:
                pass  # a broken connection: the pool discards it
            if self._pool is None:
                conn.close()
            else:
                self._pool.putconn(conn)

    # A request that fails between connect() and close() must still hand its
    # connection back, or the pool runs dry and every later request times out.
    __del__ = close


_CONN_KWARGS = {"row_factory": _row_factory,
                # no server-side prepared statements: safe behind Neon's pooler
                "prepare_threshold": None}


def _get_pool():
    """This process's pool. gunicorn can load the app and then fork its
    workers; a pool made before the fork has lost its background threads, so
    it never opens a new connection. Each process therefore makes its own."""
    global _pool, _pool_pid
    with _pool_lock:
        if _pool is None or _pool_pid != os.getpid():
            from psycopg_pool import ConnectionPool
            # Neon closes idle connections, so each one is checked before use.
            _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=10, open=True, timeout=20,
                                   check=ConnectionPool.check_connection, kwargs=_CONN_KWARGS)
            _pool_pid = os.getpid()
            atexit.register(_pool.close)
    return _pool


class _RequestConn:
    """The request's shared connection. close() leaves it open for the rest of
    the request; Flask's teardown ends it (rolling back anything uncommitted,
    as closing a sqlite3 connection would)."""

    def __init__(self, conn):
        self._shared = conn

    def __getattr__(self, name):
        return getattr(self._shared, name)

    def close(self):
        pass


def connect():
    if not POSTGRES:
        return db.get_conn()
    if not has_app_context():
        return _PgConn()  # startup: no pool before gunicorn forks
    # One connection per request: Neon is a network hop away, so opening one
    # per query is slow, and a request never holds more than one pool slot.
    if "userdb_conn" not in g:
        g.userdb_conn = _PgConn(_get_pool())
    return _RequestConn(g.userdb_conn)


def close_request_connections(_exc=None):
    """Flask teardown: hand the request's connection back to the pool."""
    conn = g.pop("userdb_conn", None)
    if conn is not None:
        conn.close()


def pool_stats():
    return _pool.get_stats() if _pool is not None and _pool_pid == os.getpid() else None


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


def add_column(table, column, decl):
    """Add a column to an existing table if it isn't there yet."""
    conn = connect()
    if POSTGRES:
        decl = re.sub(r"\bREAL\b", "DOUBLE PRECISION", decl)
        conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {decl}")
    elif column not in [r[1] for r in conn.execute(f"PRAGMA table_info({table})")]:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")
    conn.commit()
    conn.close()
