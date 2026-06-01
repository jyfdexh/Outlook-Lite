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
  messageSearch: "",
};

const STORAGE_KEY = "outlook-mail-lite-state-v1";
const THEME_STORAGE_KEY = "outlook-mail-lite-theme";
const HIGHLIGHT_COLOR_STORAGE_KEY = "outlook-mail-lite-highlight-color";
const BACKGROUND_OPACITY_STORAGE_KEY = "outlook-mail-lite-background-opacity";
const DEFAULT_HIGHLIGHT_COLOR = "#111827";
const DEFAULT_BACKGROUND_OPACITY = 75;
const MIN_BACKGROUND_OPACITY = 60;
const THEMES = {
  minimal: "极简主义",
  aurora: "极光玻璃",
  clay: "黏土质感",
  dark: "深色模式",
  gradients: "Gradients 渐变",
  glow: "发光",
  natural: "Natural 自然",
  utility: "实用优先",
  y2k: "Y2K",
  pointer: "鼠标追踪",
  accessible: "无障碍设计",
  biophilic: "亲生物设计",
};
const DEFAULT_THEME = "biophilic";
const THEME_ORDER = Object.keys(THEMES);
let pendingConfirmAction = null;

const accountForm = document.querySelector("#account-form");
const accountInput = document.querySelector("#account-input");
const accountInputCheck = document.querySelector("#account-input-check");
const accountSearch = document.querySelector("#account-search");
const accountList = document.querySelector("#account-list");
const accountModal = document.querySelector("#account-modal");
const confirmModal = document.querySelector("#confirm-modal");
const confirmTitle = document.querySelector("#confirm-title");
const confirmMessage = document.querySelector("#confirm-message");
const addAccountButton = document.querySelector("#add-account-button");
const clearAccountsButton = document.querySelector("#clear-accounts-button");
const clearStorageButton = document.querySelector("#clear-storage-button");
const clearCacheButton = document.querySelector("#clear-cache-button");
const confirmClearButton = document.querySelector("#confirm-clear-button");
const exportAccountsButton = document.querySelector("#export-accounts-button");
const importAccountsButton = document.querySelector("#import-accounts-button");
const importAccountsFile = document.querySelector("#import-accounts-file");
const fetchButton = document.querySelector("#fetch-button");
const sortSelect = document.querySelector("#sort-select");
const topSelect = document.querySelector("#top-select");
const mailSummary = document.querySelector("#mail-summary");
const statusBox = document.querySelector("#status");
const messageList = document.querySelector("#message-list");
const messageSearch = document.querySelector("#message-search");
const detail = document.querySelector("#message-detail");
const folderTabs = document.querySelectorAll(".folder-tab");
const toggleSourceButton = document.querySelector("#toggle-source-button");
const trustMailCheckbox = document.querySelector("#trust-mail-checkbox");
const toast = document.querySelector("#toast");
const customSelects = document.querySelectorAll("[data-custom-select]");
const themeSwitcher = document.querySelector("#theme-switcher");
const themeToggleButton = document.querySelector("#theme-toggle-button");
const themeMenu = document.querySelector("#theme-menu");
const backgroundOpacityRange = document.querySelector("#background-opacity-range");
const backgroundOpacityValue = document.querySelector("#background-opacity-value");
const adminEntry = document.querySelector("#admin-entry");
const adminEntryButton = document.querySelector("#admin-entry-button");
const adminLoginPopover = document.querySelector("#admin-login-popover");
const adminEntryPassword = document.querySelector("#admin-entry-password");
const adminEntryStatus = document.querySelector("#admin-entry-status");
const API_BASE = window.location.protocol === "file:" ? "http://127.0.0.1:8765" : "";
const ACCOUNT_SORT_VALUES = new Set(["emailAsc", "emailDesc", "createdDesc", "createdAsc"]);
const MAIL_SCOPE_LABELS = {
  all: "全部邮件",
  nonjunk: "非垃圾邮件",
  junk: "仅垃圾邮件",
};
const pointerState = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2,
  frame: 0,
};
const analyticsState = {
  available: true,
  timer: 0,
};

function normalizeTheme(value) {
  return Object.prototype.hasOwnProperty.call(THEMES, value) ? value : DEFAULT_THEME;
}

function applyTheme(theme) {
  const normalized = normalizeTheme(theme);
  document.documentElement.dataset.theme = normalized;
  if (themeToggleButton) {
    const themeName = themeToggleButton.querySelector("strong");
    if (themeName) {
      themeName.textContent = THEMES[normalized];
    }
    themeToggleButton.title = `当前主题：${THEMES[normalized]}`;
    themeToggleButton.setAttribute("aria-label", `更换主题，当前：${THEMES[normalized]}`);
    themeToggleButton.setAttribute("data-current-theme", normalized);
  }
  themeMenu?.querySelectorAll("[data-theme-value]").forEach((item) => {
    const isActive = item.dataset.themeValue === normalized;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-checked", isActive ? "true" : "false");
  });
  return normalized;
}

function loadTheme() {
  return applyTheme(localStorage.getItem(THEME_STORAGE_KEY));
}

function closeThemeMenu() {
  themeSwitcher?.classList.remove("open");
  themeToggleButton?.setAttribute("aria-expanded", "false");
}

function toggleThemeMenu() {
  const isOpen = themeSwitcher?.classList.toggle("open");
  themeToggleButton?.setAttribute("aria-expanded", isOpen ? "true" : "false");
}

function setTheme(theme) {
  const normalized = normalizeTheme(theme);
  localStorage.setItem(THEME_STORAGE_KEY, normalized);
  applyTheme(normalized);
  closeThemeMenu();
  showToast(`已切换为${THEMES[normalized]}`);
}

function buildThemeMenu() {
  if (!themeMenu) {
    return;
  }
  themeMenu.innerHTML = THEME_ORDER.map(
    (theme) => `<button class="theme-menu-item" type="button" role="menuitemradio" aria-checked="false" data-theme-value="${theme}">
      <span>${escapeHtml(THEMES[theme])}</span>
    </button>`
  ).join("");
}

function normalizeHighlightColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : DEFAULT_HIGHLIGHT_COLOR;
}

function applyHighlightColor(value) {
  const color = normalizeHighlightColor(value);
  document.documentElement.style.setProperty("--email-highlight", color);
  return color;
}

function loadHighlightColor() {
  return applyHighlightColor(localStorage.getItem(HIGHLIGHT_COLOR_STORAGE_KEY));
}

function setHighlightColor(value) {
  const color = applyHighlightColor(value);
  localStorage.setItem(HIGHLIGHT_COLOR_STORAGE_KEY, color);
}

function normalizeBackgroundOpacity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return DEFAULT_BACKGROUND_OPACITY;
  }
  return Math.max(MIN_BACKGROUND_OPACITY, Math.min(100, Math.round(number)));
}

function applyBackgroundOpacity(value) {
  const opacity = normalizeBackgroundOpacity(value);
  const ratio = opacity / 100;
  // 这里的“透明度”按用户感知理解为“背景透出强度”：
  // 提高数值时同时降低整页遮罩、主面板和卡片的实色占比，确保能真正看到主题背景纹理。
  const coverAlpha = Math.max(0.04, Math.min(0.58, 0.58 - ratio * 0.5));
  const panelAlpha = Math.max(0.34, Math.min(0.9, 0.9 - ratio * 0.48));
  const cardAlpha = Math.max(0.44, Math.min(0.92, 0.92 - ratio * 0.38));
  document.documentElement.style.setProperty("--bg-opacity", String(ratio));
  document.documentElement.style.setProperty("--bg-layer-opacity", String(ratio));
  document.documentElement.style.setProperty("--bg-cover-opacity", coverAlpha.toFixed(2));
  document.documentElement.style.setProperty("--panel-alpha", `${Math.round(panelAlpha * 100)}%`);
  document.documentElement.style.setProperty("--card-alpha", `${Math.round(cardAlpha * 100)}%`);
  if (backgroundOpacityRange) {
    backgroundOpacityRange.value = String(opacity);
  }
  if (backgroundOpacityValue) {
    backgroundOpacityValue.textContent = `${opacity}%`;
  }
  return opacity;
}

function loadBackgroundOpacity() {
  return applyBackgroundOpacity(localStorage.getItem(BACKGROUND_OPACITY_STORAGE_KEY));
}

function setBackgroundOpacity(value) {
  const opacity = applyBackgroundOpacity(value);
  localStorage.setItem(BACKGROUND_OPACITY_STORAGE_KEY, String(opacity));
}

function updatePointerPosition(event) {
  pointerState.x = event.clientX;
  pointerState.y = event.clientY;
  if (pointerState.frame) {
    return;
  }
  pointerState.frame = window.requestAnimationFrame(() => {
    document.documentElement.style.setProperty("--pointer-x", `${pointerState.x}px`);
    document.documentElement.style.setProperty("--pointer-y", `${pointerState.y}px`);
    pointerState.frame = 0;
  });
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.accounts = Array.isArray(saved.accounts) ? saved.accounts.map(normalizeSavedAccount) : [];
    state.messages = [];
    state.selectedAccountId = state.accounts[0]?.id || null;
    state.selectedMessageKey = null;
    state.filter = "all";
    state.mailScope = "nonjunk";
    state.accountSort = "createdDesc";
    state.visibleByAccount = {};
    state.messageSearch = "";
    state.accounts.forEach((account) => {
      account.status = account.status || "idle";
      account.source = account.source || "";
      account.error = account.error || "";
      account.errorDetails = account.errorDetails || "";
      account.count = Number(account.count || 0);
      account.hasMore = false;
      account.nextLink = "";
      account.nextLinkTop = 0;
      account.lastReadAt = account.lastReadAt || "";
      account.createdAt = account.createdAt || account.lastReadAt || "";
    });
    sortSelect.value = state.accountSort;
    topSelect.value = "10";
    if (messageSearch) {
      messageSearch.value = "";
    }
    syncCustomSelect(sortSelect);
    syncCustomSelect(topSelect);
    saveState();
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  const payload = {
    accounts: state.accounts.map(serializeAccountForStorage),
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function normalizeSavedAccount(account) {
  return {
    id: account.id || createId("account"),
    email: account.email || getEmailFromLine(account.raw || ""),
    raw: account.raw || "",
    status: "idle",
    source: "",
    error: "",
    errorDetails: "",
    count: 0,
    hasMore: false,
    nextLink: "",
    nextLinkTop: 0,
    lastReadAt: account.lastReadAt || "",
    createdAt: account.createdAt || account.lastReadAt || new Date().toISOString(),
  };
}

function serializeAccountForStorage(account) {
  return {
    id: account.id,
    email: account.email,
    raw: account.raw,
    lastReadAt: account.lastReadAt || "",
    createdAt: account.createdAt || "",
  };
}

function resetAccountRuntimeState(account) {
  account.status = "idle";
  account.error = "";
  account.errorDetails = "";
  account.count = 0;
  account.hasMore = false;
  account.nextLink = "";
  account.nextLinkTop = 0;
}

function clearMessageCache() {
  state.messages = [];
  state.selectedMessageKey = null;
  state.messageSearch = "";
  if (messageSearch) {
    messageSearch.value = "";
  }
  state.accounts.forEach(resetAccountRuntimeState);
  saveState();
  setStatus("邮件缓存已清空，邮箱列表已保留。");
  showToast("已清空邮件缓存");
  render();
}

function showInitialCacheNotice() {
  if (!state.accounts.length || state.messages.length) {
    return;
  }
  const readableTime = state.accounts
    .map((account) => account.lastReadAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  setStatus(
    readableTime
      ? `已加载 ${state.accounts.length} 个本地邮箱。为保护令牌环境，本地只保存邮箱列表；上次读取时间 ${formatDate(readableTime)}，邮件内容需手动重新读取。`
      : `已加载 ${state.accounts.length} 个本地邮箱。当前不保存邮件缓存，点击“获取邮件”读取最新邮件。`,
    "info"
  );
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
  topSelect.value = "10";
  syncCustomSelect(sortSelect);
  syncCustomSelect(topSelect);
  folderTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.filter === "all"));
  setStatus("本地邮箱数据已清空");
  showToast("已清空本地邮箱");
  render();
}

function deleteAccount(accountId) {
  const account = state.accounts.find((item) => item.id === accountId);
  if (!account) {
    return;
  }

  state.accounts = state.accounts.filter((item) => item.id !== accountId);
  state.messages = state.messages.filter((message) => message.accountId !== accountId);
  delete state.visibleByAccount[accountId];

  if (state.selectedAccountId === accountId) {
    state.selectedAccountId = state.accounts[0]?.id || null;
    state.selectedMessageKey = null;
  } else if (state.selectedMessageKey) {
    const selectedStillExists = state.messages.some((message) => message.key === state.selectedMessageKey);
    if (!selectedStillExists) {
      state.selectedMessageKey = null;
    }
  }

  saveState();
  setStatus(`已删除 ${account.email}`);
  showToast("邮箱已删除");
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

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "0";
  }
  return new Intl.NumberFormat("zh-CN", {
    notation: number >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(number);
}

function domainFromEmail(email) {
  const value = String(email || "").trim().toLowerCase();
  if (!value.includes("@")) {
    return "unknown";
  }
  return value.split("@").pop() || "unknown";
}

function countDomainsFromAccounts(accounts) {
  return accounts.reduce((result, account) => {
    const domain = domainFromEmail(account.email);
    result[domain] = (result[domain] || 0) + 1;
    return result;
  }, {});
}

function updateAnalyticsWidget(stats) {
  // 前台不再展示统计数字，但仍保留这个入口，避免统计接口返回影响主流程。
  analyticsState.enabled = stats?.enabled !== false;
}

async function sendAnalyticsPing(kind = "heartbeat") {
  if (!analyticsState.available) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/analytics/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ kind }),
    });
    const data = await response.json();
    updateAnalyticsWidget(data.stats);
  } catch {
    // 统计失败不能影响主流程，保持静默即可。
  }
}

async function sendAnalyticsEvent(payload) {
  if (!analyticsState.available) {
    return;
  }
  try {
    const response = await fetch(`${API_BASE}/api/analytics/event`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    updateAnalyticsWidget(data.stats);
  } catch {
    // 统计接口只是辅助观察，不应该打断导入或读取邮件。
  }
}

function startAnalytics() {
  if (!analyticsState.available) {
    return;
  }
  sendAnalyticsPing("visit");
  window.clearInterval(analyticsState.timer);
  analyticsState.timer = window.setInterval(() => {
    if (!document.hidden) {
      sendAnalyticsPing("heartbeat");
    }
  }, 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      sendAnalyticsPing("heartbeat");
    }
  });
}

function setAdminEntryStatus(message, type = "") {
  if (!adminEntryStatus) {
    return;
  }
  adminEntryStatus.textContent = message || "";
  adminEntryStatus.className = type;
}

function openAdminPopover() {
  if (!adminLoginPopover) {
    return;
  }
  adminLoginPopover.hidden = false;
  adminEntry?.classList.add("open");
  adminEntryButton?.setAttribute("aria-expanded", "true");
  setAdminEntryStatus("");
  window.setTimeout(() => adminEntryPassword?.focus(), 40);
}

function closeAdminPopover() {
  if (!adminLoginPopover) {
    return;
  }
  adminLoginPopover.hidden = true;
  adminEntry?.classList.remove("open");
  adminEntryButton?.setAttribute("aria-expanded", "false");
  setAdminEntryStatus("");
}

function toggleAdminPopover() {
  if (!adminLoginPopover || adminLoginPopover.hidden) {
    openAdminPopover();
  } else {
    closeAdminPopover();
  }
}

function openAdminPopoverFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("admin") !== "login") {
    return;
  }
  openAdminPopover();
  params.delete("admin");
  const nextQuery = params.toString();
  const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", nextUrl);
}

async function loginAdminFromPopover(event) {
  event.preventDefault();
  const password = adminEntryPassword?.value || "";
  if (!password) {
    setAdminEntryStatus("请输入密码", "error");
    adminEntryPassword?.focus();
    return;
  }
  setAdminEntryStatus("验证中...");
  try {
    const response = await fetch(`${API_BASE}/api/admin/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "管理员密码不正确");
    }
    adminEntryPassword.value = "";
    setAdminEntryStatus("验证通过，正在进入...");
    window.location.href = `${API_BASE}/admin`;
  } catch (error) {
    setAdminEntryStatus(error.message || "验证失败", "error");
  }
}

function getEmailFromLine(line) {
  return line.split("----")[0]?.trim() || "";
}

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

function validateAccountLine(line) {
  const parts = String(line || "").split("----").map((part) => part.trim());
  if (parts.length !== 4) {
    return { valid: false, reason: `需要 4 段，当前 ${parts.length} 段` };
  }
  const [email, , third, fourth] = parts;
  if (!email) {
    return { valid: false, reason: "邮箱为空" };
  }
  if (!email.includes("@")) {
    return { valid: false, reason: "邮箱格式异常" };
  }
  const thirdIsClientId = isUuidLike(third);
  const fourthIsClientId = isUuidLike(fourth);
  if (thirdIsClientId === fourthIsClientId) {
    return { valid: false, reason: "无法识别 client_id 位置" };
  }
  const refreshToken = thirdIsClientId ? fourth : third;
  if (!refreshToken || refreshToken.length < 20) {
    return { valid: false, reason: "refresh_token 过短或为空" };
  }
  return { valid: true, email };
}

function analyzeAccountInput() {
  const lines = accountInput.value.split(/\r?\n/);
  const result = {
    total: 0,
    valid: 0,
    duplicate: 0,
    invalid: 0,
    errors: [],
  };
  const seenEmails = new Set();
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    result.total += 1;
    const validation = validateAccountLine(line);
    if (!validation.valid) {
      result.invalid += 1;
      result.errors.push(`第 ${index + 1} 行：${validation.reason}`);
      return;
    }
    const emailKey = validation.email.toLowerCase();
    const exists = state.accounts.some((account) => account.email.toLowerCase() === emailKey);
    if (seenEmails.has(emailKey) || exists) {
      result.duplicate += 1;
      result.errors.push(`第 ${index + 1} 行：邮箱重复`);
      return;
    }
    seenEmails.add(emailKey);
    result.valid += 1;
  });
  return result;
}

function renderAccountInputCheck() {
  if (!accountInputCheck) {
    return;
  }
  const result = analyzeAccountInput();
  if (!result.total) {
    accountInputCheck.className = "account-input-check idle";
    accountInputCheck.innerHTML = "<span>等待输入邮箱令牌</span>";
    return;
  }
  const isAllValid = result.valid === result.total;
  accountInputCheck.className = `account-input-check ${isAllValid ? "ok" : "warning"}`;
  const errorHtml = result.errors.length
    ? `<small>${result.errors.slice(0, 3).map(escapeHtml).join("；")}${result.errors.length > 3 ? "；..." : ""}</small>`
    : "";
  accountInputCheck.innerHTML = `
    <span>检测到 <strong>${result.total}</strong> 个令牌，格式正确 <strong>${result.valid}</strong> 个，错误 <strong>${result.invalid}</strong> 个，重复 <strong>${result.duplicate}</strong> 个</span>
    ${errorHtml}
  `;
}

function setStatus(message, type = "") {
  if (type === "loading" && message) {
    statusBox.innerHTML = `<span class="status-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
  } else {
    statusBox.textContent = message || "";
  }
  statusBox.className = `status ${message ? "visible" : ""} ${type}`.trim();
}

function setStatusError(message, fallback = "读取失败") {
  const { summary, details } = splitErrorMessage(message, fallback);
  if (details) {
    statusBox.innerHTML = `
      <span>${escapeHtml(summary)}</span>
      <details>
        <summary>查看技术详情</summary>
        <pre>${escapeHtml(details)}</pre>
      </details>
    `;
  } else {
    statusBox.textContent = summary;
  }
  statusBox.className = "status visible error";
}

function splitErrorMessage(message, fallback = "读取失败") {
  const lines = String(message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const summary = lines.shift() || fallback;
  return { summary, details: lines.join("\n") };
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
    item.disabled = option.disabled;
    item.classList.toggle("disabled", option.disabled);
    item.setAttribute("aria-disabled", String(option.disabled));
    item.addEventListener("click", () => {
      if (option.disabled) {
        return;
      }
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

function closeAccountMenus() {
  document.querySelectorAll(".account-card.menu-open").forEach((card) => {
    card.classList.remove("menu-open");
    card.querySelector("[data-account-menu-toggle]")?.setAttribute("aria-expanded", "false");
  });
}

function toggleAccountMenu(toggle) {
  const card = toggle.closest(".account-card");
  if (!card) {
    return;
  }
  const willOpen = !card.classList.contains("menu-open");
  closeAccountMenus();
  card.classList.toggle("menu-open", willOpen);
  toggle.setAttribute("aria-expanded", String(willOpen));
}

function openAccountModal() {
  accountModal.classList.add("open");
  accountModal.setAttribute("aria-hidden", "false");
  renderAccountInputCheck();
  window.setTimeout(() => accountInput.focus(), 30);
}

function closeAccountModal() {
  accountModal.classList.remove("open");
  accountModal.setAttribute("aria-hidden", "true");
}

function openConfirmModal(options = {}) {
  pendingConfirmAction = typeof options.onConfirm === "function" ? options.onConfirm : clearSavedState;
  confirmTitle.textContent = options.title || "清空本地邮箱？";
  confirmMessage.textContent =
    options.message || "这会删除本机浏览器保存的邮箱、邮件缓存和当前选择状态。此操作不会影响 Outlook 邮箱本身。";
  confirmClearButton.textContent = options.confirmText || "确认清空";
  confirmModal.classList.add("open");
  confirmModal.setAttribute("aria-hidden", "false");
}

function closeConfirmModal() {
  confirmModal.classList.remove("open");
  confirmModal.setAttribute("aria-hidden", "true");
  pendingConfirmAction = null;
}

async function addAccountsFromInput() {
  const result = addAccountsFromLines(accountInput.value.split(/\r?\n/));

  accountInput.value = "";
  closeAccountModal();
  render();
  showAddAccountsResult(result);
}

function addAccountsFromLines(rawLines) {
  const lines = rawLines.map((line) => String(line || "").trim());
  const addedAccounts = [];
  const failures = [];
  for (const [index, line] of lines.entries()) {
    if (!line) {
      continue;
    }
    const validation = validateAccountLine(line);
    if (!validation.valid) {
      failures.push({ line, reason: `第 ${index + 1} 行：${validation.reason}` });
      continue;
    }
    const email = validation.email;
    const exists = state.accounts.some((account) => account.email.toLowerCase() === email.toLowerCase());
    if (exists) {
      failures.push({ line, reason: `第 ${index + 1} 行：邮箱已存在` });
      continue;
    }
    const account = {
      id: createId("account"),
      email,
      raw: line,
      status: "idle",
      source: "",
      error: "",
      errorDetails: "",
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

  if (addedAccounts.length) {
    const firstAdded = addedAccounts[0];
    state.selectedAccountId = firstAdded.id;
    state.selectedMessageKey = null;
    saveState();
  }

  return { addedAccounts, failures };
}

function showAddAccountsResult(result) {
  const { addedAccounts, failures } = result;
  const summary = `成功加入 ${addedAccounts.length} 个，失败 ${failures.length} 个`;
  if (addedAccounts.length) {
    sendAnalyticsEvent({
      type: "import",
      count: addedAccounts.length,
      domains: countDomainsFromAccounts(addedAccounts),
    });
  }
  if (!addedAccounts.length) {
    const detail = failures.slice(0, 3).map((item) => `${item.reason}: ${item.line}`).join("\n");
    setStatus(`${summary}${detail ? `\n${detail}` : ""}`, "warning");
    showToast(summary);
    return;
  }

  const failureDetail = failures.slice(0, 3).map((item) => `${item.reason}: ${item.line}`).join("\n");
  setStatus(`${summary}。点击“获取邮件”读取选中邮箱。${failureDetail ? `\n${failureDetail}` : ""}`, failures.length ? "warning" : "");
  showToast(summary);
  render();
}

function parseImportedAccountLines(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed) ? parsed : parsed.accounts;
    if (Array.isArray(accounts)) {
      return accounts.map((item) => (typeof item === "string" ? item : item?.raw || "")).filter(Boolean);
    }
  } catch {
    // 不是 JSON 时按纯文本处理，一行一个邮箱令牌，便于跨浏览器备份。
  }
  return raw.split(/\r?\n/);
}

async function importAccountsFromFile(file) {
  if (!file) {
    return;
  }
  try {
    const text = await file.text();
    const result = addAccountsFromLines(parseImportedAccountLines(text));
    render();
    showAddAccountsResult(result);
  } catch (error) {
    setStatusError(error.message, "导入失败");
  } finally {
    importAccountsFile.value = "";
  }
}

function exportAccounts() {
  if (!state.accounts.length) {
    setStatus("当前没有可导出的邮箱令牌。", "warning");
    showToast("没有可导出的邮箱");
    return;
  }
  const text = state.accounts.map((account) => account.raw).join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `outlook-lite-邮箱列表-${date}.txt`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`已导出 ${state.accounts.length} 个邮箱令牌。`);
  showToast("邮箱列表已导出");
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
  account.errorDetails = "";
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
    detailLoaded: hasFullMessageBody(message),
    detailLoading: false,
    detailError: "",
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
  sendAnalyticsEvent({
    type: "fetch_success",
    domain: domainFromEmail(account.email),
    source: data.source,
    scope: state.mailScope,
    message_count: incomingMessages.length,
  });
}

async function refreshAccount(account, options = {}) {
  try {
    await fetchAccount(account, options);
    if (!options.silent) {
      setStatus(`${account.email} 读取完成，共 ${account.count} 封`);
    }
  } catch (error) {
    account.status = "error";
    const { summary, details } = splitErrorMessage(error.message);
    account.error = summary;
    account.errorDetails = details;
    if (!options.silent) {
      setStatusError(error.message);
    }
    sendAnalyticsEvent({
      type: "fetch_failed",
      domain: domainFromEmail(account.email),
      reason: summary || error.message,
    });
  } finally {
    saveState();
    render();
  }
}

function hasFullMessageBody(message) {
  return Boolean(message?.body_html || message?.body_text || message?.body);
}

function shouldLoadMessageDetail(message) {
  return Boolean(message && !message.detailLoading && !message.detailLoaded && !hasFullMessageBody(message));
}

async function loadMessageDetail(message) {
  if (!shouldLoadMessageDetail(message)) {
    return;
  }

  const account = state.accounts.find((item) => item.id === message.accountId);
  if (!account) {
    return;
  }

  message.detailLoading = true;
  message.detailError = "";
  saveState();
  renderDetail();

  try {
    const response = await fetch(`${API_BASE}/api/message-detail`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account: account.raw,
        message_id: message.id,
        source: message.source || "",
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(`${data.error || "正文读取失败"}${data.details ? `\n${data.details}` : ""}`);
    }

    const index = state.messages.findIndex((item) => item.key === message.key);
    if (index < 0) {
      return;
    }
    const current = state.messages[index];
    const detailMessage = data.message || {};
    const merged = {
      ...current,
      ...detailMessage,
      key: current.key,
      accountId: current.accountId,
      accountEmail: current.accountEmail,
      source: current.source || data.source,
      folder: current.folder || detailMessage.folder || "inbox",
      folderName: current.folderName || detailMessage.folder_name || "",
      detailLoaded: true,
      detailLoading: false,
      detailError: "",
    };
    merged.verificationCode = extractVerificationCode(merged);
    state.messages[index] = merged;
    saveState();
    render();
  } catch (error) {
    const index = state.messages.findIndex((item) => item.key === message.key);
    if (index >= 0) {
      state.messages[index].detailLoading = false;
      state.messages[index].detailError = error.message;
    }
    saveState();
    renderDetail();
    setStatusError(error.message, "正文读取失败");
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
  if (account.status === "error") {
    setStatusError([account.error, account.errorDetails].filter(Boolean).join("\n"));
  } else {
    setStatus(`${account.email} 读取完成，共 ${account.count} 封`);
  }
  saveState();
}

async function refreshSelectedFolderFromTab(tab) {
  const nextFilter = tab.dataset.filter || "all";
  const nextScope = nextFilter === "junk" ? "junk" : "nonjunk";
  state.filter = nextFilter;
  state.mailScope = nextScope;
  folderTabs.forEach((item) => item.classList.toggle("active", item === tab));
  saveState();
  render();

  if (nextFilter === "unread") {
    const messages = getVisibleMessages();
    state.selectedMessageKey = messages[0]?.key || null;
    saveState();
    render();
    setStatus(`已切换到未读，本地筛选 ${messages.length} 封`);
    return;
  }

  const account = state.accounts.find((item) => item.id === state.selectedAccountId);
  if (!account) {
    setStatus("请先添加邮箱", "warning");
    return;
  }
  if (account.status === "loading") {
    return;
  }

  state.visibleByAccount[account.id] = Number(topSelect.value || 10);
  const label = nextScope === "junk" ? "垃圾邮件" : "收件箱";
  setStatus(`正在读取 ${account.email} 的${label}...`, "loading");
  await refreshAccount(account, { silent: true, top: state.visibleByAccount[account.id] });
  if (account.status === "error") {
    setStatusError([account.error, account.errorDetails].filter(Boolean).join("\n"));
  } else {
    setStatus(`${account.email} ${label}读取完成，共 ${account.count} 封`);
  }

  const messages = getVisibleMessages();
  state.selectedMessageKey = messages[0]?.key || null;
  saveState();
  render();
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
  messages = filterMessagesByQuery(messages);
  if (state.selectedAccountId) {
    const visibleCount = state.visibleByAccount[state.selectedAccountId] || 10;
    return messages.slice(0, visibleCount);
  }
  return messages;
}

function getAllFilteredMessagesForSelectedAccount() {
  if (!state.selectedAccountId) {
    return filterMessagesByQuery(filterMessagesByScope(state.messages));
  }
  let messages = state.messages.filter((message) => message.accountId === state.selectedAccountId);
  messages = filterMessagesByScope(messages);
  if (state.filter === "unread") {
    messages = messages.filter((message) => !message.is_read);
  }
  return filterMessagesByQuery(messages);
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

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function filterMessagesByQuery(messages) {
  const query = normalizeSearchText(state.messageSearch);
  if (!query) {
    return messages;
  }
  return messages.filter((message) => {
    const haystack = normalizeSearchText([
      message.subject,
      message.from_name,
      message.from_address,
      message.accountEmail,
      message.verificationCode,
      message.preview,
      message.body_text,
      message.body,
    ].filter(Boolean).join("\n"));
    return haystack.includes(query);
  });
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
        <article class="account-card ${selected}" role="button" tabindex="0" data-account-id="${escapeHtml(account.id)}">
          <span class="check-box"></span>
          <span class="account-main">
            <strong>${escapeHtml(account.email)}</strong>
            <span><span class="pill">Outlook</span>${escapeHtml(statusLabel)}</span>
            ${account.error ? `<small>${escapeHtml(account.error.split("\n")[0])}</small>` : ""}
          </span>
          <span class="account-side">
            <span class="account-actions">
              <button class="mini-action primary" type="button" data-account-action="copy-email" title="复制邮箱名" aria-label="复制邮箱名">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v10H8z"></path><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
              </button>
              <button class="mini-action more" type="button" data-account-menu-toggle aria-haspopup="menu" aria-expanded="false" title="更多操作" aria-label="更多操作">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5h.01"></path><path d="M12 12h.01"></path><path d="M12 19h.01"></path></svg>
              </button>
            </span>
            <span class="account-menu" role="menu">
              <button type="button" role="menuitem" data-account-action="copy-token">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 7a4 4 0 1 0-3.1 3.9L4 18.8V22h3.2l1.1-1.1V18h2.9l1.2-1.2v-2.9l2.7-2.7A4 4 0 0 0 15 7z"></path><path d="M16.5 7.5h.01"></path></svg>
                <span>复制令牌</span>
              </button>
              <button class="danger" type="button" role="menuitem" data-account-action="delete-account">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v5"></path><path d="M14 11v5"></path></svg>
                <span>删除邮箱</span>
              </button>
            </span>
            <span class="account-count">${account.status === "loading" ? "..." : account.count}</span>
          </span>
        </article>
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
    ? `<span class="summary-title-row"><span class="summary-title">邮件</span><span class="summary-count">已显示 ${messages.length}/${total} 封</span></span><button class="summary-current-email" type="button" data-copy-current-email="${escapeHtml(selectedAccount.email)}" title="点击复制邮箱"><span class="summary-current-label">当前邮箱：</span><span class="summary-current-value">${escapeHtml(selectedAccount.email)}</span><svg class="summary-copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v10H8z"></path><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`
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

  const shouldShowLoadMore = Boolean(
    state.selectedAccountId &&
      selectedAccount?.hasMore &&
      (state.filter !== "junk" || messages.length >= Number(topSelect.value || 10))
  );
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
    .join("") + (shouldShowLoadMore ? `
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

  if (!hasFullMessageBody(message)) {
    if (message.detailLoading) {
      return `<div class="detail-content detail-loading"><div class="loader"></div><strong>正文加载中</strong><span>正在按需读取这封邮件的完整内容...</span></div>`;
    }
    if (message.detailError) {
      return `<div class="detail-content detail-error"><strong>正文读取失败</strong><span>${escapeHtml(message.detailError)}</span></div>`;
    }
    return `<div class="detail-content rich-text">${renderMarkdownLite(message.preview || "点击邮件后会按需读取完整正文。")}</div>`;
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
    closeThemeMenu();
    closeAccountMenus();
    closeAdminPopover();
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
  if (!event.target.closest("#theme-switcher")) {
    closeThemeMenu();
  }
  if (!event.target.closest(".account-card")) {
    closeAccountMenus();
  }
  if (!event.target.closest("#admin-entry")) {
    closeAdminPopover();
  }
});

document.addEventListener("pointermove", updatePointerPosition, { passive: true });

clearAccountsButton.addEventListener("click", () => {
  accountInput.value = "";
  renderAccountInputCheck();
  accountInput.focus();
});

accountInput.addEventListener("input", renderAccountInputCheck);

accountSearch.addEventListener("input", renderAccounts);

messageSearch?.addEventListener("input", () => {
  state.messageSearch = messageSearch.value;
  const messages = getVisibleMessages();
  state.selectedMessageKey = messages[0]?.key || null;
  renderMessages();
  renderDetail();
});

sortSelect.addEventListener("change", () => {
  state.accountSort = normalizeAccountSort(sortSelect.value);
  sortSelect.value = state.accountSort;
  syncCustomSelect(sortSelect);
  saveState();
  renderAccounts();
});

topSelect.addEventListener("change", () => {
  if (topSelect.value !== "10") {
    topSelect.value = "10";
  }
  syncCustomSelect(topSelect);
});

fetchButton.addEventListener("click", fetchSelectedAccounts);

clearCacheButton?.addEventListener("click", () => {
  openConfirmModal({
    title: "清空邮件缓存？",
    message: "这只会清空当前页面内存里的邮件列表和正文，不会删除本地保存的邮箱令牌。刷新页面本来也不会保留邮件正文。",
    confirmText: "只清空缓存",
    onConfirm: clearMessageCache,
  });
});

exportAccountsButton?.addEventListener("click", exportAccounts);

importAccountsButton?.addEventListener("click", () => {
  importAccountsFile?.click();
});

importAccountsFile?.addEventListener("change", () => {
  importAccountsFromFile(importAccountsFile.files?.[0]);
});

accountList.addEventListener("click", async (event) => {
  const menuToggle = event.target.closest("[data-account-menu-toggle]");
  if (menuToggle) {
    event.preventDefault();
    event.stopPropagation();
    toggleAccountMenu(menuToggle);
    return;
  }

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
      closeAccountMenus();
      return;
    }
    if (action.dataset.accountAction === "copy-token") {
      await copyText(account.raw, "已复制邮箱令牌");
      closeAccountMenus();
      return;
    }
    if (action.dataset.accountAction === "delete-account") {
      closeAccountMenus();
      openConfirmModal({
        title: "删除这个邮箱？",
        message: `这会删除本机浏览器保存的 ${account.email}、它的邮件缓存和当前选择状态。此操作不会影响 Outlook 邮箱本身。`,
        confirmText: "确认删除",
        onConfirm: () => deleteAccount(account.id),
      });
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
  closeAccountMenus();
  state.selectedAccountId = account.id;
  state.visibleByAccount[account.id] = Number(topSelect.value || 10);
  saveState();
  render();
  setStatus(`正在读取 ${account.email}...`, "loading");
  await refreshAccount(account, { silent: true, top: state.visibleByAccount[account.id] });
  if (account.status === "error") {
    setStatusError([account.error, account.errorDetails].filter(Boolean).join("\n"));
  } else {
    setStatus(`${account.email} 读取完成，共 ${account.count} 封`);
  }
});

accountList.addEventListener("keydown", async (event) => {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }
  if (event.target.closest("[data-account-action], [data-account-menu-toggle]")) {
    return;
  }
  event.preventDefault();
  const card = event.target.closest(".account-card");
  card?.click();
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
      setStatusError([account.error, account.errorDetails].filter(Boolean).join("\n"));
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
  await loadMessageDetail(getSelectedMessage());
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
    await refreshSelectedFolderFromTab(tab);
  });
});

toggleSourceButton.addEventListener("click", () => {
  state.showSource = !state.showSource;
  toggleSourceButton.textContent = state.showSource ? "隐藏邮件源" : "显示邮件源";
  renderDetail();
});

trustMailCheckbox?.addEventListener("change", () => {
  detail.classList.toggle("trusted", trustMailCheckbox.checked);
  renderDetail();
});

clearStorageButton.addEventListener("click", () => {
  openConfirmModal();
});

confirmClearButton.addEventListener("click", () => {
  const action = pendingConfirmAction || clearSavedState;
  closeConfirmModal();
  action();
});

themeToggleButton?.addEventListener("click", toggleThemeMenu);

themeMenu?.addEventListener("click", (event) => {
  const item = event.target.closest("[data-theme-value]");
  if (!item) {
    return;
  }
  setTheme(item.dataset.themeValue);
});

backgroundOpacityRange?.addEventListener("input", () => {
  setBackgroundOpacity(backgroundOpacityRange.value);
});

backgroundOpacityRange?.addEventListener("change", () => {
  showToast(`背景透明度 ${backgroundOpacityRange.value}%`);
});

adminEntryButton?.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleAdminPopover();
});

adminLoginPopover?.addEventListener("submit", loginAdminFromPopover);

customSelects.forEach(buildCustomSelect);
buildThemeMenu();
loadHighlightColor();
loadTheme();
loadBackgroundOpacity();
loadSavedState();
render();
showInitialCacheNotice();
startAnalytics();
openAdminPopoverFromQuery();
