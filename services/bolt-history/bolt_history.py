#!/usr/bin/env python3
"""bolt-history — server-side chat history backed by PostgreSQL.

Chat history normally lives in the browser's IndexedDB: the phone and the desktop keep two
separate databases, which is why a conversation started on one never shows up on the other.
This service makes the VPS the source of truth; IndexedDB stays as a local cache.

Storage is PostgreSQL (the VPS already runs it for other services), reached over TCP on
127.0.0.1 with a dedicated `bolt_history` role. The service is stdlib-only and bound to
127.0.0.1: nginx is the only way in and it enforces the bolt-auth session, so no conversation
is ever served anonymously.

Routes
    GET    /health          -> {ok, chats, backend, database}
    GET    /history         -> {chats: [...] WITHOUT messages, deleted: [{id, urlId, deletedAt}]}
                               (deleted = this owner's tombstones of the last 90 days)
    GET    /history/<id>    -> one full ChatHistoryItem
    PUT    /history/<id>    -> create or replace a chat (idempotent); 410 if the owner deleted it
    DELETE /history/<id>    -> delete a chat and leave a tombstone
    GET    /projects        -> the owner's published projects
    PUT    /projects/<slug> -> record a published project (owner only, /container/ url)
"""

import json
import os
import re
import subprocess
import sys
import zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = "127.0.0.1"
PORT = int(os.environ.get("BOLT_HISTORY_PORT", "8200"))

PG_HOST = os.environ.get("BOLT_HISTORY_PG_HOST", "127.0.0.1")
PG_PORT = os.environ.get("BOLT_HISTORY_PG_PORT", "5432")
PG_USER = os.environ.get("BOLT_HISTORY_PG_USER", "bolt_history")
PG_DB = os.environ.get("BOLT_HISTORY_PG_DB", "bolt_history")
PG_PASSWORD = os.environ.get("BOLT_HISTORY_PG_PASSWORD", "")

# A chat id comes from the app and is used in a URL path: keep it to a safe charset.
ID_RE = re.compile(r"^[A-Za-z0-9_.:-]{1,128}$")

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)

# Chats can be large (whole conversations plus metadata), but not unbounded.
MAX_BODY = 10 * 1024 * 1024

# The app gzips large saves (a long Agent conversation is ~1 MB of JSON, ~10x smaller
# compressed). The decompressed size gets its own cap so a small compressed body cannot
# expand into gigabytes (zip bomb).
MAX_DECOMPRESSED_BODY = 40 * 1024 * 1024

def gunzip_bounded(raw, limit):
    """Decompress a gzip body, refusing anything that expands past `limit` bytes."""
    decompressor = zlib.decompressobj(16 + zlib.MAX_WBITS)

    try:
        data = decompressor.decompress(raw, limit + 1)
    except zlib.error:
        return None, "invalid gzip body"

    if len(data) > limit or decompressor.unconsumed_tail:
        return None, "body too large"

    if not decompressor.eof:
        return None, "invalid gzip body"

    return data, None


# A published project's URL is rendered as a link in the app: only a same-origin
# /container/<slug>/ path is accepted, never `javascript:` or another site.
PROJECT_URL_RE = re.compile(r"^/container/[a-z0-9][a-z0-9-]*/[A-Za-z0-9._~/%-]*$")

# How far back GET /history reports deletions to the other devices.
TOMBSTONE_DAYS = 90

SCHEMA = """
CREATE TABLE IF NOT EXISTS chats (
    id          TEXT PRIMARY KEY,
    url_id      TEXT,
    description TEXT,
    timestamp   TEXT NOT NULL,
    metadata    JSONB,
    messages    JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chats_timestamp ON chats (timestamp DESC);

-- Every site published from the "Publier" button lands here, so the published URLs survive
-- a browser wipe and are visible from any device. One row per slug: republishing a project
-- updates its row (see the ON CONFLICT in do_PUT of /projects).
CREATE TABLE IF NOT EXISTS projects (
    slug        TEXT PRIMARY KEY,
    name        TEXT,
    url         TEXT NOT NULL,
    chat_id     TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_projects_published_at ON projects (published_at DESC);

-- One row, id 'default': this install has a single user, so the profile is a singleton
-- rather than a table keyed by account.
CREATE TABLE IF NOT EXISTS profile (
    id         TEXT PRIMARY KEY,
    username   TEXT,
    bio        TEXT,
    avatar     TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deletions, per owner. Without them a chat deleted on one device was pushed straight
-- back by any other device that still held a copy: the server list no longer had it, so
-- the client took its local copy for the newest one. GET /history exposes recent rows,
-- and PUT /history/<id> refuses (410) an id its owner deleted.
CREATE TABLE IF NOT EXISTS chat_tombstones (
    id         TEXT NOT NULL,
    url_id     TEXT,
    user_id    UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_tombstones_owner ON chat_tombstones (user_id, deleted_at DESC);
-- Tombstones go with the account (RGPD). `users` belongs to bolt-accounts' migrations, so
-- the key is only added where that table exists.
DO $$ BEGIN
    IF to_regclass('users') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chat_tombstones_user_id_fkey'
    ) THEN
        ALTER TABLE chat_tombstones ADD CONSTRAINT chat_tombstones_user_id_fkey
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
    END IF;
END $$;
"""

# Columns selected for a full chat, in the order row_to_chat expects.
# Escaped with sql_escaped() where the constant is used: a free-text column can hold the record
# separator, which would otherwise cut the row in the middle and break JSON parsing.
CHAT_COLUMNS = [
    "id",
    "coalesce(url_id,'')",
    "coalesce(description,'')",
    "timestamp",
    "coalesce(metadata::text,'')",
    "coalesce(messages::text,'[]')",
]


class DatabaseError(RuntimeError):
    """Raised when PostgreSQL rejects a statement or cannot be reached."""


def _require_owner(handler):
    """The identity rows are scoped to, or a 401 when the request carries none.

    Without this the missing header reached psql as the literal `''::uuid`, which raises
    `invalid input syntax for type uuid` and turned an unauthenticated request into a 500.
    """
    owner = owner_id(handler)

    if owner is None:
        handler._error(401, "not authenticated")
        return None

    return owner


def owner_id(handler):
    """The authenticated user id, set by nginx from the verified session.

    Empty on an unauthenticated request (which the gate prevents anyway), and validated here
    because this service must not trust a header blindly.
    """
    raw = (handler.headers.get("X-Bolt-User-Id") or "").strip()

    return raw if UUID_RE.match(raw) else None


def _run_sql(sql, params=None, fetch=True):
    """Run one statement through psql.

    Stdlib-only by design: no psycopg dependency to install or keep patched. Values travel as
    psql variables used inside single quotes, so nothing is concatenated into SQL text — an id
    such as `a'b` cannot break out of its literal (psql escapes :'name' for us).
    """
    args = [
        "psql",
        "-h",
        PG_HOST,
        "-p",
        str(PG_PORT),
        "-U",
        PG_USER,
        "-d",
        PG_DB,
        "-v",
        "ON_ERROR_STOP=1",
        "-tA",  # tuples only, unaligned: one line per row
        "-F",
        ROW_SEP,  # record separator: every field is escaped first (see escape_field)
        "-q",
        "-f",
        "-",
    ]

    script = ""

    for name, value in (params or {}).items():
        if value is None:
            # :'name' would expand to the literal string 'NULL' — an invalid jsonb. The
            # SQL casts the variable with nullif() so an absent value stays a real NULL.
            script += "\\set %s ''\n" % name
        else:
            # psql :'name' quoting does the SQL escaping; the \set line itself is escaped
            # here so a value containing a quote or a backslash cannot break the file.
            if isinstance(value, str) and ("\n" in value or "\r" in value):
                # psql reads the script line by line: a raw newline ends the \set line early
                # and the statement fails. validate_chat strips these from the free-text
                # fields; this is the last line of defence for any future field.
                raise DatabaseError("value %r contains a raw newline" % name)

            escaped = str(value).replace("\\", "\\\\").replace("'", "''")
            script += "\\set %s '%s'\n" % (name, escaped)

    script += sql

    env = dict(os.environ, PGPASSWORD=PG_PASSWORD)

    try:
        result = subprocess.run(args, input=script, capture_output=True, text=True, timeout=30, env=env)
    except FileNotFoundError as exc:
        raise DatabaseError("psql is not installed") from exc
    except subprocess.TimeoutExpired as exc:
        raise DatabaseError("database timeout") from exc

    if result.returncode != 0:
        raise DatabaseError(result.stderr.strip() or "query failed")

    if not fetch:
        return []

    return [line for line in result.stdout.split("\n") if line != ""]


def init_schema():
    """Create the table and index on first use. Safe to call repeatedly."""
    _run_sql(SCHEMA, fetch=False)


def json_bytes(payload, status=200):
    return status, json.dumps(payload, ensure_ascii=False).encode("utf-8")


def _log_database_error(context, exc):
    """Record a DatabaseError server-side, keeping psql internals out of the HTTP body.

    psql's stderr carries constraint names, column names and the failing SQL fragment. Returning
    it verbatim ("%s" % exc) handed an attacker the schema and the query; the client only needs to
    know the write failed. The detail is written to the journal, where the operator can read it.
    """
    sys.stderr.write("[bolt-history] %s: database error: %s\n" % (context, exc))


def validate_chat(payload):
    """Return (chat, error). A chat must at least carry an id, a timestamp and messages."""
    if not isinstance(payload, dict):
        return None, "body must be a JSON object"

    chat_id = payload.get("id")

    if not isinstance(chat_id, str) or not ID_RE.match(chat_id):
        return None, "invalid or missing id"

    if not isinstance(payload.get("messages"), list):
        return None, "messages must be a list"

    timestamp = payload.get("timestamp")

    if not isinstance(timestamp, str) or not timestamp:
        return None, "timestamp must be a non-empty string"

    url_id = payload.get("urlId")

    if url_id is not None and not isinstance(url_id, str):
        return None, "urlId must be a string when present"

    description = payload.get("description")

    if description is not None and not isinstance(description, str):
        return None, "description must be a string when present"

    if isinstance(description, str) and ("\n" in description or "\r" in description):
        # A conversation title never needs a line break, and one broke the psql script the
        # value travels in: `PUT /history/<id>` answered 500 for such a title.
        payload = {**payload, "description": " ".join(description.splitlines()).strip()}

    metadata = payload.get("metadata")

    if metadata is not None and not isinstance(metadata, dict):
        return None, "metadata must be an object when present"

    return payload, None


# psql -tA returns one line per row; fields are joined with ROW_SEP. Free text (a title, a urlId)
# may legitimately contain any of those characters, so every field is escaped before it travels
# and unescaped here: one chat titled with a control character used to break the WHOLE history
# list (502 for every device).
# Field separator of the psql output, and the SQL fragments that escape free text so that no
# title, urlId or project name can ever break another row (see escape_field below).
SQL_ESCAPE = (
    "replace(replace(replace(replace(replace({expr}, '\\', '\\\\'), chr(30), '\\e'), "
    "chr(31), '\\x'), chr(10), '\\n'), chr(13), '\\r')"
)


def sql_escaped(expression):
    """SQL expression that escapes a text column the same way escape_field() does."""

    return SQL_ESCAPE.format(expr=expression)


CHAT_LIST_SQL = (
    "SELECT "
    + ", ".join(
        sql_escaped(column)
        for column in (
            "id",
            "coalesce(url_id,'')",
            "coalesce(description,'')",
            "coalesce(timestamp,'')",
            "coalesce(metadata::text,'')",
        )
    )
    + " FROM chats WHERE user_id = :'owner'::uuid ORDER BY timestamp DESC;"
)

PROJECTS_SQL = (
    "SELECT "
    + ", ".join(
        sql_escaped(column)
        for column in (
            "slug",
            "coalesce(name,'')",
            "url",
            "coalesce(chat_id,'')",
            "to_char(published_at, 'YYYY-MM-DD\"T\"HH24:MI:SSOF')",
        )
    )
    + " FROM projects WHERE user_id = :'owner'::uuid ORDER BY published_at DESC;"
)

TOMBSTONES_SQL = (
    "SELECT "
    + ", ".join(
        sql_escaped(column)
        for column in (
            "id",
            "coalesce(url_id,'')",
            "to_char(deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')",
        )
    )
    + " FROM chat_tombstones WHERE user_id = :'owner'::uuid "
    "AND deleted_at > now() - interval '%d days' ORDER BY deleted_at DESC;"
)

ROW_SEP = "\x1e"
def escape_field(value):
    """Invertible: a backslash escapes the ONE character after it, so no escape is ever re-escaped.

    A backslash becomes two, and each separator becomes a backslash plus a letter (see codes in
    unescape_field). Inverting is therefore a single left-to-right pass.
    """
    text = "" if value is None else str(value)
    codes = {"\\": "\\\\", "\x1f": "\\x", "\x1e": "\\e", "\n": "\\n", "\r": "\\r", "\t": "\\t"}

    return "".join(codes.get(char, char) for char in text)


def unescape_field(value):
    """Inverse of escape_field(): one pass over the ESCAPED text, never over already-read chars."""
    # The letter after a backslash is the escaped character (see escape_field).
    codes = {"\\": "\\", "x": "\x1f", "e": "\x1e", "n": "\n", "r": "\r", "t": "\t"}
    out = []
    index = 0
    text = value

    while index < len(text):
        if text[index] == "\\" and index + 1 < len(text):
            out.append(codes.get(text[index + 1], text[index + 1]))
            index += 2
            continue

        out.append(text[index])
        index += 1

    return "".join(out)


def split_row(row):
    return [unescape_field(part) for part in row.split(ROW_SEP)]


def row_to_chat(row, with_messages=True):
    """One escaped row per chat: fields joined with ROW_SEP, JSON columns cast to text."""
    parts = split_row(row)

    if len(parts) < 5:
        raise DatabaseError("unexpected row shape")

    chat = {
        "id": parts[0],
        "urlId": None if parts[1] == "" else parts[1],
        "description": None if parts[2] == "" else parts[2],
        "timestamp": parts[3],
        "metadata": None if parts[4] == "" else json.loads(parts[4]),
    }

    if with_messages:
        if len(parts) < 6:
            raise DatabaseError("unexpected row shape")

        chat["messages"] = json.loads(parts[5])

    return chat


class Handler(BaseHTTPRequestHandler):
    server_version = "bolt-history"

    def log_message(self, fmt, *args):  # noqa: A003 - required override
        sys.stderr.write("[bolt-history] %s - %s\n" % (self.address_string(), fmt % args))

    # --- helpers ---------------------------------------------------------------

    def _send(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")

        try:
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            # The client hung up mid-response (a reload during a list, a closed tab). The
            # traceback that used to land in the journal proved nothing and hid real lines.
            return

    def _error(self, status, message):
        code, body = json_bytes({"ok": False, "error": message}, status)
        self._send(code, body)

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return None, "invalid Content-Length"

        if length <= 0:
            return None, "empty body"

        if length > MAX_BODY:
            return None, "body too large"

        raw = self.rfile.read(length)
        encoding = (self.headers.get("Content-Encoding") or "").strip().lower()

        if encoding == "gzip":
            raw, error = gunzip_bounded(raw, MAX_DECOMPRESSED_BODY)

            if error:
                return None, error
        elif encoding not in ("", "identity"):
            return None, "unsupported Content-Encoding"

        try:
            return json.loads(raw.decode("utf-8")), None
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return None, "invalid JSON: %s" % exc

    def _chat_id(self):
        parts = self.path.split("?", 1)[0].strip("/").split("/")

        if len(parts) != 2 or parts[0] != "history":
            return None

        return parts[1]

    def _resource(self):
        """Split '/<resource>/<name>' into its two parts, or (resource, None)."""
        path = self.path.split("?", 1)[0].strip("/")
        parts = path.split("/")

        if len(parts) == 1:
            return parts[0], None

        if len(parts) == 2:
            return parts[0], parts[1]

        return None, None

    # --- routes ----------------------------------------------------------------

    def do_GET(self):  # noqa: N802 - required by BaseHTTPRequestHandler
        path = self.path.split("?", 1)[0]

        if path == "/health":
            try:
                rows = _run_sql("SELECT count(*)::text FROM chats;")
                count = int(rows[0]) if rows else 0
            except DatabaseError as exc:
                _log_database_error("/health GET", exc)
                return self._error(500, "database error")

            code, body = json_bytes({"ok": True, "chats": count, "backend": "postgresql", "database": PG_DB})

            return self._send(code, body)

        if path == "/history":
            owner = _require_owner(self)

            if owner is None:
                return

            try:
                # Scoped to the owner: without this a signed-in user would list every account's
                # conversations.
                rows = _run_sql(CHAT_LIST_SQL, {"owner": owner})
                tombstones = _run_sql(TOMBSTONES_SQL % TOMBSTONE_DAYS, {"owner": owner})
            except DatabaseError as exc:
                _log_database_error("/history GET", exc)
                return self._error(500, "database error")

            chats = [row_to_chat(row, with_messages=False) for row in rows]
            deleted = []

            for row in tombstones:
                parts = split_row(row)
                deleted.append({"id": parts[0], "urlId": parts[1] or None, "deletedAt": parts[2]})

            code, body = json_bytes({"ok": True, "chats": chats, "deleted": deleted})

            return self._send(code, body)

        if path == "/projects":
            # Scoped to the owner like /history: the list used to return every account's
            # published sites to any signed-in user.
            owner = _require_owner(self)

            if owner is None:
                return

            try:
                rows = _run_sql(PROJECTS_SQL, {"owner": owner})
            except DatabaseError as exc:
                _log_database_error("/projects GET", exc)
                return self._error(500, "database error")

            projects = []

            for r in rows:
                slug, name, url, chat_id, published_at = split_row(r)[:5]
                projects.append(
                    {"slug": slug, "name": name, "url": url, "chatId": chat_id or None, "publishedAt": published_at}
                )

            code, body = json_bytes({"ok": True, "projects": projects})

            return self._send(code, body)

        if path == "/profile":
            try:
                # Every column goes through sql_escaped(), like CHAT_COLUMNS and PROJECTS_SQL:
                # an unescaped bio holding the record separator cut the row in the middle and
                # its tail surfaced in the avatar field, producing corrupt JSON.
                rows = _run_sql(
                    "SELECT "
                    + ", ".join(
                        sql_escaped(column)
                        for column in ("coalesce(username,'')", "coalesce(bio,'')", "coalesce(avatar,'')")
                    )
                    + " FROM profile WHERE id = 'default';"
                )
            except DatabaseError as exc:
                _log_database_error("/profile GET", exc)
                return self._error(500, "database error")

            if not rows:
                # No profile stored yet: an empty one, never a 404, so the client can merge.
                code, body = json_bytes({"ok": True, "profile": None})

                return self._send(code, body)

            parts = split_row(rows[0])
            code, body = json_bytes(
                {"ok": True, "profile": {"username": parts[0], "bio": parts[1], "avatar": parts[2]}}
            )

            return self._send(code, body)

        chat_id = self._chat_id()

        if chat_id is None:
            return self._error(404, "not found")

        if not ID_RE.match(chat_id):
            return self._error(400, "invalid id")

        owner = _require_owner(self)

        if owner is None:
            return

        try:
            # The browser puts the chat's urlId in the address bar (`/chat/2-1792165586520-0`)
            # while the server keys its rows on a short id (`4`). Reading by id alone made
            # every reload of a real conversation answer 404 — the chat existed, the lookup
            # just never matched. Accept either identifier.
            rows = _run_sql(
                "SELECT %s FROM chats WHERE (id = :'chat_id' OR url_id = :'chat_id') "
                "AND user_id = :'owner'::uuid;" % ", ".join(sql_escaped(column) for column in CHAT_COLUMNS),
                {"chat_id": chat_id, "owner": owner},
            )
        except DatabaseError as exc:
            _log_database_error("/history GET by id", exc)
            return self._error(500, "database error")

        if not rows:
            return self._error(404, "chat not found")

        code, body = json_bytes({"ok": True, "chat": row_to_chat(rows[0])})

        return self._send(code, body)

    def do_PUT(self):  # noqa: N802
        resource, name = self._resource()

        if resource == "projects":
            return self._put_project(name)

        if resource == "profile":
            return self._put_profile()

        if resource != "history":
            return self._error(404, "not found")

        chat_id = self._chat_id()

        if chat_id is None:
            return self._error(404, "not found")

        if not ID_RE.match(chat_id):
            return self._error(400, "invalid id")

        payload, error = self._read_body()

        if error:
            return self._error(400, error)

        if not isinstance(payload, dict):
            # A JSON array or string body has no .get(): without this guard the AttributeError
            # was raised OUTSIDE the try below, so the socket closed with no response and the
            # client saw a dropped connection instead of a 400. Same guard as _put_project /
            # _put_profile.
            return self._error(400, "body must be a JSON object")

        if payload.get("id") != chat_id:
            return self._error(400, "body id does not match the URL")

        chat, error = validate_chat(payload)

        if error:
            return self._error(400, error)

        # Checked last, so a malformed body is still a 400 (the gate in front of this
        # service is nginx's session check; here an absent identity becomes 401, not 500).
        owner = _require_owner(self)

        if owner is None:
            return

        try:
            # A chat this owner deleted must stay deleted: a device still holding a copy
            # would otherwise resurrect it. 410 tells the client to drop its copy.
            if _run_sql(
                "SELECT 1 FROM chat_tombstones WHERE id = :'chat_id' AND user_id = :'owner'::uuid;",
                {"chat_id": chat["id"], "owner": owner},
            ):
                return self._error(410, "deleted")

            rows = _run_sql(
                """
                INSERT INTO chats (id, url_id, description, timestamp, metadata, messages, user_id)
                VALUES (
                    :'chat_id',
                    :'url_id',
                    :'description',
                    :'timestamp',
                    nullif(:'metadata','')::jsonb,
                    :'messages'::jsonb,
                    nullif(:'owner','')::uuid
                )
                ON CONFLICT (id) DO UPDATE SET
                    url_id      = coalesce(nullif(EXCLUDED.url_id, ''), chats.url_id),
                    -- HONEST LIMITATION: an omitted field and an explicit empty string are
                    -- INDISTINGUISHABLE here. `chat.get("description")` is None for an omitted
                    -- key, and _run_sql binds a None as the psql variable '' — the exact same
                    -- literal an explicit "" binds. So the database cannot tell "the client
                    -- cleared this title" from "this partial save never carried one", and
                    -- coalesce() picks PRESERVE: a stale title is strictly less destructive than
                    -- erasing a real one on every partial save. Same treatment as url_id above.
                    -- (metadata avoids this only for an explicit JSON null, which binds to NULL.)
                    description = coalesce(nullif(EXCLUDED.description, ''), chats.description),
                    timestamp   = EXCLUDED.timestamp,
                    metadata    = coalesce(EXCLUDED.metadata, chats.metadata),
                    messages    = EXCLUDED.messages,
                    user_id     = coalesce(EXCLUDED.user_id, chats.user_id),
                    updated_at  = now()
                -- `id` is the table's key across ALL accounts. Without this guard a second
                -- account saving its own chat "1" overwrote the first account's chat "1" and
                -- took ownership of it. A row with no owner yet may still be claimed.
                WHERE chats.user_id IS NULL OR chats.user_id = EXCLUDED.user_id
                RETURNING id;
                """,
                {
                    "chat_id": chat["id"],
                    "url_id": chat.get("urlId"),
                    "description": chat.get("description"),
                    "timestamp": chat["timestamp"],
                    "metadata": json.dumps(chat.get("metadata")) if chat.get("metadata") else None,
                    "messages": json.dumps(chat["messages"], ensure_ascii=False),
                    "owner": owner,
                },
            )
        except DatabaseError as exc:
            _log_database_error("history PUT", exc)
            return self._error(500, "database error")

        if not rows:
            # The id belongs to another account: refuse rather than overwrite it.
            return self._error(409, "id already used")

        code, body = json_bytes({"ok": True, "id": chat["id"]})

        return self._send(code, body)

    def _put_project(self, slug):
        """Record a published site. Called after a successful build, never before."""
        if not slug or not ID_RE.match(slug):
            return self._error(400, "invalid slug")

        payload, error = self._read_body()

        if error:
            return self._error(400, error)

        if not isinstance(payload, dict):
            return self._error(400, "body must be a JSON object")

        url = payload.get("url")

        if not isinstance(url, str) or not url:
            return self._error(400, "url is required")

        # The url is rendered as a link: `javascript:` or an outside site must never be stored.
        if not PROJECT_URL_RE.match(url) or ".." in url:
            return self._error(400, "url must be a /container/<slug>/ path")

        # A project row is owned: without an identity it would be stored ownerless and
        # claimable by anyone.
        owner = _require_owner(self)

        if owner is None:
            return

        name = payload.get("name")
        chat_id = payload.get("chatId")

        if name is not None and not isinstance(name, str):
            return self._error(400, "name must be a string when present")

        if chat_id is not None and not isinstance(chat_id, str):
            return self._error(400, "chatId must be a string when present")

        try:
            rows = _run_sql(
                """
                INSERT INTO projects (slug, name, url, chat_id, user_id)
                VALUES (:'slug', :'name', :'url', nullif(:'chat_id',''), :'owner'::uuid)
                ON CONFLICT (slug) DO UPDATE SET
                    name         = EXCLUDED.name,
                    url          = EXCLUDED.url,
                    chat_id      = EXCLUDED.chat_id,
                    user_id      = EXCLUDED.user_id,
                    published_at = now()
                -- Same guard as chats: another account's project is never taken over.
                WHERE projects.user_id IS NULL OR projects.user_id = EXCLUDED.user_id
                RETURNING slug;
                """,
                {"slug": slug, "name": name, "url": url, "chat_id": chat_id, "owner": owner},
            )
        except DatabaseError as exc:
            _log_database_error("projects PUT", exc)
            return self._error(500, "database error")

        if not rows:
            return self._error(409, "slug already used")

        code, body = json_bytes({"ok": True, "slug": slug})

        return self._send(code, body)

    def _put_profile(self):
        """Store the single user's profile so it follows them between devices."""
        payload, error = self._read_body()

        if error:
            return self._error(400, error)

        if not isinstance(payload, dict):
            return self._error(400, "body must be a JSON object")

        for field in ("username", "bio", "avatar"):
            value = payload.get(field)

            if value is not None and not isinstance(value, str):
                return self._error(400, "%s must be a string when present" % field)

        try:
            _run_sql(
                """
                INSERT INTO profile (id, username, bio, avatar, updated_at)
                VALUES ('default', :'username', :'bio', :'avatar', now())
                ON CONFLICT (id) DO UPDATE SET
                    username   = EXCLUDED.username,
                    bio        = EXCLUDED.bio,
                    avatar     = EXCLUDED.avatar,
                    updated_at = now();
                """,
                {
                    "username": payload.get("username") or "",
                    "bio": payload.get("bio") or "",
                    "avatar": payload.get("avatar") or "",
                },
                fetch=False,
            )
        except DatabaseError as exc:
            _log_database_error("profile PUT", exc)
            return self._error(500, "database error")

        code, body = json_bytes({"ok": True})

        return self._send(code, body)

    def do_DELETE(self):  # noqa: N802
        owner = _require_owner(self)

        if owner is None:
            return

        chat_id = self._chat_id()

        if chat_id is None:
            return self._error(404, "not found")

        if not ID_RE.match(chat_id):
            return self._error(400, "invalid id")

        try:
            # Match either key. The browser's local record and the server row do not
            # always share a string: a chat created locally gets a client-side id while
            # the server stores the artifact-derived urlId separately, and the sidebar
            # knows the local one. Deleting on `id` alone silently removed nothing
            # (`removed: 0` with an HTTP 200) in that case, so the row survived and the
            # next sync pulled the "deleted" conversation straight back.
            # Each removed row leaves a tombstone so the other devices learn of the
            # deletion instead of pushing their copy back.
            rows = _run_sql(
                "WITH removed AS ("
                "DELETE FROM chats WHERE (id = :'chat_id' OR url_id = :'chat_id') "
                "AND user_id = :'owner'::uuid RETURNING id, url_id"
                "), buried AS ("
                "INSERT INTO chat_tombstones (id, url_id, user_id, deleted_at) "
                "SELECT id, url_id, :'owner'::uuid, now() FROM removed "
                "ON CONFLICT (id, user_id) DO UPDATE SET url_id = EXCLUDED.url_id, deleted_at = now()"
                ") SELECT count(*)::text FROM removed;",
                {"chat_id": chat_id, "owner": owner},
            )
            removed = int(rows[0]) if rows else 0
        except DatabaseError as exc:
            _log_database_error("history DELETE", exc)
            return self._error(500, "database error")

        code, body = json_bytes({"ok": True, "removed": removed})

        return self._send(code, body)


def main():
    init_schema()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    sys.stderr.write(
        "[bolt-history] listening on %s:%s (postgresql %s@%s:%s/%s)\n"
        % (HOST, PORT, PG_USER, PG_HOST, PG_PORT, PG_DB)
    )

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
