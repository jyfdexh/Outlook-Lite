from __future__ import annotations

import argparse
import email
import html
import imaplib
import json
import re
import socket
import ssl
import sys
import uuid
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime, parseaddr
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib import error, parse, request


ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"

ACCOUNT_SEPARATOR = "----"
DEFAULT_TOP = 10
MAX_TOP = 50

GRAPH_TOKEN_ATTEMPTS = (
    ("common", "https://graph.microsoft.com/.default"),
    ("common", "https://graph.microsoft.com/Mail.Read offline_access"),
    ("consumers", "https://graph.microsoft.com/Mail.Read offline_access"),
)
IMAP_TOKEN_ATTEMPTS = (
    ("consumers", "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"),
    ("common", "https://outlook.office.com/IMAP.AccessAsUser.All offline_access"),
)
IMAP_SERVERS = ("outlook.live.com", "outlook.office365.com")


class AccountParseError(ValueError):
    pass


class OutlookReadError(RuntimeError):
    def __init__(self, message: str, *, details: str = "", source: str = "") -> None:
        super().__init__(message)
        self.details = details
        self.source = source


def is_probable_client_id(value: str) -> bool:
    candidate = str(value or "").strip()
    if not candidate:
        return False
    try:
        uuid.UUID(candidate)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def resolve_outlook_token_order(third: str, fourth: str) -> tuple[str, str]:
    third = str(third or "").strip()
    fourth = str(fourth or "").strip()

    third_is_client_id = is_probable_client_id(third)
    fourth_is_client_id = is_probable_client_id(fourth)

    if third_is_client_id and not fourth_is_client_id:
        return third, fourth
    if fourth_is_client_id and not third_is_client_id:
        return fourth, third

    return third, fourth


def parse_outlook_account_line(account_line: str) -> dict[str, str]:
    parts = [part.strip() for part in str(account_line or "").strip().split(ACCOUNT_SEPARATOR)]
    if len(parts) < 4:
        raise AccountParseError("账号格式不完整，需要 4 段：邮箱、密码、client_id、refresh_token")

    email_addr, password, third, fourth = parts[:4]
    if not email_addr:
        raise AccountParseError("邮箱不能为空")

    client_id, refresh_token = resolve_outlook_token_order(third, fourth)
    if not client_id:
        raise AccountParseError("client_id 不能为空")
    if not refresh_token:
        raise AccountParseError("refresh_token 不能为空")

    return {
        "email": email_addr,
        "password": password,
        "client_id": client_id,
        "refresh_token": refresh_token,
    }


def normalize_top(value: Any) -> int:
    try:
        top = int(value)
    except (TypeError, ValueError):
        top = DEFAULT_TOP
    return max(1, min(top, MAX_TOP))


def post_form_json(url: str, form_data: dict[str, str], timeout: int = 30) -> dict[str, Any]:
    payload = parse.urlencode(form_data).encode("utf-8")
    req = request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "outlook-mail-lite/1.0",
        },
    )
    return open_json(req, timeout=timeout)


def get_json(url: str, headers: dict[str, str], params: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
    query = parse.urlencode(params)
    separator = "&" if "?" in url else "?"
    req = request.Request(
        f"{url}{separator}{query}",
        method="GET",
        headers={
            "Accept": "application/json",
            "User-Agent": "outlook-mail-lite/1.0",
            **headers,
        },
    )
    return open_json(req, timeout=timeout)


def open_json(req: request.Request, timeout: int = 30) -> dict[str, Any]:
    try:
        with request.urlopen(req, timeout=timeout) as response:
            raw = response.read().decode("utf-8", "replace")
    except error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "replace")
        message = extract_error_message(raw) or f"HTTP {exc.code}"
        raise OutlookReadError(message, details=raw[:1000]) from exc
    except (error.URLError, TimeoutError, socket.timeout, ssl.SSLError) as exc:
        raise OutlookReadError("网络请求失败", details=str(exc)) from exc

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise OutlookReadError("远程接口返回了非 JSON 内容", details=raw[:1000]) from exc


def extract_error_message(raw: str) -> str:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return raw[:300]

    error_obj = data.get("error")
    if isinstance(error_obj, dict):
        return str(error_obj.get("message") or error_obj.get("error_description") or error_obj)
    if error_obj:
        return str(data.get("error_description") or error_obj)
    return ""


def get_access_token(client_id: str, refresh_token: str, attempts: tuple[tuple[str, str], ...]) -> str:
    errors: list[str] = []
    for tenant, scope in attempts:
        token_url = f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
        try:
            data = post_form_json(
                token_url,
                {
                    "client_id": client_id,
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "scope": scope,
                },
            )
        except OutlookReadError as exc:
            errors.append(f"{tenant} / {scope}: {exc}")
            continue

        access_token = str(data.get("access_token") or "")
        if access_token:
            return access_token
        errors.append(f"{tenant} / {scope}: access_token 为空")

    raise OutlookReadError("刷新 access_token 失败", details="\n".join(errors))


def read_messages(account_line: str, top: int = DEFAULT_TOP) -> dict[str, Any]:
    account = parse_outlook_account_line(account_line)
    top = normalize_top(top)

    graph_error = ""
    try:
        messages = read_messages_graph(account["client_id"], account["refresh_token"], top)
        return {"source": "Microsoft Graph", "account": account, "messages": messages}
    except OutlookReadError as exc:
        graph_error = f"{exc}; {exc.details}".strip()

    try:
        messages = read_messages_imap(account["email"], account["client_id"], account["refresh_token"], top)
        return {"source": "IMAP XOAUTH2", "account": account, "messages": messages}
    except OutlookReadError as exc:
        details = "\n".join(part for part in (f"Graph: {graph_error}", f"IMAP: {exc.details}") if part)
        raise OutlookReadError("读取邮件失败", details=details) from exc


def read_messages_graph(client_id: str, refresh_token: str, top: int) -> list[dict[str, Any]]:
    access_token = get_access_token(client_id, refresh_token, GRAPH_TOKEN_ATTEMPTS)
    data = get_json(
        "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
        headers={
            "Authorization": f"Bearer {access_token}",
            "Prefer": "outlook.body-content-type='html'",
        },
        params={
            "$top": top,
            "$select": "id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview,body",
            "$orderby": "receivedDateTime desc",
        },
    )
    return [normalize_graph_message(item) for item in data.get("value", [])]


def normalize_graph_message(item: dict[str, Any]) -> dict[str, Any]:
    sender = ((item.get("from") or {}).get("emailAddress") or {})
    recipients = [recipient.get("emailAddress") or {} for recipient in item.get("toRecipients", [])]
    body = item.get("body") or {}
    body_type = str(body.get("contentType") or "").lower()
    body_content = str(body.get("content") or "")
    body_html = body_content if body_type == "html" else ""
    body_text = html_to_text(body_html) if body_html else normalize_whitespace(body_content)
    return {
        "id": item.get("id", ""),
        "subject": item.get("subject") or "(无主题)",
        "from_name": sender.get("name", ""),
        "from_address": sender.get("address", ""),
        "to": [
            {
                "name": recipient.get("name", ""),
                "address": recipient.get("address", ""),
            }
            for recipient in recipients
        ],
        "received_at": item.get("receivedDateTime", ""),
        "is_read": bool(item.get("isRead")),
        "has_attachments": bool(item.get("hasAttachments")),
        "preview": item.get("bodyPreview", ""),
        "body": body_text,
        "body_text": body_text,
        "body_html": body_html,
        "body_type": "html" if body_html else "text",
    }


def read_messages_imap(email_addr: str, client_id: str, refresh_token: str, top: int) -> list[dict[str, Any]]:
    access_token = get_access_token(client_id, refresh_token, IMAP_TOKEN_ATTEMPTS)
    errors: list[str] = []

    for server in IMAP_SERVERS:
        connection = None
        try:
            connection = imaplib.IMAP4_SSL(server, 993, timeout=30)
            auth_string = f"user={email_addr}\x01auth=Bearer {access_token}\x01\x01".encode("utf-8")
            connection.authenticate("XOAUTH2", lambda _: auth_string)
            status, mailbox_data = connection.select("INBOX", readonly=True)
            if status != "OK" or not mailbox_data or not mailbox_data[0]:
                raise OutlookReadError("无法打开 INBOX")

            total_messages = int(mailbox_data[0])
            if total_messages <= 0:
                return []

            start = max(1, total_messages - top + 1)
            messages: list[dict[str, Any]] = []
            for sequence_number in range(total_messages, start - 1, -1):
                message_id = str(sequence_number)
                status, fetched = connection.fetch(message_id, "(RFC822)")
                if status != "OK" or not fetched or not fetched[0]:
                    continue
                raw = fetched[0][1]
                if isinstance(raw, bytes):
                    messages.append(normalize_imap_message(raw, message_id))
            return messages
        except Exception as exc:
            errors.append(f"{server}: {exc}")
        finally:
            if connection is not None:
                try:
                    connection.logout()
                except Exception:
                    pass

    raise OutlookReadError("IMAP 读取失败", details="\n".join(errors))


def normalize_imap_message(raw: bytes, message_id: str) -> dict[str, Any]:
    message = email.message_from_bytes(raw)
    sender_name, sender_address = parseaddr(decode_mime(str(message.get("From", ""))))
    recipient_name, recipient_address = parseaddr(decode_mime(str(message.get("To", ""))))
    received_at = normalize_email_date(str(message.get("Date", "")))
    body_text = extract_full_body(message)
    body_html = extract_message_body(message, "text/html")
    return {
        "id": message_id,
        "subject": decode_mime(str(message.get("Subject", ""))) or "(无主题)",
        "from_name": sender_name,
        "from_address": sender_address,
        "to": [{"name": recipient_name, "address": recipient_address}] if recipient_address else [],
        "received_at": received_at,
        "is_read": False,
        "has_attachments": has_attachments(message),
        "preview": body_text[:240],
        "body": body_text,
        "body_text": body_text,
        "body_html": body_html,
        "body_type": "html" if body_html else "text",
    }


def decode_mime(value: str) -> str:
    if not value:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return value


def normalize_email_date(value: str) -> str:
    if not value:
        return ""
    try:
        parsed = parsedate_to_datetime(value)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).isoformat()
    except Exception:
        return value


def has_attachments(message: email.message.Message) -> bool:
    for part in message.walk():
        disposition = str(part.get("Content-Disposition", "")).lower()
        if "attachment" in disposition:
            return True
    return False


def extract_preview(message: email.message.Message, limit: int = 240) -> str:
    return extract_full_body(message)[:limit]


def extract_full_body(message: email.message.Message) -> str:
    text = extract_message_body(message, "text/plain")
    if text:
        return normalize_whitespace(text)
    html_text = extract_message_body(message, "text/html")
    return html_to_text(html_text)


def html_to_text(value: str) -> str:
    if not value:
        return ""
    text = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", value)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", " ", text)
    return normalize_whitespace(html.unescape(text))


def normalize_whitespace(value: str) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t\f\v]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()


def extract_message_body(message: email.message.Message, content_type: str) -> str:
    if message.is_multipart():
        for part in message.walk():
            if part.get_content_maintype() == "multipart":
                continue
            if part.get_content_type() != content_type:
                continue
            disposition = str(part.get("Content-Disposition", "")).lower()
            if "attachment" in disposition:
                continue
            return decode_part_payload(part)
        return ""

    if message.get_content_type() == content_type:
        return decode_part_payload(message)
    return ""


def decode_part_payload(part: email.message.Message) -> str:
    payload = part.get_payload(decode=True)
    if payload is None:
        raw_payload = part.get_payload()
        return raw_payload if isinstance(raw_payload, str) else ""
    charset = part.get_content_charset() or "utf-8"
    return payload.decode(charset, "replace")


class AppHandler(SimpleHTTPRequestHandler):
    server_version = "OutlookMailLite/1.0"

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))

    def do_GET(self) -> None:
        if self.path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path == "/api/messages":
            self.handle_messages()
            return
        self.send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def handle_messages(self) -> None:
        try:
            payload = self.read_json_body()
            result = read_messages(payload.get("account", ""), payload.get("top", DEFAULT_TOP))
            account = result["account"]
            self.send_json(
                {
                    "source": result["source"],
                    "account": {
                        "email": account["email"],
                        "client_id": account["client_id"],
                    },
                    "messages": result["messages"],
                }
            )
        except AccountParseError as exc:
            self.send_json({"error": str(exc)}, status=HTTPStatus.BAD_REQUEST)
        except OutlookReadError as exc:
            self.send_json(
                {
                    "error": str(exc),
                    "details": exc.details,
                },
                status=HTTPStatus.BAD_GATEWAY,
            )
        except Exception as exc:
            self.send_json({"error": "服务内部错误", "details": str(exc)}, status=HTTPStatus.INTERNAL_SERVER_ERROR)

    def read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length).decode("utf-8", "replace")
        if not raw:
            return {}
        return json.loads(raw)

    def send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(int(status))
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")


def main() -> None:
    parser = argparse.ArgumentParser(description="Minimal Outlook mail reader")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), AppHandler)
    print(f"Outlook mail reader is running at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
