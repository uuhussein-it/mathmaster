"""Site-wide protections: session cookies, security headers, cross-site request
blocking, sign-in rate limits and roles.

Roles live in the signed, HTTP-only session cookie:
  student  session["student_id"] (backend/accounts.py)
  teacher  session["role"] == "teacher": questions, feedback, leaderboard
  admin    session["role"] == "admin": everything, incl. the school list,
           deleting accounts, resetting passwords and managing teachers
Both staff roles also set session["admin"], which older routes check.
"""
import os
import threading
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from flask import abort, request, session

CSP = ("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; "
       "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'")


def init(app):
    # Render serves over HTTPS; locally (http://127.0.0.1) a Secure cookie would never be sent.
    https = bool(os.environ.get("RENDER")) or os.environ.get("SESSION_COOKIE_SECURE") == "1"
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=https, PERMANENT_SESSION_LIFETIME=60 * 60 * 24 * 14,
                      MAX_CONTENT_LENGTH=8 * 1024 * 1024)
    app.before_request(_block_cross_site)
    app.after_request(_headers)


def _block_cross_site():
    """Changes may only come from this site's own pages (CSRF protection on top
    of the SameSite cookie): a browser always sends Origin on these requests."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    origin = request.headers.get("Origin") or request.headers.get("Referer")
    if origin and urlparse(origin).netloc != request.host:
        abort(403, "Requests from other sites are not allowed.")


def _headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    # The classic site uses inline scripts and KaTeX from a CDN, so it keeps no CSP.
    if resp.mimetype == "text/html" and not request.path.startswith("/classic"):
        # Older Safari doesn't count ws:// to the same host as 'self'; the arena needs it.
        resp.headers.setdefault("Content-Security-Policy", CSP.replace(
            "connect-src 'self'", f"connect-src 'self' wss://{request.host} ws://{request.host}"))
    if request.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    if request.is_secure or request.headers.get("X-Forwarded-Proto") == "https":
        resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return resp


# ------------------------------------------------------------------ rate limit
_hits = defaultdict(deque)
_hits_lock = threading.Lock()


def client_ip():
    # Render puts the visitor's address first in X-Forwarded-For.
    return (request.headers.get("X-Forwarded-For") or request.remote_addr or "").split(",")[0].strip()


def rate_limit(name, limit, window, key=None):
    """At most `limit` calls per `window` seconds per visitor (and per `key`,
    e.g. the email being tried), else 429."""
    bucket = f"{name}|{client_ip()}|{key or ''}"
    now = time.time()
    with _hits_lock:
        q = _hits[bucket]
        while q and q[0] < now - window:
            q.popleft()
        if len(q) >= limit:
            wait = int(q[0] + window - now) + 1
            abort(429, f"Too many attempts. Try again in {max(1, wait // 60) if wait >= 60 else wait} "
                       f"{'minutes' if wait >= 120 else 'minute' if wait >= 60 else 'seconds'}.")
        q.append(now)
        if len(_hits) > 50_000:  # forget idle visitors
            for k in [k for k, v in _hits.items() if not v or v[-1] < now - 3600]:
                del _hits[k]


# ----------------------------------------------------------------------- roles
def role():
    if session.get("role") in ("teacher", "admin"):
        return session["role"]
    return "admin" if session.get("admin") else None


def is_staff():
    return role() in ("teacher", "admin")


def is_owner():
    return role() == "admin"


def require_staff():
    if not is_staff():
        abort(401, "teacher login required")


def require_owner():
    if not is_owner():
        abort(403, "Only the admin can do this.")
