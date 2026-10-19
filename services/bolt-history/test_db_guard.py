"""Refuse to run a destructive test suite against the production database.

Why this exists: the suites DELETE FROM chats, chat_tombstones, projects and users. Two of
them redirect the database in their own header (`os.environ["BOLT_HISTORY_PG_DB"] = TEST_DB`)
and one relies on the caller having done it. A suite run without that redirect would delete
the user's real conversations — and because the redirect is easy to forget and the loss is
silent, a comment is not enough.

Import this FIRST, before `bolt_history`, in every test module:

    from test_db_guard import require_test_database
    require_test_database()

It raises unless the effective database name looks like a test database.
"""
import os
import sys

# A database is considered a test database when its name carries one of these markers. The
# production name is plain `bolt_history`, which matches none of them.
TEST_MARKERS = ("test", "probe", "scratch", "dry", "tmp", "_check", "audit")
PRODUCTION_DB = "bolt_history"


def effective_db() -> str:
    """The database bolt_history would actually use, without importing it."""

    return os.environ.get("BOLT_HISTORY_PG_DB", PRODUCTION_DB)


def is_test_database(name: str) -> bool:
    if name == PRODUCTION_DB:
        return False

    return any(marker in name.lower() for marker in TEST_MARKERS)


def require_test_database() -> None:
    """Abort before any destructive statement can reach the production database."""

    db = effective_db()

    if not is_test_database(db):
        sys.stderr.write(
            "\n"
            "REFUS: la suite de tests vise la base %r, qui n'est pas une base de test.\n"
            "\n"
            "Cette suite fait DELETE FROM chats / chat_tombstones / projects / users.\n"
            "Lancer sans redirection effacerait les conversations reelles.\n"
            "\n"
            "Corrigez en fixant une base de test AVANT d'importer bolt_history:\n"
            "    os.environ['BOLT_HISTORY_PG_DB'] = os.environ.get('BOLT_HISTORY_TEST_DB', 'bolt_history_test')\n"
            "ou lancez avec BOLT_HISTORY_PG_DB=bolt_history_test_<vous>.\n"
            % db
        )
        raise SystemExit(2)


if __name__ == "__main__":
    # Self-check: the guard must refuse production and accept a test name.
    os.environ["BOLT_HISTORY_PG_DB"] = PRODUCTION_DB
    assert not is_test_database(effective_db()), "production must be refused"

    os.environ["BOLT_HISTORY_PG_DB"] = "bolt_history_test_x"
    assert is_test_database(effective_db()), "a test database must be accepted"

    os.environ["BOLT_HISTORY_PG_DB"] = "bolt_p3_probe"
    assert is_test_database(effective_db()), "a probe database must be accepted"

    print("garde auto-verifie: refuse %r, accepte les bases de test" % PRODUCTION_DB)
