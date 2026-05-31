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
MAX_SKIP = 10000
GRAPH_FOLDER_IDS = {
    "inbox": "inbox",
    "junk": "junkemail",
}
IMAP_FOLDER_NAMES = {
    "inbox": ("INBOX",),
    "junk": ("Junk Email", "Junk", "Spam"),
}

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
IMAP_ATOM_RE = re.compile(r"^[A-Za-z0-9._/-]+$")
IMAP_HEADER_FETCH = "(FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] RFC822.SIZE)"
GRAPH_MESSAGE_LIST_SELECT = "id,subject,from,toRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview"
GRAPH_MESSAGE_DETAIL_SELECT = f"{GRAPH_MESSAGE_LIST_SELECT},body"


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


def normalize_skip(value: Any) -> int:
    try:
        skip = int(value)
    except (TypeError, ValueError):
        skip = 0
    return max(0, min(skip, MAX_SKIP))


def normalize_mail_scope(value: Any) -> str:
    candidate = str(value or "nonjunk").strip().lower()
    return candidate if candidate in {"all", "nonjunk", "junk"} else "nonjunk"


def folders_for_scope(scope: str) -> tuple[str, ...]:
    if scope == "junk":
        return ("junk",)
    if scope == "nonjunk":
        return ("inbox",)
    return ("inbox", "junk")


def quote_imap_mailbox(value: str) -> str:
    mailbox = str(value or "")
    escaped = mailbox.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def iter_imap_mailbox_selectors(mailbox: str) -> tuple[str, ...]:
    mailbox = str(mailbox or "")
    if not mailbox:
        return ("",)
    if IMAP_ATOM_RE.match(mailbox):
        return (mailbox,)
    quoted = quote_imap_mailbox(mailbox)
    return (quoted, mailbox)


def is_graph_next_link(value: str) -> bool:
    parsed = parse.urlparse(str(value or ""))
    normalized_path = parse.unquote(parsed.path).lower()
    return (
        parsed.scheme == "https"
        and parsed.netloc.lower() == "graph.microsoft.com"
        and normalized_path.startswith("/v1.0/me/mailfolders")
        and "/messages" in normalized_path
    )


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


def get_json_url(url: str, headers: dict[str, str], timeout: int = 30) -> dict[str, Any]:
    req = request.Request(
        url,
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


def read_messages(
    account_line: str,
    top: int = DEFAULT_TOP,
    skip: int = 0,
    next_link: str = "",
    mail_scope: str = "nonjunk",
) -> dict[str, Any]:
    account = parse_outlook_account_line(account_line)
    top = normalize_top(top)
    skip = normalize_skip(skip)
    next_link = str(next_link or "").strip()
    mail_scope = normalize_mail_scope(mail_scope)

    graph_error = ""
    try:
        messages, graph_next_link = read_messages_graph(
            account["client_id"],
            account["refresh_token"],
            top,
            skip=skip,
            next_link=next_link,
            mail_scope=mail_scope,
        )
        return {
            "source": "Microsoft Graph",
            "account": account,
            "messages": messages,
            "next_link": graph_next_link,
            "has_more": bool(graph_next_link),
        }
    except OutlookReadError as exc:
        graph_error = f"{exc}; {exc.details}".strip()

    try:
        messages, has_more, imap_server = read_messages_imap(
            account["email"],
            account["client_id"],
            account["refresh_token"],
            top,
            skip,
            mail_scope=mail_scope,
        )
        return {
            "source": f"IMAP XOAUTH2 {imap_server}",
            "account": account,
            "messages": messages,
            "next_link": "",
            "has_more": has_more,
        }
    except OutlookReadError as exc:
        details = "\n".join(part for part in (f"Graph: {graph_error}", f"IMAP: {exc.details}") if part)
        raise OutlookReadError("读取邮件失败", details=details) from exc


def read_messages_graph(
    client_id: str,
    refresh_token: str,
    top: int,
    *,
    skip: int = 0,
    next_link: str = "",
    mail_scope: str = "all",
) -> tuple[list[dict[str, Any]], str]:
    access_token = get_access_token(client_id, refresh_token, GRAPH_TOKEN_ATTEMPTS)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Prefer": "outlook.body-content-type='html'",
    }
    if next_link:
        return read_graph_next_links(next_link, headers, top)
    else:
        messages: list[dict[str, Any]] = []
        next_links: dict[str, str] = {}
        for folder in folders_for_scope(normalize_mail_scope(mail_scope)):
            folder_id = GRAPH_FOLDER_IDS[folder]
            params: dict[str, Any] = {
                "$top": top,
                # 列表页只读取摘要字段，正文改为点开邮件后按需加载，避免一次拖回多封 HTML 正文。
                "$select": GRAPH_MESSAGE_LIST_SELECT,
                "$orderby": "receivedDateTime desc",
            }
            if skip:
                params["$skip"] = skip
            url = f"https://graph.microsoft.com/v1.0/me/mailFolders/{folder_id}/messages"
            data = get_json(url, headers=headers, params=params)
            folder_messages = [normalize_graph_message(item) for item in data.get("value", [])]
            for message in folder_messages:
                message["folder"] = folder
            messages.extend(folder_messages)
            if data.get("@odata.nextLink"):
                next_links[folder] = str(data["@odata.nextLink"])

        messages.sort(key=lambda item: item.get("received_at") or "", reverse=True)
        return messages[:top], json.dumps(next_links, ensure_ascii=False) if next_links else ""


def read_graph_next_links(next_link: str, headers: dict[str, str], top: int) -> tuple[list[dict[str, Any]], str]:
    parsed_links = parse_graph_next_links(next_link)
    messages: list[dict[str, Any]] = []
    next_links: dict[str, str] = {}
    for folder, url in parsed_links.items():
        if not is_graph_next_link(url):
            raise OutlookReadError("Graph 下一页链接无效")
        data = get_json_url(url, headers=headers)
        folder_messages = [normalize_graph_message(item) for item in data.get("value", [])]
        for message in folder_messages:
            message["folder"] = folder
        messages.extend(folder_messages)
        if data.get("@odata.nextLink"):
            next_links[folder] = str(data["@odata.nextLink"])
    messages.sort(key=lambda item: item.get("received_at") or "", reverse=True)
    return messages[:top], json.dumps(next_links, ensure_ascii=False) if next_links else ""


def read_graph_message_detail(client_id: str, refresh_token: str, message_id: str) -> dict[str, Any]:
    message_id = str(message_id or "").strip()
    if not message_id:
        raise OutlookReadError("邮件 ID 不能为空")

    access_token = get_access_token(client_id, refresh_token, GRAPH_TOKEN_ATTEMPTS)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Prefer": "outlook.body-content-type='html'",
    }
    encoded_message_id = parse.quote(message_id, safe="")
    url = f"https://graph.microsoft.com/v1.0/me/messages/{encoded_message_id}"
    data = get_json(url, headers=headers, params={"$select": GRAPH_MESSAGE_DETAIL_SELECT})
    return normalize_graph_message(data)


def read_message_detail(account: dict[str, str], message_id: str, source: str = "") -> tuple[dict[str, Any], str]:
    normalized_source = str(source or "").strip().lower()
    if normalized_source.startswith("imap") or re.match(r"^(inbox|junk):\d+$", str(message_id or "").strip()):
        message, imap_server = read_imap_message_detail(
            account["email"],
            account["client_id"],
            account["refresh_token"],
            message_id,
        )
        return message, f"IMAP XOAUTH2 {imap_server}"

    return read_graph_message_detail(account["client_id"], account["refresh_token"], message_id), "Microsoft Graph"


def parse_graph_next_links(value: str) -> dict[str, str]:
    raw = str(value or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"junk" if "junkemail" in raw.lower() else "inbox": raw}
    if not isinstance(data, dict):
        return {}
    result: dict[str, str] = {}
    for folder, url in data.items():
        folder_key = "junk" if str(folder).lower() == "junk" else "inbox"
        if url:
            result[folder_key] = str(url)
    return result


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


def read_messages_imap(
    email_addr: str,
    client_id: str,
    refresh_token: str,
    top: int,
    skip: int = 0,
    mail_scope: str = "all",
) -> tuple[list[dict[str, Any]], bool, str]:
    connection = None
    try:
        connection, server = open_imap_connection(email_addr, client_id, refresh_token)
        messages: list[dict[str, Any]] = []
        has_more = False
        for folder in folders_for_scope(normalize_mail_scope(mail_scope)):
            folder_messages, folder_has_more = read_imap_folder(connection, folder, top, skip)
            messages.extend(folder_messages)
            has_more = has_more or folder_has_more
        messages.sort(key=lambda item: item.get("received_at") or "", reverse=True)
        return messages[:top], has_more, server
    finally:
        logout_imap(connection)


def open_imap_connection(email_addr: str, client_id: str, refresh_token: str) -> tuple[imaplib.IMAP4_SSL, str]:
    access_token = get_access_token(client_id, refresh_token, IMAP_TOKEN_ATTEMPTS)
    errors: list[str] = []

    for server in IMAP_SERVERS:
        connection = None
        try:
            connection = imaplib.IMAP4_SSL(server, 993, timeout=30)
            auth_string = f"user={email_addr}\x01auth=Bearer {access_token}\x01\x01".encode("utf-8")
            connection.authenticate("XOAUTH2", lambda _: auth_string)
            return connection, server
        except Exception as exc:
            errors.append(f"{server}: {exc}")
            logout_imap(connection)

    raise OutlookReadError("IMAP 读取失败", details="\n".join(errors))


def logout_imap(connection: imaplib.IMAP4_SSL | None) -> None:
    if connection is None:
        return
    try:
        connection.logout()
    except Exception:
        pass


def read_imap_folder(
    connection: imaplib.IMAP4_SSL,
    folder: str,
    top: int,
    skip: int,
) -> tuple[list[dict[str, Any]], bool]:
    mailbox_data, selected_mailbox = select_imap_folder(connection, folder)
    if not mailbox_data:
        return [], False

    total_messages = int(mailbox_data[0])
    if total_messages <= 0:
        return [], False
    end = total_messages - skip
    if end <= 0:
        return [], False

    start = max(1, end - top + 1)
    messages: list[dict[str, Any]] = []
    for sequence_number in range(end, start - 1, -1):
        message_id = f"{folder}:{sequence_number}"
        status, fetched = connection.fetch(str(sequence_number), IMAP_HEADER_FETCH)
        if status != "OK" or not fetched or not fetched[0]:
            continue
        raw = extract_fetch_payload(fetched)
        if raw:
            message = normalize_imap_header_message(raw, message_id, fetched)
            message["folder"] = folder
            message["folder_name"] = selected_mailbox
            messages.append(message)
    return messages, start > 1


def select_imap_folder(connection: imaplib.IMAP4_SSL, folder: str) -> tuple[list[bytes] | None, str]:
    for mailbox in IMAP_FOLDER_NAMES[folder]:
        for selector in iter_imap_mailbox_selectors(mailbox):
            try:
                status, candidate_data = connection.select(selector, readonly=True)
            except Exception:
                continue
            if status == "OK" and candidate_data and candidate_data[0]:
                return candidate_data, mailbox
    return None, ""


def extract_fetch_payload(fetched: Any) -> bytes:
    for item in fetched or []:
        if isinstance(item, tuple) and len(item) > 1 and isinstance(item[1], bytes):
            return item[1]
    return b""


def extract_fetch_metadata(fetched: Any) -> str:
    chunks: list[str] = []
    for item in fetched or []:
        if isinstance(item, tuple) and item:
            chunks.append(item[0].decode("utf-8", "replace") if isinstance(item[0], bytes) else str(item[0]))
        elif isinstance(item, bytes):
            chunks.append(item.decode("utf-8", "replace"))
    return " ".join(chunks)


def normalize_imap_header_message(raw_headers: bytes, message_id: str, fetched: Any = None) -> dict[str, Any]:
    message = email.message_from_bytes(raw_headers)
    sender_name, sender_address = parseaddr(decode_mime(str(message.get("From", ""))))
    recipient_name, recipient_address = parseaddr(decode_mime(str(message.get("To", ""))))
    received_at = normalize_email_date(str(message.get("Date", "")))
    metadata = extract_fetch_metadata(fetched)
    return {
        "id": message_id,
        "subject": decode_mime(str(message.get("Subject", ""))) or "(无主题)",
        "from_name": sender_name,
        "from_address": sender_address,
        "to": [{"name": recipient_name, "address": recipient_address}] if recipient_address else [],
        "received_at": received_at,
        "is_read": "\\Seen" in metadata,
        "has_attachments": False,
        "preview": "",
        "body": "",
        "body_text": "",
        "body_html": "",
        "body_type": "text",
    }


def read_imap_message_detail(email_addr: str, client_id: str, refresh_token: str, message_id: str) -> tuple[dict[str, Any], str]:
    match = re.match(r"^(inbox|junk):(\d+)$", str(message_id or "").strip())
    if not match:
        raise OutlookReadError("IMAP 邮件 ID 无效")

    folder, sequence_number = match.groups()
    connection = None
    try:
        connection, server = open_imap_connection(email_addr, client_id, refresh_token)
        mailbox_data, selected_mailbox = select_imap_folder(connection, folder)
        if not mailbox_data:
            raise OutlookReadError("IMAP 邮箱文件夹不存在")
        status, fetched = connection.fetch(sequence_number, "(RFC822)")
        if status != "OK":
            raise OutlookReadError("IMAP 正文读取失败", details=str(fetched))
        raw = extract_fetch_payload(fetched)
        if not raw:
            raise OutlookReadError("IMAP 正文为空")
        message = normalize_imap_message(raw, message_id)
        message["folder"] = folder
        message["folder_name"] = selected_mailbox
        return message, server
    finally:
        logout_imap(connection)


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
        if self.path == "/api/message-detail":
            self.handle_message_detail()
            return
        self.send_json({"error": "Not found"}, status=HTTPStatus.NOT_FOUND)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_cors_headers()
        self.end_headers()

    def handle_messages(self) -> None:
        try:
            payload = self.read_json_body()
            result = read_messages(
                payload.get("account", ""),
                payload.get("top", DEFAULT_TOP),
                payload.get("skip", 0),
                payload.get("next_link", ""),
                payload.get("scope", "nonjunk"),
            )
            account = result["account"]
            self.send_json(
                {
                    "source": result["source"],
                    "account": {
                        "email": account["email"],
                        "client_id": account["client_id"],
                    },
                    "messages": result["messages"],
                    "next_link": result.get("next_link", ""),
                    "has_more": bool(result.get("has_more")),
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

    def handle_message_detail(self) -> None:
        try:
            payload = self.read_json_body()
            account = parse_outlook_account_line(payload.get("account", ""))
            message, source = read_message_detail(account, payload.get("message_id", ""), payload.get("source", ""))
            self.send_json(
                {
                    "source": source,
                    "account": {
                        "email": account["email"],
                        "client_id": account["client_id"],
                    },
                    "message": message,
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
