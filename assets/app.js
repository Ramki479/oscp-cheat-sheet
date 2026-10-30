import {
  PINNED_VARIABLES, STATUS_ORDER, PRIORITY_ORDER,
  applyVariables, buildAliasIndex, filterBlocks, searchAll,
  serviceGroups, serviceCounts, findStep, isValidToken
} from "./engine.js";

const state = {
  pages: [], services: [], groups: {}, variables: [], meta: null,
  aliasIndex: {},
  values: {},
  custom: [],
  remember: false,
  route: { type: "service", id: "smb" },
  filters: { priority: "all", status: "all" },
  query: "",
  showAllVars: false,
  pendingStep: null
};

const $ = (sel, root = document) => root.querySelector(sel);

/* ------------------------------------------------------------------ */
/* tiny DOM helpers                                                    */
/* ------------------------------------------------------------------ */

function el(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function renderInline(text) {
  const frag = document.createDocumentFragment();
  const src = String(text ?? "");
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\n]+\*|\[[^\]]+\]\((?:https?:\/\/[^)\s]+|#\/p\/[A-Za-z0-9_-]+)\))/g;
  let last = 0, m;
  while ((m = re.exec(src))) {
    if (m.index > last) frag.append(document.createTextNode(src.slice(last, m.index)));
    const tok = m[0];
    if (tok.startsWith("**")) frag.append(el("strong", { text: tok.slice(2, -2) }));
    else if (tok.startsWith("`")) frag.append(el("code", { text: tok.slice(1, -1) }));
    else if (tok.startsWith("[")) {
      const mm = tok.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+|#\/p\/[A-Za-z0-9_-]+)\)$/);
      const attrs = { href: mm[2], text: mm[1] };
      if (!mm[2].startsWith("#/")) {
        attrs.target = "_blank";
        attrs.rel = "noopener noreferrer";
      }
      frag.append(el("a", attrs));
    } else frag.append(el("em", { text: tok.slice(1, -1) }));
    last = m.index + tok.length;
  }
  if (last < src.length) frag.append(document.createTextNode(src.slice(last)));
  return frag;
}

function inlineNode(text, { live = false } = {}) {
  const span = el("span");
  span.append(renderInline(text));
  if (live) {
    span.dataset.template = text;
    span.dataset.inline = "1";
  }
  return span;
}

function toast(message) {
  const t = $("#toast");
  t.textContent = message;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

async function boot() {
  try {
    const [cmd, vars, meta] = await Promise.all([
      fetch("data/commands.json").then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }),
      fetch("data/variables.json").then(r => r.json()),
      fetch("data/meta.json").then(r => r.json())
    ]);
    state.pages = cmd.pages;
    state.services = cmd.services;
    state.groups = cmd.groups;
    state.variables = vars.variables;
    state.meta = meta;
  } catch (err) {
    $("#content").replaceChildren(el("div", { class: "empty" },
      el("h2", { text: "Could not load the command data" }),
      el("p", { class: "muted", text: String(err) }),
      el("p", { class: "muted", html: "" }, "Serve this folder over HTTP (for example ", el("code", { text: "python3 -m http.server 8000" }), "). Opening index.html with file:// blocks fetch().")
    ));
    return;
  }

  state.aliasIndex = buildAliasIndex(state.variables);
  loadPersisted();
  state.route = parseHash();
  if (!routeExists(state.route)) state.route = { type: "service", id: "smb" };

  renderPinned();
  renderSidebar();
  renderMain();
  renderNetStatus();
  syncTopbarHeight();
  bindGlobal();
  registerSW();
  window.addEventListener("hashchange", () => {
    state.route = parseHash();
    // Keep an unknown in-app route from silently rendering the first page.
    if (!routeExists(state.route)) state.route = { type: "service", id: "smb" };
    state.query = "";
    $("#search").value = "";
    renderMain();
    closeNav();
  });
  window.addEventListener("online", renderNetStatus);
  window.addEventListener("offline", renderNetStatus);
}

/* ------------------------------------------------------------------ */
/* routing                                                             */
/* ------------------------------------------------------------------ */

function parseHash() {
  const h = location.hash.replace(/^#/, "");
  if (h.startsWith("/p/")) return { type: "page", id: decodeURIComponent(h.slice(3)) };
  if (h.startsWith("/s/")) return { type: "service", id: decodeURIComponent(h.slice(3)) };
  return { type: "service", id: "smb" };
}

function routeExists(route) {
  if (route.type === "page") return state.pages.some(p => p.slug === route.id);
  return state.services.some(s => s.id === route.id);
}

function go(route) {
  const hash = route.type === "page" ? `#/p/${route.id}` : `#/s/${route.id}`;
  if (location.hash === hash) {
    state.route = route;
    renderMain();
  } else location.hash = hash;
}

function serviceLabel(id) {
  return (state.services.find(s => s.id === id) || { label: id }).label;
}

function pageBySlug(slug) {
  return state.pages.find(p => p.slug === slug);
}

function shortTitle(title) {
  return title.split(" — ")[0];
}

// Titles come from the source export and a few still carry Markdown link or
// code syntax. Render them as plain text so the heading stays readable.
function plainTitle(title) {
  return String(title)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

/* ------------------------------------------------------------------ */
/* header                                                              */
/* ------------------------------------------------------------------ */

const IPV4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${IPV4_OCTET}(?:\\.${IPV4_OCTET}){3}$`);
const DOMAIN_RE = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function isValidationToken(token) {
  return token === "DOMAIN" || /_IP$/.test(token);
}

function sanitizeIPv4(raw) {
  return raw.replace(/[^\d.]/g, "").slice(0, 64);
}

function sanitizeDomain(raw) {
  return raw.trim().replace(/\s+/g, "").replace(/[^A-Za-z0-9.-]/g, "").toLowerCase().slice(0, 253);
}

function validateField(token, raw) {
  if (/_IP$/.test(token)) {
    const value = sanitizeIPv4(raw);
    return {
      value,
      valid: value === "" || IPV4_RE.test(value),
      message: "Use a valid IPv4 address, e.g. 10.10.10.10"
    };
  }
  if (token === "DOMAIN") {
    const value = sanitizeDomain(raw);
    return {
      value,
      valid: value === "" || DOMAIN_RE.test(value),
      message: "Use a valid domain, e.g. corp.local"
    };
  }
  return { value: raw, valid: true, message: "" };
}

function bindFieldValidation(input, error, token, onValue) {
  const apply = () => {
    const result = validateField(token, input.value);
    if (input.value !== result.value) input.value = result.value;
    input.classList.toggle("invalid", !result.valid);
    input.setAttribute("aria-invalid", result.valid ? "false" : "true");
    if (result.valid) {
      error.hidden = true;
      error.textContent = "";
      input.removeAttribute("aria-describedby");
    } else {
      error.hidden = false;
      error.textContent = result.message;
      input.setAttribute("aria-describedby", error.id);
    }
    onValue(result.valid ? result.value : "");
  };
  input.addEventListener("input", apply);
  input.addEventListener("blur", apply);
  return apply;
}

function renderPinned() {
  const wrap = $("#pinnedInputs");
  wrap.replaceChildren();
  for (const token of PINNED_VARIABLES) {
    const meta = state.variables.find(v => v.token === token) || { token, label: token, example: "" };
    const input = el("input", {
      id: `pin-${token}`,
      type: "text",
      inputmode: /_IP$/.test(token) ? "decimal" : "text",
      autocomplete: "off",
      spellcheck: "false",
      placeholder: meta.example || "",
      "aria-label": meta.label
    });
    input.value = state.values[token] || "";
    const error = el("span", { class: "pin-error", id: `pin-error-${token}`, hidden: "hidden" });
    bindFieldValidation(input, error, meta.token, value => {
      state.values[token] = value;
      afterValueChange(meta);
    });
    wrap.append(el("label", { class: "pin", for: `pin-${token}` },
      el("span", { class: "pin-label", text: meta.label }),
      input,
      error
    ));
  }
}

function syncPinned() {
  for (const token of PINNED_VARIABLES) {
    const input = $(`#pin-${token}`);
    if (!input || document.activeElement === input) continue;
    input.value = state.values[token] || "";
    input.classList.remove("invalid");
    input.setAttribute("aria-invalid", "false");
    const error = input.closest(".pin")?.querySelector(".pin-error");
    if (error) { error.hidden = true; error.textContent = ""; }
    input.removeAttribute("aria-describedby");
  }
}

function renderNetStatus() {
  const pill = $("#netStatus");
  const text = $("#netText");
  if (!navigator.onLine) {
    pill.className = "net-pill offline";
    text.textContent = "Offline";
    pill.title = "You are offline. If the page loaded, cached data is being used.";
  } else if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
    pill.className = "net-pill ready";
    text.textContent = "Offline ready";
    pill.title = "App and command data are cached for offline use.";
  } else {
    pill.className = "net-pill";
    text.textContent = "Online";
    pill.title = "Online";
  }
}

function syncTopbarHeight() {
  const topbar = $(".topbar");
  if (!topbar) return;
  const headerHeight = Math.ceil(topbar.getBoundingClientRect().height);
  if (headerHeight > 0) document.documentElement.style.setProperty("--topbar-h", `${headerHeight}px`);
}

/* ------------------------------------------------------------------ */
/* sidebar                                                             */
/* ------------------------------------------------------------------ */

function renderSidebar() {
  const side = $("#sidebar");
  side.replaceChildren();
  for (const [groupId, label] of Object.entries(state.groups)) {
    const pages = state.pages.filter(p => p.group === groupId);
    if (!pages.length) continue;
    const group = el("section", { class: "nav-group" },
      el("h2", { class: "nav-title", text: label })
    );
    for (const page of pages) {
      const active = state.route.type === "page" && state.route.id === page.slug;
      const btn = el("button", {
        class: "nav-item" + (active ? " active" : ""),
        type: "button",
        dataset: { slug: page.slug },
        onclick: () => go({ type: "page", id: page.slug })
      },
        el("span", { class: "nav-icon", "aria-hidden": "true", text: page.icon || "•" }),
        el("span", { class: "nav-text", text: shortTitle(page.title) }),
        el("span", { class: "nav-count", text: String(page.stepCount) })
      );
      group.append(btn);
    }
    side.append(group);
  }
  side.append(el("p", { class: "nav-foot" },
    `${state.pages.length} pages · ${state.pages.reduce((n, p) => n + p.stepCount, 0)} steps`
  ));
}

/* ------------------------------------------------------------------ */
/* main render                                                         */
/* ------------------------------------------------------------------ */

function renderServiceBar() {
  const bar = $("#serviceBar");
  const activeId = state.route.type === "service" ? state.route.id : null;
  bar.replaceChildren(
    el("span", { class: "service-bar-label", text: "Services" }),
    serviceChips(activeId)
  );
}

function renderMain() {
  renderServiceBar();
  const main = $("#content");
  main.replaceChildren();

  if (state.query.trim().length >= 2) {
    renderSearch(main);
  } else if (state.route.type === "service") {
    renderService(main, state.route.id);
  } else {
    renderPage(main, state.route.id);
  }

  main.append(renderFooter());
  renderSidebarActive();
  updateAllRendered();
  syncTopbarHeight();
  if (state.pendingStep) {
    const target = document.getElementById(state.pendingStep);
    state.pendingStep = null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.classList.add("flash");
      setTimeout(() => target.classList.remove("flash"), 1600);
    }
  }
}

function renderSidebarActive() {
  const activeSlug = state.route.type === "page" ? state.route.id : null;
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.slug === activeSlug);
  });
}

function serviceChips(activeId) {
  const counts = serviceCounts(state.pages);
  const preferred = ["nmap", "smb", "ftp", "dns", "http", "ssh", "nfs", "smtp", "snmp", "mysql", "mssql", "rdp", "winrm", "ipmi", "ad", "impacket", "netexec", "bloodhound", "kerberos", "passwords", "linux", "windows", "privesc", "shells", "pivoting", "exploitation"];
  // Preferred services first, then every remaining tagged service so no view
  // is reachable only by typing its hash.
  const ids = [
    ...preferred.filter(id => counts[id]),
    ...Object.keys(counts).filter(id => !preferred.includes(id))
      .sort((a, b) => serviceLabel(a).localeCompare(serviceLabel(b)))
  ];
  const row = el("div", { class: "chips", role: "navigation", "aria-label": "Services" });
  row.append(el("button", {
    class: "chip" + (!activeId ? " active" : ""),
    type: "button",
    onclick: () => go({ type: "page", id: state.pages[0].slug })
  }, "Reference pages"));
  for (const id of ids) {
    const label = serviceLabel(id);
    row.append(el("button", {
      class: "chip" + (activeId === id ? " active" : ""),
      type: "button",
      title: `${label} — ${counts[id]} page${counts[id] === 1 ? "" : "s"}`,
      onclick: () => go({ type: "service", id })
    }, label, el("span", { class: "chip-count", text: String(counts[id]) })));
  }
  return row;
}

function filterBar(total, visible, hasSteps = true) {
  if (!hasSteps) return null;
  const bar = el("div", { class: "filterbar" });
  const select = (value, options, onChange, label) => {
    const s = el("select", { "aria-label": label, onchange: e => { onChange(e.target.value); renderMain(); } });
    for (const o of options) {
      s.append(el("option", { value: o.value, selected: o.value === value ? "selected" : null }, o.label));
    }
    return s;
  };
  bar.append(el("span", { class: "filter-label", text: "Filter" }));
  bar.append(select(state.filters.priority, [{ value: "all", label: "All priorities" }, ...PRIORITY_ORDER.map(p => ({ value: p, label: p }))], v => state.filters.priority = v, "Priority"));
  bar.append(select(state.filters.status, [{ value: "all", label: "All statuses" }, ...STATUS_ORDER.map(s => ({ value: s, label: s }))], v => state.filters.status = v, "Status"));
  if (state.filters.priority !== "all" || state.filters.status !== "all") {
    bar.append(el("button", {
      class: "link-btn", type: "button",
      onclick: () => { state.filters = { priority: "all", status: "all" }; renderMain(); }
    }, "Reset"));
  }
  bar.append(el("span", { class: "filter-count", text: `${visible} of ${total} steps` }));
  return bar;
}

function matchesFilters(step) {
  return (state.filters.priority === "all" || step.priority === state.filters.priority) &&
    (state.filters.status === "all" || step.status === state.filters.status);
}

function pageHeader(page, { serviceView = false } = {}) {
  return el("header", { class: "page-head" },
    el("div", { class: "page-kicker", text: serviceView ? "Service view" : page.groupLabel }),
    el("h1", { id: "pageTitle" },
      el("span", { class: "page-icon", "aria-hidden": "true", text: page.icon || "📄" }),
      page.title
    ),
    page.description ? el("p", { class: "page-desc" }, page.description) : null,
    el("div", { class: "page-meta" },
      el("span", { text: `${page.stepCount} steps` }),
      el("span", { text: `${page.commandCount} commands` }),
      el("span", { class: "muted", text: page.slug })
    )
  );
}

function renderPage(main, slug) {
  const page = pageBySlug(slug) || state.pages[0];
  main.append(pageHeader(page));

  // Render with the active filters first so the chip row and the sections on
  // screen never disagree about which sections still exist.
  const rendered = page.sections.map(section => ({
    section,
    blocks: filterBlocks(section.blocks, { priority: state.filters.priority, status: state.filters.status }, page.title)
  })).filter(x => x.blocks.some(b => b.type !== "table-ref"));

  const all = page.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));
  const visible = all.filter(matchesFilters);
  const bar = filterBar(all.length, visible.length, all.length > 0);

  // Command pages jump between numbered command sections. Prose/reference pages
  // (and workflow pages with mixed content) expose every section.
  const useAllSections = page.group === "workflow" || page.stepCount === 0;
  const navEntries = rendered
    .filter(x => useAllSections || x.blocks.some(b => b.type === "step"))
    .map(x => ({ id: x.section.id, label: x.section.rawTitle || x.section.title }));
  const nav = sectionNav(navEntries);
  if (nav) main.append(nav);

  if (bar) main.append(bar);

  for (const { section, blocks } of rendered) {
    const sec = el("section", { class: "section", id: section.id },
      el("h2", { class: "section-title" }, section.title)
    );
    for (const block of blocks) sec.append(renderBlock(block, { page }));
    main.append(sec);
  }

  if (!visible.length && page.stepCount && (state.filters.priority !== "all" || state.filters.status !== "all")) {
    main.append(el("div", { class: "empty" }, el("p", { text: "No steps match these filters." })));
  }
}

function renderService(main, serviceId) {
  const label = serviceLabel(serviceId);
  const groups = serviceGroups(state.pages, serviceId);
  const totalSteps = groups.reduce((n, g) => n + g.groups.reduce((m, x) => m + x.steps.length, 0), 0);
  const pageCount = groups.length;

  main.append(el("header", { class: "page-head" },
    el("div", { class: "page-kicker", text: "Service view" }),
    el("h1", { id: "pageTitle" }, el("span", { class: "page-icon", "aria-hidden": "true", text: "⌘" }), `${label} commands`),
    el("p", { class: "page-desc", text: `Every step tagged ${label}, across the handbook. Fill the header inputs once and copy any command.` }),
    el("div", { class: "page-meta" },
      el("span", { text: `${totalSteps} steps` }),
      el("span", { text: `${pageCount} source page${pageCount === 1 ? "" : "s"}` })
    )
  ));

  const filteredGroups = groups.map(({ page, groups: pageGroups }) => ({
    page,
    groups: pageGroups
      .map(({ section, steps }) => ({ section, steps: steps.filter(matchesFilters) }))
      .filter(g => g.steps.length)
  })).filter(g => g.groups.length);

  const visible = filteredGroups.reduce((n, g) => n + g.groups.reduce((m, x) => m + x.steps.length, 0), 0);
  const navEntries = filteredGroups.flatMap(({ page, groups: pageGroups }) =>
    pageGroups.map(g => ({
      id: g.section.id,
      label: g.section.rawTitle || g.section.title,
      pageLabel: shortTitle(page.title)
    }))
  );
  const nav = sectionNav(navEntries);
  if (nav) main.append(nav);

  const bar = filterBar(totalSteps, visible, totalSteps > 0);
  if (bar) main.append(bar);

  if (!totalSteps) {
    main.append(el("div", { class: "empty" }, el("p", { text: `No steps are tagged ${label}.` })));
    return;
  }
  if (!filteredGroups.length) {
    main.append(el("div", { class: "empty" }, el("p", { text: "No steps match these filters." })));
    return;
  }

  for (const { page, groups: pageGroups } of filteredGroups) {
    const pageBlock = el("section", { class: "service-page" });
    pageBlock.append(el("div", { class: "service-page-head" },
      el("button", { class: "page-link", type: "button", onclick: () => go({ type: "page", id: page.slug }) },
        el("span", { text: page.icon || "📄" }), shortTitle(page.title), " →")
    ));
    for (const { section, steps } of pageGroups) {
      pageBlock.append(el("h2", { class: "section-title small", id: section.id }, section.title));
      for (const step of steps) pageBlock.append(renderStep(step, { page, showPage: false }));
    }
    main.append(pageBlock);
  }
}

function scrollToSection(id, chip) {
  const target = document.getElementById(id);
  if (!target) return;
  const topbar = document.querySelector(".topbar");
  const offset = (topbar?.getBoundingClientRect().height || 0) + 14;
  const top = Math.max(0, target.getBoundingClientRect().top + window.scrollY - offset);
  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });

  const heading = target.classList.contains("section-title")
    ? target
    : target.querySelector(".section-title") || target;
  heading.classList.remove("target-flash");
  void heading.offsetWidth;
  heading.classList.add("target-flash");
  clearTimeout(heading._flashTimer);
  heading._flashTimer = setTimeout(() => heading.classList.remove("target-flash"), 1900);

  document.querySelectorAll(".section-chip.active").forEach(c => {
    c.classList.remove("active");
    c.removeAttribute("aria-current");
  });
  if (chip) {
    chip.classList.add("active");
    chip.setAttribute("aria-current", "location");
  }
}

function sectionNav(entries) {
  if (!entries.length) return null;
  const counts = {};
  for (const e of entries) counts[e.label] = (counts[e.label] || 0) + 1;

  const nav = el("nav", { class: "section-nav", "aria-label": "Quick navigation" });
  for (const e of entries) {
    const label = counts[e.label] > 1 && e.pageLabel ? `${e.pageLabel} · ${e.label}` : e.label;
    const chip = el("button", {
      class: "section-chip", type: "button", title: `Jump to ${label}`,
      onclick: () => scrollToSection(e.id, chip)
    }, label);
    chip.dataset.target = e.id;
    nav.append(chip);
  }
  return nav;
}

/* ------------------------------------------------------------------ */
/* blocks                                                              */
/* ------------------------------------------------------------------ */

function renderBlock(block, ctx) {
  switch (block.type) {
    case "step": return renderStep(block, ctx);
    case "p": return el("p", { class: "prose" }, inlineNode(block.text, { live: true }));
    case "quote": return el("blockquote", { class: "quote" }, inlineNode(block.text, { live: true }));
    case "ul": return el("ul", { class: "prose-list" }, block.items.map(i => el("li", {}, inlineNode(i, { live: true }))));
    case "ol": return el("ol", { class: "prose-list" }, block.items.map(i => el("li", {}, inlineNode(i, { live: true }))));
    case "table": return renderTable(block);
    case "code": return codeBlock(block.lang, block.code);
    case "output": return outputBlock(block);
    case "h3": return el("h3", { class: "subhead" }, inlineNode(block.text));
    default: return el("div");
  }
}

function renderTable(table) {
  const tbl = el("div", { class: "table-wrap" }, el("table"));
  const t = tbl.firstChild;
  if (table.headers?.length) {
    t.append(el("thead", {}, el("tr", {}, table.headers.map(h => el("th", {}, inlineNode(h, { live: true }))))));
  }
  t.append(el("tbody", {}, table.rows.map(row =>
    el("tr", {}, row.map(cell => el("td", {}, inlineNode(cell, { live: true })))))));
  return tbl;
}

function codeBlock(lang, code) {
  const codeEl = el("code", { dataset: { template: code } });
  codeEl.textContent = applyVariables(code, state.values, state.aliasIndex).text;
  const missing = el("div", { class: "missing", hidden: "hidden" });
  const copy = el("button", { class: "copy-btn", type: "button", onclick: () => copyText(code, missing) }, "Copy");
  return el("div", { class: "code-block" },
    el("div", { class: "code-head" },
      el("span", { class: "lang", text: lang || "bash" }),
      copy
    ),
    el("pre", {}, codeEl),
    missing
  );
}

// Captured terminal output is evidence, not a command: no copy button, no
// variable substitution, so the source's real values stay visible.
function outputBlock(block) {
  return el("div", { class: "output-block" },
    el("div", { class: "output-head" },
      el("span", { class: "lang", text: "output" }),
      el("span", { class: "output-src", text: "source excerpt" })
    ),
    el("pre", {}, el("code", { text: block.code }))
  );
}

async function copyText(template, missingEl) {
  const { text, missing } = applyVariables(template, state.values, state.aliasIndex);
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el("textarea", { class: "sr-only" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (missing.length) {
    toast(`Copied with unresolved: ${missing.join(", ")}`);
    if (missingEl) showMissing(missingEl, missing);
  } else {
    toast("Copied");
  }
}

function showMissing(node, missing) {
  if (!missing.length) { node.hidden = true; node.textContent = ""; return; }
  node.hidden = false;
  node.replaceChildren(el("span", { class: "missing-label", text: "Missing values: " }),
    ...missing.map(t => el("code", { text: `<${t}>` })));
}

function priorityClass(p) {
  return p === "Core" ? "p-core" : p === "Conditional" ? "p-cond" : "p-adv";
}
function statusClass(s) {
  if (s === "Lab Tested") return "s-lab";
  if (s === "Simulated") return "s-sim";
  if (s === "Syntax Checked") return "s-syntax";
  if (s === "Environment Dependent") return "s-env";
  return "s-doc";
}

function renderStep(step, ctx) {
  const fields = [
    ["purpose", "Purpose"], ["prereqs", "Prerequisites"],
    ["lookFor", "Look for"], ["success", "Success path"], ["failure", "Failure path"],
    ["decision", "Decision"], ["next", "Next"],
    ["mistake", "Common mistake"], ["evidence", "Evidence"]
  ].filter(([k]) => step.fields?.[k]);

  const article = el("article", { class: "step", id: step.id, dataset: { step: step.id } });
  const isBranch = /^(Alternative|Fallback|Optional)\b/i.test(step.title);
  const runOnLabel = step.runOn === "unspecified" ? "Context varies" : step.runOn;

  const head = el("header", { class: "step-head" },
    el("span", { class: "step-num", text: step.n }),
    el("h3", { class: "step-title", text: plainTitle(step.title) }),
    el("div", { class: "badges" },
      el("span", { class: `badge ${priorityClass(step.priority)}`, title: step.priorityRaw || step.priority, text: step.priority }),
      isBranch ? el("span", { class: "badge b-alt", text: "Alternative" }) : null,
      el("span", { class: "badge b-run", text: runOnLabel }),
      el("span", { class: `badge ${statusClass(step.status)}`, title: step.statusRaw || step.status, text: step.status })
    )
  );
  if (ctx?.page && ctx.showPage !== false && ctx.page.slug !== state.route.id) {
    head.append(el("button", {
      class: "page-link small", type: "button",
      onclick: () => go({ type: "page", id: ctx.page.slug })
    }, shortTitle(ctx.page.title), " →"));
  }
  article.append(head);

  if (step.commands?.length) {
    const list = el("div", { class: "code-list" });
    for (const c of step.commands) list.append(codeBlock(c.lang, c.code));
    article.append(list);
  }

  for (const o of step.outputs || []) article.append(outputBlock(o));

  if (fields.length) {
    const dl = el("dl", { class: "fields" });
    for (const [key, label] of fields) {
      dl.append(el("dt", { text: label }));
      dl.append(el("dd", {}, inlineNode(step.fields[key], { live: true })));
    }
    article.append(dl);
  }

  if (step.notes) article.append(el("div", { class: "step-notes" }, inlineNode(step.notes, { live: true })));
  for (const t of step.tables || []) article.append(renderTable(t));
  return article;
}

/* ------------------------------------------------------------------ */
/* search                                                              */
/* ------------------------------------------------------------------ */

function renderSearch(main) {
  const hits = searchAll(state.pages, state.query);
  main.append(el("header", { class: "page-head" },
    el("div", { class: "page-kicker", text: "Search" }),
    el("h1", {}, `Results for “${state.query}”`),
    el("p", { class: "page-desc", text: `${hits.length} matching step${hits.length === 1 ? "" : "s"} across ${state.pages.length} pages.` })
  ));

  if (!hits.length) {
    main.append(el("div", { class: "empty" }, el("p", { text: "No matches. Try a tool name, port, or error message." })));
    return;
  }

  const list = el("div", { class: "search-results" });
  for (const { page, section, step } of hits) {
    const first = step.commands?.[0];
    const rendered = first ? applyVariables(first.code, state.values, state.aliasIndex).text : "";
    const preview = rendered.split("\n").slice(0, 2).join("\n");
    list.append(el("button", {
      class: "search-hit", type: "button",
      onclick: () => {
        state.query = "";
        $("#search").value = "";
        state.pendingStep = step.id;
        go({ type: "page", id: page.slug });
        if (location.hash === `#/p/${page.slug}`) renderMain();
      }
    },
      el("div", { class: "hit-top" },
        el("span", { class: "hit-page", text: `${page.icon || "📄"} ${shortTitle(page.title)}` }),
        el("span", { class: "badge " + priorityClass(step.priority), text: step.priority }),
        el("span", { class: "badge " + statusClass(step.status), text: step.status })
      ),
      el("div", { class: "hit-title", text: `${step.n} · ${step.title}` }),
      preview ? el("pre", { class: "hit-code" }, preview) : null,
      el("div", { class: "hit-section", text: section.title })
    ));
  }
  main.append(list);
}

/* ------------------------------------------------------------------ */
/* variables + drawer                                                  */
/* ------------------------------------------------------------------ */

function usedTokens() {
  const tokens = new Set();
  const steps = state.route.type === "service"
    ? serviceGroups(state.pages, state.route.id).flatMap(g => g.groups.flatMap(x => x.steps))
    : (pageBySlug(state.route.id)?.sections.flatMap(s => s.blocks.filter(b => b.type === "step")) || []);
  for (const step of steps) {
    for (const c of step.commands || []) {
      for (const m of c.code.matchAll(/<([A-Z][A-Z0-9_]+)>/g)) tokens.add(m[1]);
    }
    for (const f of Object.values(step.fields || {})) {
      for (const m of String(f || "").matchAll(/<([A-Z][A-Z0-9_]+)>/g)) tokens.add(m[1]);
    }
  }
  return tokens;
}

function allVariables() {
  const map = new Map(state.variables.map(v => [v.token, v]));
  for (const c of state.custom) if (!map.has(c.token)) map.set(c.token, c);
  return [...map.values()];
}

function afterValueChange(meta) {
  updateAllRendered();
  if (state.remember && !meta.sensitive) savePersisted();
}

function updateAllRendered() {
  for (const node of document.querySelectorAll("[data-template]")) {
    const { text, missing } = applyVariables(node.dataset.template, state.values, state.aliasIndex);
    const block = node.closest(".code-block");
    if (node.dataset.inline === "1") node.replaceChildren(renderInline(text));
    else node.textContent = text;
    if (block) {
      const m = block.querySelector(".missing");
      if (m) showMissing(m, missing);
    }
  }
}

function openDrawer() {
  state.showAllVars = false;
  renderDrawer();
  const drawer = $("#drawer");
  drawer.hidden = false;
  $("#drawerScrim").hidden = false;
  document.body.classList.add("drawer-open");
  $("#closeInputs").focus();
}

function closeDrawer() {
  $("#drawer").hidden = true;
  $("#drawerScrim").hidden = true;
  document.body.classList.remove("drawer-open");
  $("#openInputs").focus();
}

function renderDrawer() {
  const body = $("#drawerBody");
  body.replaceChildren();
  const used = usedTokens();
  const vars = allVariables();
  const grouped = { used: [], credentials: [], network: [], paths: [], other: [], custom: [] };

  for (const v of vars) {
    if (used.has(v.token)) grouped.used.push(v);
    else if (v.custom || v.group === "custom") grouped.custom.push(v);
    else (grouped[v.group] || grouped.other).push(v);
  }

  const labels = { used: "Used on this view", credentials: "Credentials", network: "Network", paths: "Files & paths", other: "Other", custom: "Custom" };

  for (const [key, list] of Object.entries(grouped)) {
    if (!list.length) continue;
    if (!state.showAllVars && key !== "used" && key !== "custom") continue;
    body.append(el("h3", { class: "drawer-group", text: labels[key] }));
    for (const v of list) body.append(variableRow(v));
  }

  if (!used.size) body.append(el("p", { class: "muted small", text: "Open a page or service to see the variables it uses." }));

  const showAll = el("input", { type: "checkbox", id: "showAll" });
  showAll.checked = state.showAllVars;
  showAll.addEventListener("change", () => { state.showAllVars = showAll.checked; renderDrawer(); });
  body.append(el("label", { class: "check-row", for: "showAll" }, showAll, el("span", { text: "Show every variable" })));

  const remember = el("input", { type: "checkbox", id: "remember" });
  remember.checked = state.remember;
  remember.addEventListener("change", () => {
    state.remember = remember.checked;
    localStorage.setItem(LS.remember, state.remember ? "1" : "0");
    if (state.remember) savePersisted();
    else clearValues();
    renderDrawer();
  });
  body.append(el("label", { class: "check-row", for: "remember" }, remember,
    el("span", {}, "Remember non-secret values on this device",
      el("em", { class: "muted small block", text: "Passwords and hashes are never stored." }))));

  // add custom
  const nameInput = el("input", { type: "text", placeholder: "NEW_VARIABLE", "aria-label": "New variable name", spellcheck: "false" });
  const addBtn = el("button", { class: "btn small", type: "button" }, "Add");
  const add = () => {
    const token = nameInput.value.trim().toUpperCase();
    if (!isValidToken(token)) { toast("Use A-Z, 0-9 and _ (start with a letter)"); return; }
    if (allVariables().some(v => v.token === token)) { toast("That variable exists"); return; }
    state.custom.push({ token, label: token, group: "custom", custom: true, example: "" });
    state.values[token] = "";
    nameInput.value = "";
    saveCustom();
    renderDrawer();
    updateAllRendered();
  };
  addBtn.addEventListener("click", add);
  nameInput.addEventListener("keydown", e => { if (e.key === "Enter") add(); });
  body.append(el("h3", { class: "drawer-group", text: "Add a variable" }),
    el("div", { class: "add-row" }, nameInput, addBtn));

  const clear = el("button", { class: "btn ghost danger", type: "button" }, "Clear all values");
  clear.addEventListener("click", () => {
    state.values = {};
    clearValues();
    syncPinned();
    updateAllRendered();
    renderDrawer();
    toast("Values cleared");
  });
  body.append(el("div", { class: "drawer-actions" }, clear));

  body.append(el("p", { class: "drawer-note" },
    "Commands are templates. Values are substituted only in this tab; nothing is sent anywhere. Copy uses the rendered command."));
}

function variableRow(v) {
  const input = el("input", {
    type: v.sensitive ? "password" : "text",
    inputmode: /_IP$/.test(v.token) ? "decimal" : "text",
    autocomplete: "off",
    spellcheck: "false",
    placeholder: v.sensitive ? "••••••••" : (v.example || ""),
    "aria-label": `${v.label} (${v.token})`
  });
  input.value = state.values[v.token] || "";
  const error = el("span", { class: "var-error", id: `var-error-${v.token}`, hidden: "hidden" });
  const onValue = value => {
    state.values[v.token] = value;
    if (PINNED_VARIABLES.includes(v.token)) syncPinned();
    afterValueChange(v);
  };
  if (isValidationToken(v.token)) {
    bindFieldValidation(input, error, v.token, onValue);
  } else {
    input.addEventListener("input", () => onValue(input.value));
  }
  const row = el("div", { class: "var-row" },
    el("label", { class: "var-label" },
      el("span", { class: "var-name", text: v.label || v.token }),
      el("code", { class: "var-token", text: `<${v.token}>` })
    ),
    el("div", { class: "var-input" }, input, error)
  );
  if (v.custom) {
    row.append(el("button", {
      class: "icon-btn tiny", type: "button", title: `Remove ${v.token}`, "aria-label": `Remove ${v.token}`,
      onclick: () => {
        state.custom = state.custom.filter(c => c.token !== v.token);
        delete state.values[v.token];
        saveCustom();
        renderDrawer();
        updateAllRendered();
      }
    }, "✕"));
  }
  return row;
}

/* ------------------------------------------------------------------ */
/* persistence (non-secret only)                                       */
/* ------------------------------------------------------------------ */

const LS = { remember: "oscp.remember", values: "oscp.values", custom: "oscp.custom" };

function loadPersisted() {
  try {
    state.remember = localStorage.getItem(LS.remember) === "1";
    state.custom = JSON.parse(localStorage.getItem(LS.custom) || "[]");
    if (state.remember) {
      const saved = JSON.parse(localStorage.getItem(LS.values) || "{}");
      for (const v of state.variables) {
        if (!v.sensitive && saved[v.token]) state.values[v.token] = saved[v.token];
      }
      for (const c of state.custom) if (saved[c.token]) state.values[c.token] = saved[c.token];
    }
  } catch { /* corrupt storage: ignore */ }
}

function savePersisted() {
  try {
    localStorage.setItem(LS.remember, "1");
    const out = {};
    for (const v of [...state.variables, ...state.custom]) {
      if (!v.sensitive && state.values[v.token]) out[v.token] = state.values[v.token];
    }
    localStorage.setItem(LS.values, JSON.stringify(out));
  } catch { /* storage disabled */ }
}

function clearValues() {
  try { localStorage.removeItem(LS.values); } catch { /* ignore */ }
}

function saveCustom() {
  try { localStorage.setItem(LS.custom, JSON.stringify(state.custom)); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* global events                                                       */
/* ------------------------------------------------------------------ */

function bindGlobal() {
  $("#openInputs").addEventListener("click", openDrawer);
  $("#closeInputs").addEventListener("click", closeDrawer);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  $("#drawer").addEventListener("click", e => { if (e.target.id === "drawer") closeDrawer(); });
  $("#referenceBtn").addEventListener("click", () => {
    if (state.pages[0]) go({ type: "page", id: state.pages[0].slug });
  });
  window.addEventListener("resize", syncTopbarHeight);
  if ("ResizeObserver" in window) {
    const observer = new ResizeObserver(syncTopbarHeight);
    observer.observe($(".topbar"));
  }

  let timer;
  $("#search").addEventListener("input", e => {
    clearTimeout(timer);
    const value = e.target.value;
    timer = setTimeout(() => {
      state.query = value;
      renderMain();
    }, 140);
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") {
      if (!$("#drawer").hidden) closeDrawer();
      else if (state.query) { state.query = ""; $("#search").value = ""; renderMain(); }
    }
    if (e.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault();
      $("#search").focus();
    }
  });

  $("#navToggle").addEventListener("click", () => {
    const sidebar = $("#sidebar");
    const open = sidebar.classList.toggle("open");
    $("#scrim").hidden = !open;
    $("#navToggle").setAttribute("aria-expanded", String(open));
  });
  $("#scrim").addEventListener("click", closeNav);

  navigator.serviceWorker?.addEventListener("controllerchange", renderNetStatus);
}

function closeNav() {
  $("#sidebar").classList.remove("open");
  $("#scrim").hidden = true;
  $("#navToggle").setAttribute("aria-expanded", "false");
}

function renderFooter() {
  const meta = state.meta;
  return el("footer", { class: "foot" },
    el("p", {},
      `${state.pages.length} pages · ${state.pages.reduce((n, p) => n + p.stepCount, 0)} steps · `,
      `${state.pages.reduce((n, p) => n + p.commandCount, 0)} commands`,
      meta ? ` · ${meta.warnings.length} extraction notes` : ""
    ),
    el("p", { class: "muted small" },
      "Status labels: Syntax Checked means flags were verified against the installed tool. No command is marked Lab Tested — nothing here was run against a live exam target."
    )
  );
}

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  if (!(location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) return;
  try {
    await navigator.serviceWorker.register("sw.js", { scope: "./" });
    renderNetStatus();
  } catch (e) {
    console.warn("Service worker registration failed", e);
  }
}

boot();
