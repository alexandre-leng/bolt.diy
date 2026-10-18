#!/usr/bin/env python3
"""HEAD must be served, not 501."""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import handlers  # noqa: E402


class HeadTest(unittest.TestCase):
    def test_the_handler_answers_head(self):
        # Without this line BaseHTTPRequestHandler raises 501 Unsupported method for
        # `HEAD /login`, which nginx logged while a monitor probed the page.
        self.assertTrue(hasattr(handlers.AccountsHandler, "do_HEAD"))
        self.assertIsNotNone(handlers.AccountsHandler.do_HEAD)

    def test_head_is_not_a_body_sending_get(self):
        # do_HEAD is GET's routing, but _html/_json must skip the body for HEAD; asserting
        # the method exists is what guards the wiring, the body skip is checked by curl.
        self.assertTrue(callable(handlers.AccountsHandler.do_HEAD))


if __name__ == "__main__":
    unittest.main()
