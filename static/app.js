const state = {
  accounts: [],
  messages: [],
  selectedAccountId: null,
  selectedMessageKey: null,
  filter: "all",
  mailScope: "nonjunk",
  showSource: false,
  visibleByAccount: {},
  accountSort: "createdDesc",
};

const STORAGE_KEY = "outlook-mail-lite-state-v1";

const accountForm = document.querySelector("#account-form");
const accountInput = document.querySelector("#account-input");
const accountSearch = document.querySelector("#account-search");
const accountList = document.querySelector("#account-list");
const accountModal = document.querySelector("#account-modal");
const confirmModal = document.querySelector("#confirm-modal");
const addAccountButton = document.querySelector("#add-account-button");
const clearAccountsButton = document.querySelector("#clear-accounts-button");
const clearStorageButton = document.querySelector("#clear-storage-button");
const confirmClearButton = document.querySelector("#confirm-clear-button");
const fetchButton = document.querySelector("#fetch-button");
const sortSelect = document.querySelector("#sort-select");
const topSelect = document.querySelector("#top-select");
const mailSummary = document.querySelector("#mail-summary");
const statusBox = document.querySelector("#status");
const messageList = document.querySelector("#message-list");
const detail = document.querySelector("#message-detail");
const folderTabs = document.querySelectorAll(".folder-tab");
const toggleSourceButton = document.querySelector("#toggle-source-button");
const trustMailCheckbox = document.querySelector("#trust-mail-checkbox");
const toast = document.querySelector("#toast");
const customSelects = document.querySelectorAll("[data-custom-select]");
const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8765" : "";
const ACCOUNT_SORT_VALUES = new Set(["emailAsc", "emailDesc", "createdDesc", "createdAsc"]);
const MAIL_SCOPE_LABELS = {
  all: "全部邮件",
  nonjunk: "非垃圾邮件",
  junk: "仅垃圾邮件",
};

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.accounts = Array.isArray(saved.accounts) ? saved.accounts : [];
    state.messages = Array.isArray(saved.messages) ? saved.messages : [];
    state.selectedAccountId = saved.selectedAccountId || state.accounts[0]?.id || null;
    state.selectedMessageKey = saved.selectedMessageKey || null;
    state.filter = saved.filter || "all";
    state.mailScope = normalizeMailScope(saved.mailScope);
    state.accountSort = normalizeAccountSort(saved.accountSort);
    state.visibleByAccount = saved.visibleByAccount && typeof saved.visibleByAccount === "object" ? saved.visibleByAccount : {};
    state.accounts.forEach((account) => {
      account.status = account.status || "idle";
      account.source = account.source || "";
      account.error = account.error || "";
      account.count = Number(account.count || 0);
      account.hasMore = Boolean(account.hasMore);
      account.nextLink = account.nextLink || "";
      account.nextLinkTop = Number(account.nextLinkTop || 0);
      account.lastReadAt = account.lastReadAt || "";
      account.createdAt = account.createdAt || account.lastReadAt || "";
    });
    state.messages.forEach((message) => {
      message.verificationCode = message.verificationCode || extractVerificationCode(message);
    });
    sortSelect.value = state.accountSort;
    syncCustomSelect(sortSelect);
    syncCustomSelect(topSelect);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  const payload = {
    accounts: state.accounts,
    messages: state.messages,
    selectedAccountId: state.selectedAccountId,
    selectedMessageKey: state.selectedMessageKey,
    filter: state.filter,
    mailScope: state.mailScope,
    accountSort: state.accountSort,
    visibleByAccount: state.visibleByAccount,
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function clearSavedState() {
  localStorage.removeItem(STORAGE_KEY);
  state.accounts = [];
  state.messages = [];
  state.selectedAccountId = null;
  state.selectedMessageKey = null;
  state.filter = "all";
  state.mailScope = "nonjunk";
  state.accountSort = "createdDesc";
  state.visibleByAccount = {};
  sortSelect.value = state.accountSort;
  syncCustomSelect(sortSelect);
  folderTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.filter === "all"));
  setStatus("本地邮箱数据已清空");
  showToast("已清空本地邮箱");
  render();
}

function createId(prefix = "id") {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeAccountSort(value) {
  if (value === "email") {
    return "emailAsc";
  }
  if (value === "createdAt") {
    return "createdDesc";
  }
  if (value === "countDesc" || value === "countAsc") {
    return "createdDesc";
  }
  return ACCOUNT_SORT_VALUES.has(value) ? value : "createdDesc";
}

function normalizeMailScope(value) {
  return Object.prototype.hasOwnProperty.call(MAIL_SCOPE_LABELS, value) ? value : "nonjunk";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getEmailFromLine(line) {
  return line.split("----")[0]?.trim() || "";
}

function setStatus(message, type = "") {
  if (type === "loading" && message) {
    statusBox.innerHTML = `<span class="status-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
  } else {
    statusBox.textContent = message || "";
  }
  statusBox.className = `status ${message ? "visible" : ""} ${type}`.trim();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("visible");
  void toast.offsetWidth;
  toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("visible"), 1500);
}

function buildCustomSelect(select) {
  const wrap = select.closest("[data-select-wrap]");
  if (!wrap || wrap.querySelector(".select-trigger")) {
    return;
  }

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "select-trigger";
  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");

  const label = document.createElement("span");
  label.className = "select-value";
  const arrow = document.createElement("span");
  arrow.className = "select-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "⌄";
  trigger.append(label, arrow);

  const menu = document.createElement("div");
  menu.className = "select-menu";
  menu.setAttribute("role", "listbox");
  [...select.options].forEach((option) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "select-option";
    item.dataset.value = option.value;
    item.setAttribute("role", "option");
    item.textContent = option.textContent;
    item.addEventListener("click", () => {
      select.value = option.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      closeCustomSelects();
    });
    menu.append(item);
  });

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = !wrap.classList.contains("open");
    closeCustomSelects();
    wrap.classList.toggle("open", willOpen);
    trigger.setAttribute("aria-expanded", String(willOpen));
  });

  wrap.append(trigger, menu);
  syncCustomSelect(select);
}

function syncCustomSelect(select) {
  const wrap = select.closest("[data-select-wrap]");
  if (!wrap) {
    return;
  }
  const selectedOption = select.selectedOptions[0];
  const label = wrap.querySelector(".select-value");
  if (label) {
    label.textContent = selectedOption?.textContent || "";
  }
  wrap.querySelectorAll(".select-option").forEach((option) => {
    const selected = option.dataset.value === select.value;
    option.classList.toggle("selected", selected);
    option.setAttribute("aria-selected", String(selected));
  });
}

function closeCustomSelects() {
  document.querySelectorAll("[data-select-wrap].open").forEach((wrap) => {
    wrap.classList.remove("open");
    wrap.querySelector(".select-trigger")?.setAttribute("aria-expanded", "false");
  });
}

function openAccountModal() {
  accountModal.classList.add("open");
  accountModal.setAttribute("aria-hidden", "false");
  window.setTimeout(() => accountInput.focus(), 30);
}

function closeAccountModal() {
  accountModal.classList.remove("open");
  accountModal.setAttribute("aria-hidden", "true");
}

function openConfirmModal() {
  confirmModal.classList.add("open");
  confirmModal.setAttribute("aria-hidden", "false");
}

function closeConfirmModal() {
  confirmModal.classList.remove("open");
  confirmModal.setAttribute("aria-hidden", "true");
}

async function addAccountsFromInput() {
  const lines = accountInput.value
    .split(/\r?\n/)
    .map((line) => line.trim());

  const addedAccounts = [];
  const failures = [];
  let blankCount = 0;
  for (const line of lines) {
    if (!line) {
      blankCount += 1;
      continue;
    }
    const parts = line.split("----").map((part) => part.trim());
    if (parts.length < 4) {
      failures.push({ line, reason: "格式不完整" });
      continue;
    }
    const email = getEmailFromLine(line);
    if (!email) {
      failures.push({ line, reason: "邮箱为空" });
      continue;
    }
    const exists = state.accounts.some((account) => account.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      failures.push({ line, reason: "邮箱已存在" });
      continue;
    }
    const account = {
      id: createId("account"),
      email,
      raw: line,
      status: "idle",
      source: "",
      error: "",
      count: 0,
      hasMore: false,
      nextLink: "",
      nextLinkTop: 0,
      lastReadAt: "",
      createdAt: new Date().toISOString(),
    };
    state.accounts.push(account);
    state.visibleByAccount[account.id] = 10;
    addedAccounts.push(account);
    if (!state.selectedAccountId) {
      state.selectedAccountId = account.id;
    }
  }

  accountInput.value = "";
  closeAccountModal();
  render();

  const summary = `成功加入 ${addedAccounts.length} 个，失败 ${failures.length} 个`;
  if (!addedAccounts.length) {
    const detail = failures.slice(0, 3).map((item) => `${item.reason}: ${item.line}`).join("\n");
    setStatus(`${summary}${detail ? `\n${detail}` : ""}`, "warning");
    showToast(summary);
    return;
  }

  const failureDetail = failures.slice(0, 3).map((item) => `${item.reason}: ${item.line}`).join("\n");
  const firstAdded = addedAccounts[0];
  state.selectedAccountId = firstAdded.id;
  state.selectedMessageKey = null;
  setStatus(`${summary}。点击“获取邮件”读取选中邮箱。${failureDetail ? `\n${failureDetail}` : ""}`, failures.length ? "warning" : "");
  showToast(summary);
  saveState();
  render();
}

async function fetchAccount(account, options = {}) {
  const append = Boolean(options.append);
  const existingAccountMessages = state.messages.filter(
    (message) => message.accountId === account.id && isMessageInActiveScope(message)
  );
  const hadMessages = existingAccountMessages.length > 0;
  const requestedTop = Number(options.top || (append ? 10 : state.visibleByAccount[account.id]) || topSelect.value || 10);
  const skip = Number(options.skip ?? (append ? existingAccountMessages.length : 0));
  const nextLink = append && account.nextLinkTop === requestedTop ? account.nextLink || "" : "";
  account.status = "loading";
  account.error = "";
  if (!hadMessages || !append) {
    account.count = 0;
  }
  if (!append) {
    account.nextLink = "";
    account.nextLinkTop = 0;
  }
  if (!hadMessages || !append) {
    state.selectedMessageKey = null;
  }
  saveState();
  render();

  const response = await fetch(`${API_BASE}/api/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account: account.raw,
      top: requestedTop,
      skip,
      next_link: nextLink,
      scope: state.mailScope,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`${data.error || "读取失败"}${data.details ? `\n${data.details}` : ""}`);
  }

  const existingOtherMessages = state.messages.filter(
    (message) => message.accountId !== account.id || !isMessageInActiveScope(message)
  );
  const incomingMessages = data.messages.map((message, index) => ({
    ...message,
    key: `${account.id}-${message.id || skip + index}`,
    accountId: account.id,
    accountEmail: account.email,
    source: data.source,
    folder: message.folder || "inbox",
    folderName: message.folder_name || "",
    verificationCode: extractVerificationCode(message),
  }));
  const accountMessageMap = new Map();
  if (append) {
    existingAccountMessages.forEach((message) => accountMessageMap.set(message.key, message));
  }
  incomingMessages.forEach((message) => accountMessageMap.set(message.key, message));
  const accountMessages = [...accountMessageMap.values()].sort(compareMessageTimeDesc);

  state.messages = [...existingOtherMessages, ...accountMessages].sort(compareMessageTimeDesc);
  account.status = "loaded";
  account.source = data.source;
  account.count = accountMessages.length;
  account.hasMore = Boolean(data.has_more);
  account.nextLink = data.next_link || "";
  account.nextLinkTop = account.nextLink ? requestedTop : 0;
  account.lastReadAt = new Date().toISOString();
  state.visibleByAccount[account.id] = append ? accountMessages.length : requestedTop;

  if (!append) {
    const visible = getVisibleMessages();
    state.selectedMessageKey = visible[0]?.key || accountMessages[0]?.key || null;
  }
  saveState();
}

async function refreshAccount(account, options = {}) {
  try {
    await fetchAccount(account, options);
    if (!options.silent) {
      setStatus(`${account.email} 读取完成，共 ${account.count} 封`);
    }
  } catch (error) {
    account.status = "error";
    account.error = error.message;
    if (!options.silent) {
      setStatus(error.message, "error");
    }
  } finally {
    saveState();
    render();
  }
}

async function fetchSelectedAccounts() {
  if (!state.accounts.length) {
    setStatus("请先添加邮箱", "warning");
    return;
  }

  fetchButton.disabled = true;
  const account = state.accounts.find((item) => item.id === state.selectedAccountId) || state.accounts[0];
  state.selectedAccountId = account.id;
  state.visibleByAccount[account.id] = Number(topSelect.value || 10);
  setStatus(`正在读取 ${account.email}...`, "loading");
  await refreshAccount(account, { silent: true, top: state.visibleByAccount[account.id] });
  fetchButton.disabled = false;
  setStatus(account.status === "error" ? account.error : `${account.email} 读取完成，共 ${account.count} 封`, account.status === "error" ? "error" : "");
  saveState();
}

function compareMessageTimeDesc(left, right) {
  const leftTime = new Date(left.received_at || 0).getTime() || 0;
  const rightTime = new Date(right.received_at || 0).getTime() || 0;
  return rightTime - leftTime;
}

function getVisibleAccounts() {
  const query = accountSearch.value.trim().toLowerCase();
  const accounts = query
    ? state.accounts.filter((account) => account.email.toLowerCase().includes(query))
    : [...state.accounts];
  return accounts.sort(compareAccounts);
}

function compareAccounts(left, right) {
  const emailCompare = left.email.localeCompare(right.email, "zh-CN", { sensitivity: "base" });
  if (state.accountSort === "emailDesc") {
    return -emailCompare;
  }
  if (state.accountSort === "createdDesc" || state.accountSort === "createdAsc") {
    const leftTime = getAccountCreatedTime(left);
    const rightTime = getAccountCreatedTime(right);
    const timeCompare = leftTime - rightTime;
    return state.accountSort === "createdAsc"
      ? timeCompare || emailCompare
      : -timeCompare || emailCompare;
  }
  return emailCompare;
}

function getAccountCreatedTime(account) {
  return new Date(account.createdAt || account.lastReadAt || 0).getTime() || 0;
}

function getVisibleMessages() {
  let messages = state.selectedAccountId
    ? state.messages.filter((message) => message.accountId === state.selectedAccountId)
    : state.messages;

  messages = filterMessagesByScope(messages);
  if (state.filter === "unread") {
    messages = messages.filter((message) => !message.is_read);
  }
  if (state.selectedAccountId) {
    const visibleCount = state.visibleByAccount[state.selectedAccountId] || 10;
    return messages.slice(0, visibleCount);
  }
  return messages;
}

function getAllFilteredMessagesForSelectedAccount() {
  if (!state.selectedAccountId) {
    return filterMessagesByScope(state.messages);
  }
  let messages = state.messages.filter((message) => message.accountId === state.selectedAccountId);
  messages = filterMessagesByScope(messages);
  if (state.filter === "unread") {
    messages = messages.filter((message) => !message.is_read);
  }
  return messages;
}

function filterMessagesByScope(messages) {
  if (state.mailScope === "junk") {
    return messages.filter((message) => isJunkMessage(message));
  }
  if (state.mailScope === "nonjunk" || state.mailScope === "all") {
    return messages.filter((message) => !isJunkMessage(message));
  }
  return messages;
}

function isJunkMessage(message) {
  return message.folder === "junk";
}

function isMessageInActiveScope(message) {
  if (state.mailScope === "junk") {
    return isJunkMessage(message);
  }
  return !isJunkMessage(message);
}

function getSelectedMessage() {
  return state.messages.find((message) => message.key === state.selectedMessageKey);
}

function extractVerificationCode(message) {
  const text = [
    message.subject,
    message.preview,
    message.body_text,
    message.body,
  ]
    .filter(Boolean)
    .join("\n");

  const keywordPattern = /(验证码|验证|校验|代码|code|verification|verify|otp|login|登录)/i;
  const candidates = [...text.matchAll(/(?<![A-Za-z0-9])([A-Z0-9]{4,10})(?![A-Za-z0-9])/g)]
    .map((match) => ({
      value: match[1],
      index: match.index || 0,
    }))
    .filter((item) => /\d/.test(item.value));

  if (!candidates.length) {
    return "";
  }

  const contextual = candidates.find((candidate) => {
    const start = Math.max(0, candidate.index - 48);
    const end = Math.min(text.length, candidate.index + candidate.value.length + 48);
    return keywordPattern.test(text.slice(start, end));
  });

  return (contextual || candidates[0]).value;
}

async function copyCode(value) {
  await copyText(value, `已复制验证码 ${value}`);
}

async function copyText(value, message = "已复制") {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const input = document.createElement("input");
    input.value = value;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  showToast(message);
}

function renderAccounts() {
  const accounts = getVisibleAccounts();
  if (!accounts.length) {
    accountList.innerHTML = `
      <div class="blank-card">
        <strong>暂无邮箱</strong>
        <span>点击左上角“添加邮箱”开始。</span>
      </div>
    `;
    return;
  }

  accountList.innerHTML = accounts
    .map((account) => {
      const selected = account.id === state.selectedAccountId ? "selected" : "";
      const statusLabel = getAccountStatusLabel(account);
      return `
        <button class="account-card ${selected}" type="button" data-account-id="${escapeHtml(account.id)}">
          <span class="check-box"></span>
          <span class="account-main">
            <strong>${escapeHtml(account.email)}</strong>
            <span><span class="pill">Outlook</span>${escapeHtml(statusLabel)}</span>
            ${account.error ? `<small>${escapeHtml(account.error.split("\n")[0])}</small>` : ""}
          </span>
          <span class="account-side">
            <span class="account-actions">
              <span class="mini-action" role="button" tabindex="0" data-account-action="copy-email" title="复制邮箱名">⧉</span>
              <span class="mini-action key" role="button" tabindex="0" data-account-action="copy-token" title="复制邮箱令牌">⚿</span>
            </span>
            <span class="account-count">${account.status === "loading" ? "..." : account.count}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function getAccountStatusLabel(account) {
  if (account.status === "loading") {
    return "读取中";
  }
  if (account.status === "loaded") {
    return formatDate(account.lastReadAt);
  }
  if (account.status === "error") {
    return "读取失败";
  }
  return account.createdAt ? formatDate(account.createdAt) : "未读取";
}

function renderMessages() {
  const messages = getVisibleMessages();
  const allFilteredMessages = getAllFilteredMessagesForSelectedAccount();
  const total = allFilteredMessages.length;
  const selectedAccount = state.accounts.find((account) => account.id === state.selectedAccountId);
  mailSummary.innerHTML = selectedAccount
    ? `<span class="summary-title-row"><span class="summary-title">邮件</span><span class="summary-count">已显示 ${messages.length}/${total} 封</span></span><button class="summary-current-email" type="button" data-copy-current-email="${escapeHtml(selectedAccount.email)}" title="点击复制邮箱"><span>当前邮箱：${escapeHtml(selectedAccount.email)}</span></button>`
    : `<span class="summary-title-row"><span class="summary-title">邮件</span><span class="summary-count">${total} 封</span></span><span class="summary-current-email muted"><span>当前邮箱：未选择</span></span>`;

  if (selectedAccount?.status === "loading" && !messages.length) {
    messageList.innerHTML = `
      <div class="loading-card">
        <div class="loader"></div>
        <strong>邮件获取中...</strong>
        <span>正在读取 ${escapeHtml(selectedAccount.email)}</span>
      </div>
    `;
    return;
  }

  if (!messages.length) {
    messageList.innerHTML = `
      <div class="blank-card">
        <strong>没有邮件</strong>
        <span>点击左侧邮箱或右上角“获取邮件”读取当前邮箱。</span>
      </div>
    `;
    return;
  }

  const hasMore = Boolean(state.selectedAccountId && selectedAccount?.hasMore);
  messageList.innerHTML = messages
    .map((message) => {
      const selected = message.key === state.selectedMessageKey ? "selected" : "";
      const from = message.from_name || message.from_address || "未知发件人";
      const folderLabel = isJunkMessage(message) ? "垃圾邮件" : "收件箱";
      const folderClass = isJunkMessage(message) ? "junk" : "inbox";
      const codeBadge = message.verificationCode
        ? `<button class="code-badge" type="button" data-code="${escapeHtml(message.verificationCode)}" title="点击复制疑似验证码">${escapeHtml(message.verificationCode)}</button>`
        : "";
      return `
        <article class="mail-item ${selected}" data-message-key="${escapeHtml(message.key)}">
          <div class="mail-select"></div>
          <div class="mail-body">
            <div class="mail-row">
              <strong>${escapeHtml(from)}</strong>
              <time>${escapeHtml(formatDate(message.received_at))}</time>
            </div>
            <div class="subject-line">
              <h3>${escapeHtml(message.subject || "(无主题)")}</h3>
              ${codeBadge}
            </div>
            <p>${escapeHtml(message.preview || message.body_text || message.body || "")}</p>
            <div class="mail-tags">
              <span class="tag ${folderClass}">${folderLabel}</span>
              <span>${escapeHtml(message.accountEmail)}</span>
              ${message.has_attachments ? '<span class="tag">附件</span>' : ""}
            </div>
          </div>
        </article>
      `;
    })
    .join("") + (hasMore ? `
      <button class="load-more" type="button" data-load-more>
        加载更多
        <span>点击再读取 10 封</span>
      </button>
    ` : "");
}

function renderDetail() {
  const message = getSelectedMessage();
  if (!message) {
    detail.className = "message-detail empty";
    detail.innerHTML = `
      <div class="empty-state">
        <h2>选择一封邮件</h2>
        <p>邮件正文会显示在这里。</p>
      </div>
    `;
    return;
  }

  const from = `${message.from_name || message.from_address || "未知发件人"}${
    message.from_address ? ` <${message.from_address}>` : ""
  }`;
  const to = (message.to || [])
    .map((recipient) => `${recipient.name || recipient.address}${recipient.address ? ` <${recipient.address}>` : ""}`)
    .join("; ");

  const content = renderMessageContent(message);
  const codePanel = message.verificationCode
    ? `<button class="detail-code" type="button" data-code="${escapeHtml(message.verificationCode)}">
        <span class="detail-code-inner"><span>疑似验证码</span><strong>${escapeHtml(message.verificationCode)}</strong><em>点击复制</em></span>
      </button>`
    : "";

  detail.className = "message-detail";
  detail.innerHTML = `
    <header class="detail-head">
      <h2>${escapeHtml(message.subject || "(无主题)")}</h2>
      <dl>
        <div><dt>发件人</dt><dd>${escapeHtml(from)}</dd></div>
        <div><dt>收件人</dt><dd>${escapeHtml(to || message.accountEmail)}</dd></div>
        <div><dt>时间</dt><dd>${escapeHtml(formatDate(message.received_at))}</dd></div>
      </dl>
    </header>
    ${codePanel}
    ${content}
  `;
}

function renderMessageContent(message) {
  if (state.showSource) {
    return `<pre class="detail-content source">${escapeHtml(JSON.stringify(message, null, 2))}</pre>`;
  }

  if (message.body_html) {
    return `<div class="detail-content html-content">${sanitizeHtml(message.body_html)}</div>`;
  }

  return `<div class="detail-content rich-text">${renderMarkdownLite(message.body_text || message.body || message.preview || "没有可显示的正文。")}</div>`;
}

function sanitizeHtml(rawHtml) {
  const template = document.createElement("template");
  template.innerHTML = rawHtml || "";
  template.content.querySelectorAll("script, style, iframe, object, embed, form, input, button").forEach((node) => {
    node.remove();
  });
  template.content.querySelectorAll("*").forEach((node) => {
    [...node.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "srcdoc") {
        node.removeAttribute(attribute.name);
        return;
      }
      if ((name === "href" || name === "src") && /^(javascript|data):/i.test(value)) {
        node.removeAttribute(attribute.name);
      }
      if (name === "style") {
        node.removeAttribute(attribute.name);
      }
    });
  });
  return template.innerHTML;
}

function renderMarkdownLite(value) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n{2,}/g, "</p><p>")
    .replace(/\n/g, "<br>")
    .replace(/^/, "<p>")
    .replace(/$/, "</p>");
}

function render() {
  renderAccounts();
  renderMessages();
  renderDetail();
}

accountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addAccountsFromInput();
});

addAccountButton.addEventListener("click", openAccountModal);

accountModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-modal]")) {
    closeAccountModal();
  }
});

confirmModal.addEventListener("click", (event) => {
  if (event.target.matches("[data-close-confirm]")) {
    closeConfirmModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeCustomSelects();
  }
  if (event.key === "Escape" && accountModal.classList.contains("open")) {
    closeAccountModal();
  }
  if (event.key === "Escape" && confirmModal.classList.contains("open")) {
    closeConfirmModal();
  }
});

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-select-wrap]")) {
    closeCustomSelects();
  }
});

clearAccountsButton.addEventListener("click", () => {
  accountInput.value = "";
  accountInput.focus();
});

accountSearch.addEventListener("input", renderAccounts);

sortSelect.addEventListener("change", () => {
  state.accountSort = normalizeAccountSort(sortSelect.value);
  sortSelect.value = state.accountSort;
  syncCustomSelect(sortSelect);
  saveState();
  renderAccounts();
});

topSelect.addEventListener("change", () => {
  syncCustomSelect(topSelect);
});

fetchButton.addEventListener("click", fetchSelectedAccounts);

accountList.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-account-action]");
  if (action) {
    event.preventDefault();
    event.stopPropagation();
    const card = action.closest(".account-card");
    const account = state.accounts.find((item) => item.id === card?.dataset.accountId);
    if (!account) {
      return;
    }
    if (action.dataset.accountAction === "copy-email") {
      await copyText(account.email, "已复制邮箱名");
      return;
    }
    if (action.dataset.accountAction === "copy-token") {
      await copyText(account.raw, "已复制邮箱令牌");
      return;
    }
  }

  const card = event.target.closest(".account-card");
  if (!card) {
    return;
  }
  const account = state.accounts.find((item) => item.id === card.dataset.accountId);
  if (!account) {
    return;
  }
  state.selectedAccountId = account.id;
  state.visibleByAccount[account.id] = Number(topSelect.value || 10);
  saveState();
  render();
  setStatus(`正在读取 ${account.email}...`, "loading");
  await refreshAccount(account, { silent: true, top: state.visibleByAccount[account.id] });
  setStatus(account.status === "error" ? account.error : `${account.email} 读取完成，共 ${account.count} 封`, account.status === "error" ? "error" : "");
});

accountList.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  const action = event.target.closest("[data-account-action]");
  if (!action) {
    return;
  }
  event.preventDefault();
  action.click();
});

messageList.addEventListener("click", async (event) => {
  const loadMoreButton = event.target.closest("[data-load-more]");
  if (loadMoreButton) {
    const account = state.accounts.find((item) => item.id === state.selectedAccountId);
    if (!account) {
      return;
    }
    if (loadMoreButton.disabled) {
      return;
    }
    const beforeCount = state.messages.filter((message) => message.accountId === account.id).length;
    loadMoreButton.disabled = true;
    loadMoreButton.innerHTML = `加载中<span>正在读取后 10 封</span>`;
    setStatus(`正在为 ${account.email} 加载更多邮件...`, "loading");
    await refreshAccount(account, { silent: true, top: 10, append: true });
    if (account.status === "error") {
      loadMoreButton.disabled = false;
      setStatus(account.error, "error");
      return;
    }
    const addedCount = Math.max(0, account.count - beforeCount);
    setStatus(
      account.hasMore
        ? `${account.email} 新增读取 ${addedCount} 封，当前共 ${account.count} 封`
        : `${account.email} 新增读取 ${addedCount} 封，已到最后一封`
    );
    return;
  }

  const codeButton = event.target.closest(".code-badge");
  if (codeButton) {
    event.stopPropagation();
    await copyCode(codeButton.dataset.code);
    return;
  }

  const item = event.target.closest(".mail-item");
  if (!item) {
    return;
  }
  state.selectedMessageKey = item.dataset.messageKey;
  saveState();
  render();
});

mailSummary.addEventListener("click", async (event) => {
  const copyButton = event.target.closest("[data-copy-current-email]");
  if (!copyButton) {
    return;
  }
  await copyText(copyButton.dataset.copyCurrentEmail, "已复制当前邮箱");
});

detail.addEventListener("click", async (event) => {
  const codeButton = event.target.closest("[data-code]");
  if (codeButton) {
    await copyCode(codeButton.dataset.code);
  }
});

folderTabs.forEach((tab) => {
  tab.addEventListener("click", async () => {
    state.filter = tab.dataset.filter;
    state.mailScope = state.filter === "junk" ? "junk" : "nonjunk";
    folderTabs.forEach((item) => item.classList.toggle("active", item === tab));
    saveState();
    render();
    if (state.filter === "junk") {
      const account = state.accounts.find((item) => item.id === state.selectedAccountId);
      const hasJunkMessages = account && state.messages.some((message) => message.accountId === account.id && isJunkMessage(message));
      if (account && !hasJunkMessages && account.status !== "loading") {
        state.visibleByAccount[account.id] = Number(topSelect.value || 10);
        setStatus(`正在读取 ${account.email} 的垃圾邮件...`, "loading");
        await refreshAccount(account, { silent: true, top: state.visibleByAccount[account.id] });
        setStatus(account.status === "error" ? account.error : `${account.email} 垃圾邮件读取完成，共 ${account.count} 封`, account.status === "error" ? "error" : "");
      }
    }
    const messages = getVisibleMessages();
    state.selectedMessageKey = messages[0]?.key || null;
    saveState();
    render();
  });
});

toggleSourceButton.addEventListener("click", () => {
  state.showSource = !state.showSource;
  toggleSourceButton.textContent = state.showSource ? "隐藏邮件源" : "显示邮件源";
  renderDetail();
});

trustMailCheckbox.addEventListener("change", () => {
  detail.classList.toggle("trusted", trustMailCheckbox.checked);
  renderDetail();
});

clearStorageButton.addEventListener("click", () => {
  openConfirmModal();
});

confirmClearButton.addEventListener("click", () => {
  clearSavedState();
  closeConfirmModal();
});

customSelects.forEach(buildCustomSelect);
loadSavedState();
render();
