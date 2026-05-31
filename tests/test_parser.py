import unittest
from email.message import EmailMessage
from unittest.mock import patch

from app import (
    AccountParseError,
    IMAP_HEADER_FETCH,
    folders_for_scope,
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


if __name__ == "__main__":
    unittest.main()
