import unittest
from email.message import EmailMessage

from app import (
    AccountParseError,
    folders_for_scope,
    html_to_text,
    is_probable_client_id,
    is_graph_next_link,
    normalize_graph_message,
    normalize_mail_scope,
    normalize_skip,
    normalize_imap_message,
    normalize_top,
    parse_graph_next_links,
    parse_outlook_account_line,
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
