import unittest
import json
import tempfile
from io import BytesIO
from email.message import EmailMessage
from pathlib import Path
from unittest.mock import patch

import app
from app import (
    AccountParseError,
    AppHandler,
    GRAPH_TOKEN_ATTEMPTS,
    IMAP_HEADER_FETCH,
    MAX_JSON_BODY_BYTES,
    folders_for_scope,
    get_access_token,
    html_to_text,
    iter_imap_mailbox_selectors,
    is_probable_client_id,
    is_graph_next_link,
    normalize_graph_message,
    normalize_imap_header_message,
    normalize_mail_scope,
    normalize_skip,
    normalize_imap_message,
    normalize_top,
    parse_graph_next_links,
    parse_outlook_account_line,
    read_message_detail,
    read_messages_graph,
    read_imap_folder,
    read_messages_imap,
)


CLIENT_ID = "24d9a0ed-8787-4584-883c-2fd79308940a"
REFRESH_TOKEN = "0.AXEA_refresh_token_value"


class OutlookAccountParserTests(unittest.TestCase):
    def setUp(self):
        with app.ACCESS_TOKEN_CACHE_LOCK:
            app.ACCESS_TOKEN_CACHE.clear()

    def test_default_order(self):
        parsed = parse_outlook_account_line(
            f"user@outlook.com----password123----{CLIENT_ID}----{REFRESH_TOKEN}"
        )

        self.assertEqual(parsed["email"], "user@outlook.com")
        self.assertEqual(parsed["password"], "password123")
        self.assertEqual(parsed["client_id"], CLIENT_ID)
        self.assertEqual(parsed["refresh_token"], REFRESH_TOKEN)

    def test_reversed_order_is_auto_detected(self):
        parsed = parse_outlook_account_line(
            f"user@outlook.com----password123----{REFRESH_TOKEN}----{CLIENT_ID}"
        )

        self.assertEqual(parsed["client_id"], CLIENT_ID)
        self.assertEqual(parsed["refresh_token"], REFRESH_TOKEN)

    def test_trims_segments(self):
        parsed = parse_outlook_account_line(
            f" user@outlook.com ---- password123 ---- {REFRESH_TOKEN} ---- {CLIENT_ID} "
        )

        self.assertEqual(parsed["email"], "user@outlook.com")
        self.assertEqual(parsed["client_id"], CLIENT_ID)
        self.assertEqual(parsed["refresh_token"], REFRESH_TOKEN)

    def test_missing_segments_rejected(self):
        with self.assertRaises(AccountParseError):
            parse_outlook_account_line("user@outlook.com----password123")

    def test_client_id_detection_uses_uuid_shape(self):
        self.assertTrue(is_probable_client_id(CLIENT_ID))
        self.assertFalse(is_probable_client_id(REFRESH_TOKEN))

    def test_access_token_is_cached(self):
        with patch(
            "app.post_form_json",
            return_value={"access_token": "access-token", "expires_in": 3600},
        ) as post_form_json:
            first = get_access_token(CLIENT_ID, REFRESH_TOKEN, GRAPH_TOKEN_ATTEMPTS)
            second = get_access_token(CLIENT_ID, REFRESH_TOKEN, GRAPH_TOKEN_ATTEMPTS)

        self.assertEqual(first, "access-token")
        self.assertEqual(second, "access-token")
        post_form_json.assert_called_once()

    def test_expired_access_token_cache_is_refetched(self):
        key = app.token_cache_key(CLIENT_ID, REFRESH_TOKEN, GRAPH_TOKEN_ATTEMPTS)
        with app.ACCESS_TOKEN_CACHE_LOCK:
            app.ACCESS_TOKEN_CACHE[key] = ("expired-token", app.time.monotonic() - 1)

        with patch(
            "app.post_form_json",
            return_value={"access_token": "fresh-token", "expires_in": 3600},
        ) as post_form_json:
            token = get_access_token(CLIENT_ID, REFRESH_TOKEN, GRAPH_TOKEN_ATTEMPTS)

        self.assertEqual(token, "fresh-token")
        post_form_json.assert_called_once()

    def test_top_is_clamped(self):
        self.assertEqual(normalize_top("0"), 1)
        self.assertEqual(normalize_top("1000"), 50)
        self.assertEqual(normalize_top("abc"), 10)

    def test_skip_is_clamped(self):
        self.assertEqual(normalize_skip("-1"), 0)
        self.assertEqual(normalize_skip("10001"), 10000)
        self.assertEqual(normalize_skip("abc"), 0)

    def test_mail_scope_is_normalized(self):
        self.assertEqual(normalize_mail_scope("junk"), "junk")
        self.assertEqual(normalize_mail_scope("nonjunk"), "nonjunk")
        self.assertEqual(normalize_mail_scope("bad"), "nonjunk")
        self.assertEqual(folders_for_scope("all"), ("inbox", "junk"))

    def test_imap_mailbox_with_space_is_quoted_first(self):
        self.assertEqual(iter_imap_mailbox_selectors("Junk Email")[0], '"Junk Email"')

    def test_imap_folder_select_continues_after_bad_mailbox(self):
        class FakeConnection:
            def __init__(self):
                self.calls = []

            def select(self, mailbox, readonly=True):
                self.calls.append(mailbox)
                if mailbox == '"Junk Email"':
                    raise RuntimeError("BAD Command Argument Error")
                if mailbox == "Junk":
                    return "OK", [b"0"]
                return "NO", [b""]

        connection = FakeConnection()
        messages, has_more = read_imap_folder(connection, "junk", 10, 0)

        self.assertEqual(messages, [])
        self.assertFalse(has_more)
        self.assertIn('"Junk Email"', connection.calls)
        self.assertIn("Junk", connection.calls)

    def test_imap_folder_fetches_headers_only(self):
        class FakeConnection:
            def __init__(self):
                self.fetch_calls = []

            def select(self, mailbox, readonly=True):
                return "OK", [b"1"]

            def fetch(self, sequence, query):
                self.fetch_calls.append((sequence, query))
                headers = (
                    b"From: Sender <sender@example.com>\r\n"
                    b"To: User <user@outlook.com>\r\n"
                    b"Subject: Header Only\r\n"
                    b"Date: Thu, 28 May 2026 15:51:00 +0000\r\n"
                    b"\r\n"
                )
                return "OK", [(b"1 (FLAGS (\\Seen) RFC822.SIZE 1234)", headers)]

        connection = FakeConnection()
        messages, has_more = read_imap_folder(connection, "inbox", 10, 0)

        self.assertFalse(has_more)
        self.assertEqual(connection.fetch_calls, [("1", IMAP_HEADER_FETCH)])
        self.assertEqual(messages[0]["subject"], "Header Only")
        self.assertEqual(messages[0]["from_address"], "sender@example.com")
        self.assertTrue(messages[0]["is_read"])
        self.assertEqual(messages[0]["body"], "")
        self.assertEqual(messages[0]["body_text"], "")
        self.assertEqual(messages[0]["body_html"], "")

    def test_imap_header_message_has_no_body_cache(self):
        parsed = normalize_imap_header_message(
            (
                b"From: Sender <sender@example.com>\r\n"
                b"To: User <user@outlook.com>\r\n"
                b"Subject: Code 426409\r\n"
                b"Date: Thu, 28 May 2026 15:51:00 +0000\r\n"
                b"\r\n"
            ),
            "inbox:1",
            [(b"1 (FLAGS (\\Seen) RFC822.SIZE 1234)", b"")],
        )

        self.assertEqual(parsed["subject"], "Code 426409")
        self.assertTrue(parsed["is_read"])
        self.assertEqual(parsed["preview"], "")
        self.assertEqual(parsed["body"], "")
        self.assertEqual(parsed["body_text"], "")
        self.assertEqual(parsed["body_html"], "")

    def test_message_detail_uses_imap_for_imap_source(self):
        account = {
            "email": "user@outlook.com",
            "client_id": CLIENT_ID,
            "refresh_token": REFRESH_TOKEN,
        }

        with patch("app.read_imap_message_detail", return_value=({"id": "inbox:1"}, "outlook.live.com")) as detail:
            message, source = read_message_detail(account, "inbox:1", "IMAP XOAUTH2 outlook.live.com")

        detail.assert_called_once_with("user@outlook.com", CLIENT_ID, REFRESH_TOKEN, "inbox:1")
        self.assertEqual(message["id"], "inbox:1")
        self.assertEqual(source, "IMAP XOAUTH2 outlook.live.com")

    def test_imap_fallback_tries_live_before_office365(self):
        calls = []

        class FakeConnection:
            def authenticate(self, method, callback):
                self.method = method
                self.auth_string = callback(None)

            def logout(self):
                pass

        def fake_imap_ssl(server, port, timeout=30):
            calls.append((server, port, timeout))
            if server == "outlook.live.com":
                raise OSError("live unavailable")
            return FakeConnection()

        with (
            patch("app.get_access_token", return_value="access-token"),
            patch("app.imaplib.IMAP4_SSL", side_effect=fake_imap_ssl),
            patch("app.read_imap_folder", return_value=([], False)),
        ):
            messages, has_more, server = read_messages_imap(
                "user@outlook.com",
                CLIENT_ID,
                REFRESH_TOKEN,
                10,
                0,
                mail_scope="nonjunk",
            )

        self.assertEqual(messages, [])
        self.assertFalse(has_more)
        self.assertEqual(server, "outlook.office365.com")
        self.assertEqual([item[0] for item in calls], ["outlook.live.com", "outlook.office365.com"])

    def test_graph_next_link_accepts_inbox_folder_shape(self):
        self.assertTrue(
            is_graph_next_link(
                "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages?%24top=10&%24skip=10"
            )
        )
        self.assertFalse(is_graph_next_link("https://example.com/v1.0/me/mailFolders('inbox')/messages"))

    def test_graph_next_links_parse_json_map(self):
        parsed = parse_graph_next_links(
            '{"inbox":"https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages","junk":"https://graph.microsoft.com/v1.0/me/mailFolders/junkemail/messages"}'
        )

        self.assertIn("inbox", parsed)
        self.assertIn("junk", parsed)

    def test_graph_list_request_does_not_fetch_full_body(self):
        captured_params = {}

        def fake_get_json(url, headers, params, timeout=30):
            captured_params.update(params)
            return {"value": []}

        with (
            patch("app.get_access_token", return_value="access-token"),
            patch("app.get_json", side_effect=fake_get_json),
        ):
            messages, next_link = read_messages_graph(
                CLIENT_ID,
                REFRESH_TOKEN,
                10,
                mail_scope="nonjunk",
            )

        select_fields = set(captured_params["$select"].split(","))
        self.assertEqual(messages, [])
        self.assertEqual(next_link, "")
        self.assertIn("bodyPreview", select_fields)
        self.assertNotIn("body", select_fields)

    def test_graph_message_includes_recipients_and_body_text(self):
        parsed = normalize_graph_message(
            {
                "id": "message-1",
                "subject": "Your code",
                "from": {"emailAddress": {"name": "OpenAI", "address": "noreply@example.com"}},
                "toRecipients": [
                    {"emailAddress": {"name": "User", "address": "user@outlook.com"}},
                ],
                "receivedDateTime": "2026-05-28T15:51:00Z",
                "isRead": False,
                "hasAttachments": False,
                "bodyPreview": "输入此临时验证码",
                "body": {"contentType": "html", "content": "<p>验证码 <b>426409</b></p>"},
            }
        )

        self.assertEqual(parsed["to"][0]["address"], "user@outlook.com")
        self.assertEqual(parsed["body"], "验证码 426409")
        self.assertEqual(parsed["body_text"], "验证码 426409")
        self.assertIn("<p>", parsed["body_html"])
        self.assertEqual(parsed["body_type"], "html")

    def test_imap_message_includes_body_text(self):
        message = EmailMessage()
        message["From"] = "OpenAI <noreply@example.com>"
        message["To"] = "User <user@outlook.com>"
        message["Subject"] = "Code"
        message["Date"] = "Thu, 28 May 2026 15:51:00 +0000"
        message.set_content("输入此临时验证码：426409")

        parsed = normalize_imap_message(message.as_bytes(), "1")

        self.assertEqual(parsed["from_address"], "noreply@example.com")
        self.assertEqual(parsed["to"][0]["address"], "user@outlook.com")
        self.assertIn("426409", parsed["body"])
        self.assertEqual(parsed["body_type"], "text")

    def test_html_to_text_removes_tags_and_scripts(self):
        self.assertEqual(html_to_text("<style>x</style><p>Hello<br>World</p>"), "Hello\nWorld")

    def test_api_rejects_invalid_json_with_security_headers(self):
        handler = self.make_handler(b"{bad-json", "/api/messages")

        handler.handle_messages()

        self.assertEqual(handler.status_code, 400)
        self.assertIn("请求 JSON 格式不合法", handler.output_text())
        self.assertEqual(handler.header_map["X-Content-Type-Options"], "nosniff")
        self.assertEqual(handler.header_map["X-Frame-Options"], "DENY")
        self.assertIn("object-src 'none'", handler.header_map["Content-Security-Policy"])

    def test_api_rejects_large_json_body(self):
        handler = self.make_handler(b"{}", "/api/messages", content_length=MAX_JSON_BODY_BYTES + 1)

        handler.handle_messages()

        self.assertEqual(handler.status_code, 413)
        self.assertIn("请求体过大", handler.output_text())

    def test_analytics_visit_tracks_visitors_and_online(self):
        with self.analytics_tempdir():
            first = app.record_analytics_visit("visitor-a", "visit")
            second = app.record_analytics_visit("visitor-a", "heartbeat")

            self.assertEqual(first["visit_total"], 1)
            self.assertEqual(second["visit_total"], 1)
            self.assertEqual(second["visitor_total"], 1)
            self.assertEqual(second["online_count"], 1)
            saved = json.loads(app.ANALYTICS_FILE.read_text(encoding="utf-8"))
            self.assertEqual(saved["counters"]["heartbeat_total"], 1)

    def test_analytics_import_and_fetch_events_are_aggregated(self):
        with self.analytics_tempdir():
            app.record_analytics_visit("visitor-a", "visit")
            app.record_analytics_client_event(
                "visitor-a",
                {
                    "type": "import",
                    "count": 3,
                    "domains": {"outlook.com": 2, "hotmail.com": 1},
                },
            )
            app.record_analytics_client_event(
                "visitor-a",
                {
                    "type": "fetch_success",
                    "domain": "outlook.com",
                    "source": "Graph API",
                    "scope": "nonjunk",
                    "message_count": 10,
                },
            )
            app.record_analytics_client_event(
                "visitor-a",
                {
                    "type": "fetch_failed",
                    "domain": "user@hotmail.com",
                    "reason": "Graph: HTTP 401; token M.secret user@hotmail.com",
                },
            )

            stats = app.admin_analytics_stats()

        self.assertEqual(stats["public"]["import_total"], 3)
        self.assertEqual(stats["public"]["fetch_total"], 2)
        self.assertEqual(stats["public"]["fetch_success"], 1)
        self.assertEqual(stats["public"]["fetch_failed"], 1)
        self.assertEqual(stats["public"]["message_total"], 10)
        self.assertEqual(stats["import_domains"][0], {"name": "outlook.com", "count": 2})
        self.assertIn({"name": "Graph API", "count": 1}, stats["sources"])
        self.assertTrue(stats["failure_reasons"][0]["name"].startswith("Graph: HTTP 401"))
        self.assertNotIn("user@hotmail.com", stats["failure_reasons"][0]["name"])

    def test_admin_stats_requires_configured_password(self):
        with self.analytics_tempdir(), patch.object(app, "ADMIN_PASSWORD", ""), patch.object(app, "ADMIN_SESSION_SECRET", ""):
            handler = self.make_handler(b"", "/api/admin/stats")

            handler.handle_admin_stats()

        self.assertEqual(handler.status_code, 503)
        self.assertIn("管理员后台未启用", handler.output_text())

    def test_admin_login_sets_cookie(self):
        with self.analytics_tempdir(), patch.object(app, "ADMIN_PASSWORD", "secret"), patch.object(app, "ADMIN_SESSION_SECRET", "session-secret"):
            handler = self.make_handler(b'{"password":"secret"}', "/api/admin/login")

            handler.handle_admin_login()

        self.assertEqual(handler.status_code, 200)
        self.assertIn(app.ADMIN_COOKIE_NAME, handler.header_map["Set-Cookie"])
        self.assertIn('"ok": true', handler.output_text())

    def test_admin_login_rejects_wrong_password(self):
        with self.analytics_tempdir(), patch.object(app, "ADMIN_PASSWORD", "secret"), patch.object(app, "ADMIN_SESSION_SECRET", "session-secret"):
            handler = self.make_handler(b'{"password":"bad"}', "/api/admin/login")

            handler.handle_admin_login()

        self.assertEqual(handler.status_code, 401)
        self.assertIn("管理员密码不正确", handler.output_text())

    def test_admin_stats_accepts_valid_session_cookie(self):
        with self.analytics_tempdir(), patch.object(app, "ADMIN_PASSWORD", "secret"), patch.object(app, "ADMIN_SESSION_SECRET", "session-secret"):
            token = app.make_admin_session()
            handler = self.make_handler(b"", "/api/admin/stats")
            handler.headers["Cookie"] = f"{app.ADMIN_COOKIE_NAME}={token}"

            handler.handle_admin_stats()

        self.assertEqual(handler.status_code, 200)
        self.assertIn("visit_total", handler.output_text())

    def analytics_tempdir(self):
        class AnalyticsTempDir:
            def __enter__(inner_self):
                inner_self.tempdir = tempfile.TemporaryDirectory()
                inner_self.originals = (
                    app.DATA_DIR,
                    app.ANALYTICS_FILE,
                    app.EVENTS_LOG_FILE,
                )
                app.DATA_DIR = Path(inner_self.tempdir.name)
                app.ANALYTICS_FILE = app.DATA_DIR / "analytics.json"
                app.EVENTS_LOG_FILE = app.DATA_DIR / "events.log"
                return inner_self

            def __exit__(inner_self, exc_type, exc, tb):
                app.DATA_DIR, app.ANALYTICS_FILE, app.EVENTS_LOG_FILE = inner_self.originals
                inner_self.tempdir.cleanup()
                return False

        return AnalyticsTempDir()

    def make_handler(self, body: bytes, path: str, content_length: int | None = None):
        handler = object.__new__(AppHandler)
        handler.path = path
        handler.command = "POST"
        handler.request_version = "HTTP/1.1"
        handler.headers = {"Content-Length": str(len(body) if content_length is None else content_length)}
        handler.rfile = BytesIO(body)
        handler.wfile = BytesIO()
        handler.status_code = None
        handler.header_map = {}

        def send_response(self, code, message=None):
            self.status_code = code
            self._headers_buffer = [f"HTTP/1.1 {code} test\r\n".encode("latin-1")]

        def send_header(self, keyword, value):
            self.header_map[keyword] = str(value)
            self._headers_buffer.append(f"{keyword}: {value}\r\n".encode("latin-1"))

        def output_text(self):
            raw = self.wfile.getvalue()
            _, _, body = raw.partition(b"\r\n\r\n")
            return body.decode("utf-8", "replace")

        handler.send_response = send_response.__get__(handler, AppHandler)
        handler.send_header = send_header.__get__(handler, AppHandler)
        handler.output_text = output_text.__get__(handler, AppHandler)
        return handler


if __name__ == "__main__":
    unittest.main()
