#!/usr/bin/env python3
"""bolt-accounts — entry point. Wires the handler to the port and starts serving."""

import os
import sys
from http.server import ThreadingHTTPServer

import accounts_service as svc  # noqa: F401  (imported for side-effect-free config access)
from accounts_service import HOST, PORT, DatabaseError, query
from handlers import AccountsHandler


def main():
    # Fail fast and loudly if the schema is missing: serving a broken auth endpoint is worse
    # than not starting.
    try:
        query("SELECT 1 FROM users LIMIT 1;")
    except DatabaseError as exc:
        raise SystemExit("database not ready (run migrations): %s" % exc)

    if not svc.RESEND_API_KEY or not svc.EMAIL_FROM:
        print("[accounts] WARNING: email transport not configured — verification and reset "
              "emails will not be sent", flush=True)

    server = ThreadingHTTPServer((HOST, PORT), AccountsHandler)
    print("[accounts] listening on %s:%s" % (HOST, PORT), flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    main()
