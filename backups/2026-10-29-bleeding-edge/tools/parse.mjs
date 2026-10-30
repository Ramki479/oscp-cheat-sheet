#!/usr/bin/env node
/**
 * Parse the frozen Notion export (content/raw/*.html) into data/commands.json,
 * data/variables.json and data/meta.json.
 *
 * Notion's MCP fetch returns hybrid HTML: <b>, <code>, <br />, <table>.
 * Tokens such as <TARGET_IP> must survive tag stripping, so they are masked
 * first and restored last.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = path.resolve(import.meta.dirname, "..");
const RAW = path.join(ROOT, "content", "raw");
const OUT = path.join(ROOT, "data");
const STEP_ID_FILE = path.join(ROOT, "content", "step-ids.json");
const STEP_IDS = fs.existsSync(STEP_ID_FILE)
  ? JSON.parse(fs.readFileSync(STEP_ID_FILE, "utf8")).ids || {}
  : {};

const STATUSES = ["Syntax Checked", "Lab Tested", "Documented — Untested", "Version-Dependent"];
const PRIORITIES = ["Core", "Conditional", "Advanced"];

const PAGE_META = {
  nmap: { group: "services", icon: "🛰️", tags: ["nmap"] },
  smb: { group: "services", icon: "📁", tags: ["smb"] },
  ftp: { group: "services", icon: "📂", tags: ["ftp"] },
  dns: { group: "services", icon: "🌐", tags: ["dns"] },
  http: { group: "services", icon: "🕸️", tags: ["http"] },
  ssh: { group: "services", icon: "🔑", tags: ["ssh"] },
  "other-services": { group: "services", icon: "🧩", tags: ["services"] },
  "active-directory": { group: "ad", icon: "🏰", tags: ["ad"] },
  bloodhound: { group: "ad", icon: "🐕", tags: ["bloodhound", "ad"] },
  "post-exploitation": { group: "ad", icon: "🔀", tags: ["impacket", "netexec"] },
  passwords: { group: "ad", icon: "🔓", tags: ["passwords"] },
  "linux-privesc": { group: "privesc", icon: "🐧", tags: ["linux", "privesc"] },
  "windows-privesc": { group: "privesc", icon: "🪟", tags: ["windows", "privesc"] },
  "directory-vhost": { group: "enumeration", icon: "🧱", tags: ["http", "fuzzing"] },
  shells: { group: "tradecraft", icon: "🐚", tags: ["shells", "transfer"] },
  tunneling: { group: "tradecraft", icon: "🚇", tags: ["pivoting"] },
  "exploit-research": { group: "tradecraft", icon: "🧪", tags: ["exploitation"] },
  "attack-workflow": { group: "workflow", icon: "🧭", tags: ["workflow"] },
  "machine-notes": { group: "workflow", icon: "📝", tags: ["notes"] },
  "exam-rules": { group: "workflow", icon: "📜", tags: ["exam"] },
  "exam-checklist": { group: "workflow", icon: "✅", tags: ["exam"] },
  "exam-execution": { group: "workflow", icon: "🎯", tags: ["exam"] },
  troubleshooting: { group: "workflow", icon: "🩺", tags: ["troubleshooting"] }
};

const GROUP_LABELS = {
  services: "Services",
  ad: "AD & Post-Exploitation",
  privesc: "Privilege Escalation",
  enumeration: "Enumeration",
  tradecraft: "Tradecraft",
  workflow: "Workflow & Exam"
};

// "Related pages" sections were Notion link collections and are removed globally.
// Links to app.notion.com are also converted to plain text wherever else they occur.
const DROP_LINK_TITLES = [
  "OSCP Attack Workflow — Start Here",
  "OSCP Exam Checklist & Evidence Collection",
  "OSCP Machine Notes — Template",
  "📖 OSCP Command Handbook"
];

function hasDroppedLink(text) {
  return DROP_LINK_TITLES.some(title => String(text).includes(title));
}

function stripNotionLinks(value) {
  if (typeof value === "string") {
    return value
      .replace(/\[([^\]]+)\]\(https?:\/\/app\.notion\.com\/[^)]*\)/g, "$1")
      .replace(/https?:\/\/app\.notion\.com\/[^\s)]*/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([.,;:!?])/g, "$1")
      .trim();
  }
  if (Array.isArray(value)) return value.map(stripNotionLinks);
  if (value && typeof value === "object") {
    for (const key of Object.keys(value)) value[key] = stripNotionLinks(value[key]);
    return value;
  }
  return value;
}

function pruneStaleQuickNav(sections, slug) {
  for (const section of sections) {
    if (section.title !== "Quick navigation") continue;
    // The chip nav already covers every command section. The exported list was a
    // stale duplicate (it still referenced the removed "Related pages" section).
    section.blocks = section.blocks.filter(block => block.type !== "ul");
    if (section.blocks.length) {
      section.title = "Priority & status legend";
      section.rawTitle = section.title;
      section.id = `${slug}-priority-status-legend`;
    }
  }
  return sections.filter(section => section.blocks.length || section.tables?.length);
}

function pruneDroppedLinks(sections) {
  for (const section of sections) {
    section.blocks = section.blocks.filter(block => {
      if (block.type === "p") {
        return !hasDroppedLink(block.text) && !/^[·\s]+$/.test(block.text);
      }
      if (block.type === "ul") {
        block.items = block.items.filter(item =>
          !hasDroppedLink(item) && !/^[·\s]+$/.test(item)
        );
        return block.items.length > 0;
      }
      return true;
    });
  }
  return sections.filter(section => section.blocks.length || section.tables?.length);
}

const SERVICES = [
  ["nmap", "Nmap"], ["smb", "SMB"], ["ftp", "FTP"], ["dns", "DNS"],
  ["http", "HTTP / HTTPS"], ["ssh", "SSH"], ["nfs", "NFS"], ["smtp", "SMTP"],
  ["snmp", "SNMP"], ["mysql", "MySQL"], ["mssql", "MSSQL"], ["rdp", "RDP"],
  ["winrm", "WinRM"], ["ipmi", "IPMI"], ["ad", "Active Directory"],
  ["impacket", "Impacket"], ["netexec", "NetExec"], ["bloodhound", "BloodHound"],
  ["passwords", "Passwords & Hashes"], ["linux", "Linux PrivEsc"],
  ["windows", "Windows PrivEsc"], ["privesc", "PrivEsc"],
  ["shells", "Shells"], ["transfer", "File Transfer"], ["pivoting", "Pivoting"],
  ["exploitation", "Exploitation"], ["fuzzing", "Content Discovery"],
  ["kerberos", "Kerberos"], ["credentials", "Credentials"], ["ipmi", "IPMI"],
  ["node", "Node Inspector"], ["workflow", "Workflow"], ["exam", "Exam"],
  ["notes", "Notes"], ["troubleshooting", "Troubleshooting"]
].filter((v, i, a) => a.findIndex(x => x[0] === v[0]) === i).map(([id, label]) => ({ id, label }));

/* ------------------------------------------------------------------ */
/* inline / block normalisation                                        */
/* ------------------------------------------------------------------ */

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function stripTags(s) {
  return s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
}

function inline(s) {
  let t = s;
  t = t.replace(/<code>([\s\S]*?)<\/code>/g, (_, c) => "`" + c.trim() + "`");
  t = t.replace(/<b>([\s\S]*?)<\/b>/g, (_, c) => "**" + c + "**");
  t = t.replace(/<strong>([\s\S]*?)<\/strong>/g, (_, c) => "**" + c + "**");
  t = t.replace(/<i>([\s\S]*?)<\/i>/g, (_, c) => "*" + c + "*");
  t = t.replace(/<em>([\s\S]*?)<\/em>/g, (_, c) => "*" + c + "*");
  t = t.replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, txt) => `[${txt.trim()}](${href})`);
  t = t.replace(/<br\s*\/?>/g, "\n");
  t = t.replace(/<\/p>/g, "\n\n").replace(/<p[^>]*>/g, "\n");
  t = t.replace(/<mention[^>]*\/>/g, "");
  t = stripTags(t);
  t = decodeEntities(t);
  return t;
}

function parseTable(attrs, inner, warn, restore) {
  const hasHeader = /header-row="true"/.test(attrs);
  const rows = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = rowRe.exec(inner))) {
    const cells = [];
    const cellRe = /<(td|th)([^>]*)>([\s\S]*?)<\/\1>/g;
    let c;
    while ((c = cellRe.exec(m[1]))) {
      cells.push(restore(inline(c[3])).replace(/\s+/g, " ").trim());
    }
    if (cells.length) rows.push(cells);
  }
  if (!rows.length) { warn("empty table"); return null; }
  const headers = hasHeader ? rows.shift() : [];
  return { type: "table", headers, rows };
}

function normalise(raw, warn) {
  const held = [];
  let t = raw;

  // Protect <TOKEN> placeholders before any tag stripping.
  t = t.replace(/<([A-Z][A-Z0-9_]{1,})>/g, (m) => {
    held.push(m);
    return `\u0001${held.length - 1}\u0001`;
  });

  // Tables first (they contain their own markup).
  const tables = [];
  const restore = (s) => s.replace(/\u0001(\d+)\u0001/g, (_, i) => held[Number(i)]);
  t = t.replace(/<table([^>]*)>([\s\S]*?)<\/table>/g, (_, attrs, inner) => {
    const tbl = parseTable(attrs, inner, warn, restore);
    if (!tbl) return "\n";
    tables.push(tbl);
    return `\n\u0002T${tables.length - 1}\u0002\n`;
  });
  t = t.replace(/<colgroup>[\s\S]*?<\/colgroup>/g, "");

  t = t.replace(/<callout[^>]*>/g, "").replace(/<\/callout>/g, "\n");
  t = t.replace(/<columns[^>]*>|<\/columns>|<column[^>]*>|<\/column>/g, "");
  t = inline(t);

  // restore placeholders
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => held[Number(i)]);
  // normalise table markers to their own line
  t = t.replace(/\u0002T(\d+)\u0002/g, (_, i) => `\n@@TABLE:${i}@@\n`);
  t = t.replace(/\n{3,}/g, "\n\n");
  return { text: t, tables };
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const slug = (s) => s.toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);

const oneLine = (s) => (s || "").replace(/\s+/g, " ").trim();

function normStatus(raw, warn, where) {
  const s = oneLine(raw);
  if (!s) return { value: "Documented — Untested", raw: s, warning: true };
  if (STATUSES.includes(s)) return { value: s, raw: s };
  if (/documented?\s*[—-]?\s*untested/i.test(s) || /documentation-based/i.test(s)) {
    warn(`[status] ${where}: "${s}" -> Documented — Untested`);
    return { value: "Documented — Untested", raw: s };
  }
  if (/version-dependent/i.test(s)) return { value: "Version-Dependent", raw: s };
  if (/lab tested/i.test(s)) return { value: "Lab Tested", raw: s };
  if (/syntax checked/i.test(s)) {
    warn(`[status] ${where}: composite "${s.slice(0, 60)}" -> Syntax Checked`);
    return { value: "Syntax Checked", raw: s };
  }
  warn(`[status] ${where}: unknown "${s.slice(0, 60)}" -> Documented — Untested`);
  return { value: "Documented — Untested", raw: s };
}

function normPriority(raw, warn, where) {
  const s = oneLine(raw);
  if (PRIORITIES.includes(s)) return { value: s, raw: s };
  if (/conditional/i.test(s)) return { value: "Conditional", raw: s };
  if (/advanced/i.test(s)) return { value: "Advanced", raw: s };
  if (/core/i.test(s)) {
    if (s !== "Core") warn(`[priority] ${where}: "${s}" -> Core`);
    return { value: "Core", raw: s };
  }
  if (!s) return { value: "Core", raw: "", warning: true };
  warn(`[priority] ${where}: unknown "${s}" -> Core`);
  return { value: "Core", raw: s };
}

function normRunOn(raw) {
  const s = oneLine(raw).toLowerCase();
  if (!s) return "unspecified";
  if (s.includes("pivot") && s.includes("target")) return "either";
  if (s.includes("pivot")) return "pivot";
  if (s.includes("windows") && s.includes("kali")) return "either";
  if (s.includes("windows")) return "windows";
  if (s.includes("target") && (s.includes("kali") || s.includes("linux"))) return "either";
  if (s.includes("target")) return "target";
  if (s.includes("kali") || s.includes("linux") || s.includes("browser")) return "kali";
  if (s.includes("either") || s.includes("both")) return "either";
  return "other";
}

const SINGLE_SERVICE = {
  nmap: "nmap", smb: "smb", ftp: "ftp", dns: "dns", http: "http", ssh: "ssh",
  bloodhound: "bloodhound", passwords: "passwords", "linux-privesc": "linux",
  "windows-privesc": "windows", shells: "shells", tunneling: "pivoting",
  "exploit-research": "exploitation", "directory-vhost": "http", "machine-notes": "notes"
};

function inferService(sectionTitle, stepTitle, code, slug, pageTags) {
  const hay = `${sectionTitle} ${stepTitle} ${code}`;
  if (SINGLE_SERVICE[slug]) return SINGLE_SERVICE[slug];

  if (slug === "other-services") {
    if (/nfs|showmount|mount -t nfs/i.test(hay)) return "nfs";
    if (/smtp|vrfy|rcpt|swaks/i.test(hay)) return "smtp";
    if (/snmp|onesixtyone|community/i.test(hay)) return "snmp";
    if (/mysql|mariadb/i.test(hay)) return "mysql";
    if (/mssql|xp_cmdshell|sqlserver/i.test(hay)) return "mssql";
    if (/winrm|evil-winrm/i.test(hay)) return "winrm";
    if (/rdp|xfreerdp|rdesktop/i.test(hay)) return "rdp";
    if (/ipmi|bmc/i.test(hay)) return "ipmi";
    if (/inspector|9229|node inspect/i.test(hay)) return "node";
    return "services";
  }
  if (slug === "active-directory") {
    return /kerberos|kerberoast|as-rep|getTGT|getST|ticket|spn/i.test(hay) ? "kerberos" : "ad";
  }
  if (slug === "post-exploitation") {
    if (/mssql|xp_cmdshell|sqlserver/i.test(hay)) return "mssql";
    if (/winrm|evil-winrm/i.test(hay)) return "winrm";
    if (/netexec|\bnxc\b/i.test(hay)) return "netexec";
    if (/kerberos|kerberoast|gettgt|getst/i.test(hay)) return "kerberos";
    if (/impacket|psexec|wmiexec|smbexec|secretsdump|atexec/i.test(hay)) return "impacket";
    return "impacket";
  }
  if (slug.startsWith("exam-") || slug === "attack-workflow") return "exam";
  if (slug === "troubleshooting") return "troubleshooting";

  if (pageTags?.length) return pageTags[0];
  return "other";
}

function stepTags(service, pageTags) {
  const extras = (pageTags || []).filter(t => t !== service && ["privesc", "fuzzing", "transfer", "ad"].includes(t));
  return [...new Set([service, ...extras])];
}

/* ------------------------------------------------------------------ */
/* step / section parsing                                              */
/* ------------------------------------------------------------------ */

function parseStep(rawLines, n, ctx) {
  const warnings = [];
  const warn = (m) => warnings.push(m);
  let body = rawLines.join("\n");

  // code fences
  const codes = [];
  const langMap = { shen: "bash", shell: "bash", sh: "bash", console: "bash", text: "bash", ps: "powershell", ps1: "powershell", js: "javascript", bat: "bat", cmd: "cmd" };
  body = body.replace(/```([a-zA-Z0-9+#-]*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const l = (lang || "bash").toLowerCase();
    codes.push({ lang: langMap[l] || l, code: code.replace(/\s+$/, "") });
    return "\n";
  });

  // tables inside steps
  const tables = [];
  body = body.replace(/@@TABLE:(\d+)@@/g, (_, i) => {
    tables.push(ctx.tables[Number(i)]);
    return "\n";
  });

  body = body.replace(/\*\*(Priority|Run on|Status|Look for|Decision|Next|Common mistake|Evidence):\*\*/g, "\n$1:");
  const extendedFields = /\*\*(?:Prerequisites|Success path|Failure path):\*\*/.test(body);
  if (extendedFields) {
    body = body.replace(/\*\*(Purpose|Prerequisites|Look for|Success path|Failure path|Decision|Next|Common mistake|Evidence):\*\*/g, "\n$1:");
  }
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  const metaRe = /Priority:\s*([^\n·]+?)\s*·\s*Run on:\s*([^\n·]+?)\s*·\s*Status:\s*([^\n]+)/;
  const meta = body.match(metaRe);
  const where = `${ctx.page} · Step ${String(n).padStart(2, "0")}`;
  let priority = { value: "Core", raw: "" }, runOn = "unspecified", status = { value: "Documented — Untested", raw: "" };
  if (meta) {
    priority = normPriority(meta[1], warn, where);
    runOn = normRunOn(meta[2]);
    status = normStatus(meta[3], warn, where);
    body = body.replace(meta[0], "\n");
  } else {
    const p = body.match(/Priority:\s*([^\n·]+)/);
    const r = body.match(/Run on:\s*([^\n·]+)/);
    const s = body.match(/Status:\s*([^\n]+)/);
    if (p) priority = normPriority(p[1], warn, where);
    if (r) runOn = normRunOn(r[1]);
    if (s) status = normStatus(s[1], warn, where);
    if (!p || !s) {
      if (body.replace(/[\s-]/g, "").length > 20) warn(`[meta] ${where}: metadata line not matched`);
    }
    body = body.replace(/Priority:[^\n]*/g, "").replace(/Run on:[^\n]*/g, "").replace(/Status:[^\n]*/g, "");
  }

  const fieldNames = extendedFields
    ? "Purpose|Prerequisites|Look for|Success path|Failure path|Decision|Next|Common mistake|Evidence"
    : "Look for|Decision|Next|Common mistake|Evidence";
  const fieldRe = new RegExp(`\\n?(${fieldNames}):\\s*`, "g");
  const fields = { purpose: "", prereqs: "", lookFor: "", success: "", failure: "", decision: "", next: "", mistake: "", evidence: "" };
  const keyMap = {
    Purpose: "purpose", Prerequisites: "prereqs", "Look for": "lookFor",
    "Success path": "success", "Failure path": "failure", Decision: "decision",
    Next: "next", "Common mistake": "mistake", Evidence: "evidence"
  };
  const matches = [...body.matchAll(fieldRe)];
  let notes = body;
  if (matches.length) {
    notes = body.slice(0, matches[0].index);
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
      fields[keyMap[matches[i][1]]] = oneLine(body.slice(start, end));
    }
  }
  notes = notes.split("\n").map(oneLine).filter(Boolean).join("\n").trim();

  const commands = codes.filter(c => c.code.trim().length > 0);
  for (const key of ["purpose", "prereqs", "success", "failure"]) {
    if (!fields[key]) delete fields[key];
  }
  const service = inferService(ctx.sectionTitle, ctx.title, commands.map(c => c.code).join("\n"), ctx.slug, ctx.pageTags);

  return {
    step: {
      type: "step",
      id: ctx.stableId || `${ctx.slug}-${n}`,
      n,
      title: oneLine(ctx.title),
      priority: priority.value,
      priorityRaw: priority.raw,
      runOn,
      status: status.value,
      statusRaw: status.raw,
      commands,
      fields,
      notes,
      tables,
      service,
      tags: stepTags(service, ctx.pageTags)
    },
    warnings: warnings.map(w => `${ctx.slug}: ${w}`)
  };
}

function parseProseBlock(text) {
  const blocks = [];
  const lines = text.split("\n");
  let buf = [];
  let list = null;
  let codeBuf = null;
  let codeLang = "bash";
  const flushP = () => {
    const p = buf.map(oneLine).filter(Boolean).join(" ");
    if (p) blocks.push({ type: "p", text: p });
    buf = [];
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };
  for (const line of lines) {
    const t = line.trim();
    const fence = t.match(/^```([a-zA-Z0-9+#-]*)$/);
    if (fence) {
      if (codeBuf === null) {
        flushP(); flushList();
        codeBuf = [];
        codeLang = ({ shen: "bash", shell: "bash", sh: "bash", text: "bash", ps: "powershell", ps1: "powershell", js: "javascript" })[fence[1]] || fence[1] || "bash";
      } else {
        blocks.push({ type: "code", lang: codeLang, code: codeBuf.join("\n").replace(/\s+$/, "") });
        codeBuf = null;
      }
      continue;
    }
    if (codeBuf !== null) { codeBuf.push(line); continue; }
    if (!t) { flushP(); flushList(); continue; }
    const tm = t.match(/^@@TABLE:(\d+)@@$/);
    if (tm) { flushP(); flushList(); blocks.push({ type: "table-ref", index: Number(tm[1]) }); continue; }
    if (/^[-*]\s+/.test(t)) {
      flushP();
      if (!list) list = { type: "ul", items: [] };
      list.items.push(t.replace(/^[-*]\s+/, ""));
      continue;
    }
    if (/^\d+\.\s+/.test(t)) {
      flushP();
      if (!list || list.type !== "ol") { flushList(); list = { type: "ol", items: [] }; }
      list.items.push(t.replace(/^\d+\.\s+/, ""));
      continue;
    }
    if (t.startsWith(">")) {
      flushP(); flushList();
      blocks.push({ type: "quote", text: t.replace(/^>\s?/, "") });
      continue;
    }
    if (t.startsWith("#")) continue;
    flushList();
    buf.push(t);
  }
  if (codeBuf !== null && codeBuf.length) blocks.push({ type: "code", lang: codeLang, code: codeBuf.join("\n") });
  flushP(); flushList();
  return blocks;
}

/* ------------------------------------------------------------------ */
/* page parsing                                                        */
/* ------------------------------------------------------------------ */

function parsePage(file, metaFile) {
  const raw = fs.readFileSync(path.join(RAW, file), "utf8");
  const meta = JSON.parse(fs.readFileSync(path.join(RAW, metaFile), "utf8"));
  const warnings = [];
  const warn = (m) => warnings.push(`${meta.slug}: ${m}`);
  const { text, tables } = normalise(raw, warn);

  const lines = text.split("\n");
  const sections = [];
  const usedSectionIds = new Set();
  let current = null;
  let intro = [];

  const openSection = (title) => {
    const short = title.replace(/^[A-Z]\.\s*/, "").replace(/^\d+\.\s*/, "").trim();
    const baseId = `${meta.slug}-${slug(short)}`;
    let id = baseId;
    let suffix = 2;
    while (usedSectionIds.has(id)) id = `${baseId}-${suffix++}`;
    usedSectionIds.add(id);
    current = { id, title: short, rawTitle: title, blocks: [], tables: [] };
    sections.push(current);
  };

  // Read lines until the next heading that is OUTSIDE a fenced code block.
  // Code blocks legitimately contain lines starting with "#" (comments).
  const readUntilHeading = (start) => {
    const buf = [];
    let j = start;
    let inFence = false;
    while (j < lines.length) {
      const l = lines[j];
      if (/^\s*```/.test(l)) {
        inFence = !inFence;
        buf.push(l);
        j++;
        continue;
      }
      if (!inFence && /^#{2,3}\s+/.test(l)) break;
      buf.push(l);
      j++;
    }
    return { buf, next: j };
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) { // stray fence outside a section
      const r = readUntilHeading(i);
      const target = current ? current.blocks : intro;
      target.push(...r.buf);
      i = r.next;
      continue;
    }
    const secM = line.match(/^##\s+(.+)$/);
    if (secM) {
      openSection(secM[1].trim());
      i++;
      continue;
    }
    const stepM = line.match(/^###\s+Step\s+(\d+[a-z]?)\s*[—–-]\s*(.+)$/i);
    if (stepM && current) {
      const rawN = stepM[1];
      const digits = rawN.match(/^\d+/)[0];
      const n = digits.padStart(2, "0") + rawN.slice(digits.length);
      const title = stepM[2].trim();
      const { buf: stepLines, next } = readUntilHeading(i + 1);
      i = next;
      const parsed = parseStep(stepLines, n, {
        slug: meta.slug,
        page: meta.title,
        title,
        stableId: STEP_IDS[meta.slug]?.[title],
        sectionTitle: current.title,
        pageTags: (PAGE_META[meta.slug] || {}).tags || [],
        tables
      });
      current.blocks.push(parsed.step);
      warnings.push(...parsed.warnings);
      continue;
    }
    const subM = line.match(/^###\s+(.+)$/);
    if (subM && current) {
      current.blocks.push({ type: "h3", text: subM[1].trim() });
      i++;
      continue;
    }
    if (!current) { intro.push(line); i++; continue; }
    const { buf, next } = readUntilHeading(i);
    i = next;
    for (const b of parseProseBlock(buf.join("\n"))) {
      if (b.type === "table-ref") {
        const tbl = tables[b.index];
        if (tbl) current.blocks.push(tbl);
      } else current.blocks.push(b);
    }
  }

  const pageMeta = PAGE_META[meta.slug] || { group: "services", icon: "📄", tags: [] };
  const introText = parseProseBlock(intro.join("\n"));
  const description = oneLine(
    introText.filter(b => b.type === "quote" || b.type === "p")
      .map(b => b.text.replace(/^\*\*Purpose:\*\*\s*/, ""))
      .join(" ")
  );

  const keptSections = stripNotionLinks(pruneStaleQuickNav(pruneDroppedLinks(
    sections.filter(section => section.title !== "Related pages")
  ), meta.slug));
  const steps = keptSections.flatMap(s => s.blocks.filter(b => b.type === "step"));

  return {
    page: {
      id: meta.id,
      slug: meta.slug,
      title: meta.title,
      icon: pageMeta.icon,
      group: pageMeta.group,
      groupLabel: GROUP_LABELS[pageMeta.group] || pageMeta.group,
      tags: pageMeta.tags,
      description,
      intro: introText.filter(b => b.type !== "quote"),
      sections: keptSections,
      stepCount: steps.length,
      commandCount: steps.reduce((n, s) => n + s.commands.length, 0)
    },
    warnings
  };
}

/* ------------------------------------------------------------------ */
/* variables                                                           */
/* ------------------------------------------------------------------ */

const VAR_META = {
  TARGET_IP: { label: "Target IP", group: "network", example: "10.10.10.10" },
  ATTACKER_IP: { label: "Attack IP", group: "network", example: "10.10.14.5", aliases: ["LHOST", "ATTACK_IP"] },
  DOMAIN: { label: "Domain", group: "network", example: "corp.local" },
  DOMAIN_CONTROLLER_IP: { label: "Domain controller IP", group: "network", example: "10.10.10.5" },
  INTERFACE: { label: "Interface", group: "network", example: "tun0" },
  INTERNAL_IP: { label: "Internal target IP", group: "network", example: "172.16.1.20" },
  PIVOT_IP: { label: "Pivot IP", group: "network", example: "10.10.10.50", aliases: ["PIVOT_HOST"] },
  PIVOT1_IP: { label: "First pivot IP", group: "network", example: "10.10.10.50" },
  PIVOT2_IP: { label: "Second pivot IP", group: "network", example: "172.16.1.10" },
  USERNAME: { label: "Username", group: "credentials", example: "administrator", aliases: ["USER"] },
  PASSWORD: { label: "Password", group: "credentials", sensitive: true, example: "Password123" },
  NEW_PASSWORD: { label: "New password", group: "credentials", sensitive: true, example: "P@ssw0rd2026!" },
  NTHASH: { label: "NTLM hash", group: "credentials", sensitive: true, example: "aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0", aliases: ["HASH"] },
  TARGET_USER: { label: "Target user", group: "credentials", example: "svc_backup" },
  TARGET_ACCOUNT: { label: "Target account", group: "credentials", example: "CORP\\svc_backup" },
  TARGET_GROUP: { label: "Target group", group: "credentials", example: "Domain Admins" },
  TARGET_PORT: { label: "Target port", group: "network", example: "445", aliases: ["PORT"] },
  LOCAL_PORT: { label: "Local port", group: "network", example: "4444", aliases: ["LPORT"] },
  REMOTE_PORT: { label: "Remote port", group: "network", example: "3389" },
  HTTP_PORT: { label: "HTTP port", group: "network", example: "8080" },
  SHARE_NAME: { label: "Share name", group: "paths", example: "backups", aliases: ["SHARE"] },
  WORDLIST: { label: "Wordlist", group: "paths", example: "/usr/share/seclists/Discovery/Web-Content/common.txt" },
  USERLIST: { label: "User list", group: "paths", example: "/usr/share/seclists/Usernames/xato-net-10-million-usernames.txt" },
  FILE: { label: "File", group: "paths", example: "shell.php" },
  KEY_FILE: { label: "Key file", group: "paths", example: "id_rsa" },
  HASH_FILE: { label: "Hash file", group: "paths", example: "hashes.txt" },
  OUTPUT_DIR: { label: "Output directory", group: "paths", example: "/home/kali/loot" },
  OUTPUT_FILE: { label: "Output file", group: "paths", example: "/home/kali/loot/scan.txt" },
  VPN_FILE: { label: "VPN file", group: "paths", example: "lab.ovpn" },
  BINARY: { label: "Binary", group: "paths", example: "payload.exe" },
  SERVICE_NAME: { label: "Service name", group: "other", example: "spooler" },
  CA_NAME: { label: "CA name", group: "other", example: "corp-CA" },
  TEMPLATE: { label: "Certificate template", group: "other", example: "UserAuthentication" },
  EDB_ID: { label: "Exploit-DB ID", group: "other", example: "50383" },
  KEYWORD: { label: "Keyword", group: "other", example: "password" },
  COOKIE_VALUE: { label: "Cookie value", group: "other", sensitive: true, example: "session=..." },
  TOKEN: { label: "Token", group: "other", sensitive: true, example: "..." },
  BASE64_BLOB: { label: "Base64 blob", group: "other", example: "..." },
  RID: { label: "RID", group: "other", example: "500" },
  GROUP: { label: "Group", group: "other", example: "Domain Admins" },
  DC_HOSTNAME: { label: "DC hostname", group: "other", example: "dc01" },
  TARGET_HOST: { label: "Target hostname", group: "network", example: "fileserver" },
  SERVICE_PORT: { label: "Service port", group: "network", example: "8080" },
  SUBDIR: { label: "Subdirectory", group: "paths", example: "admin" },
  PATH: { label: "Path", group: "paths", example: "/var/www/html" },
  DOMAIN_PART1: { label: "Domain (first part)", group: "network", example: "corp" },
  DOMAIN_PART2: { label: "Domain (TLD)", group: "network", example: "local" },
  SERVICE: { label: "Service", group: "other", example: "http" },
  TARGET: { label: "Target host", group: "network", example: "fileserver" },
  TLD: { label: "Top-level domain", group: "network", example: "local" },
  VENDOR: { label: "Vendor", group: "other", example: "Microsoft" },
  PRODUCT: { label: "Product", group: "other", example: "Apache" },
  VERSION: { label: "Version", group: "other", example: "2.4.49" },
  RANDOM: { label: "Random value", group: "other", example: "1337" },
  BASELINE_SIZE: { label: "Baseline response size", group: "other", example: "1234" },
  DEFAULT_VHOST_SIZE: { label: "Default vhost size", group: "other", example: "1234" },
  WHAT: { label: "Search string", group: "other", example: "password" },
  STEP: { label: "Step number", group: "other", example: "1" }
};

const IGNORE_TOKENS = new Set(["IP", "LM", "NT", "B64", "OBJECTIVES", "POINTS", "TASK", "MODULE", "USER"]);

function buildVariables(pages) {
  const counts = new Map();
  const inCommand = new Map();
  for (const p of pages) {
    for (const s of p.sections) {
      for (const b of s.blocks) {
        if (b.type !== "step") continue;
        for (const c of b.commands) {
          for (const m of c.code.matchAll(/<([A-Z][A-Z0-9_]{1,})>/g)) {
            const t = m[1];
            counts.set(t, (counts.get(t) || 0) + 1);
            inCommand.set(t, (inCommand.get(t) || 0) + 1);
          }
        }
        for (const f of Object.values(b.fields)) {
          for (const m of (f || "").matchAll(/<([A-Z][A-Z0-9_]{1,})>/g)) {
            counts.set(m[1], (counts.get(m[1]) || 0) + 1);
          }
        }
      }
    }
  }
  const aliasTokens = new Set();
  for (const m of Object.values(VAR_META)) for (const a of m.aliases || []) aliasTokens.add(a);
  const variables = [...counts.keys()].filter(t => !IGNORE_TOKENS.has(t) && !aliasTokens.has(t)).sort().map(token => {
    const meta = VAR_META[token] || {};
    return {
      token,
      label: meta.label || token.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
      group: meta.group || "other",
      example: meta.example || "",
      sensitive: !!meta.sensitive,
      aliases: meta.aliases || [],
      description: meta.description || "",
      occurrences: counts.get(token) || 0,
      inCommands: inCommand.get(token) || 0
    };
  });
  const unknown = variables.filter(v => !VAR_META[v.token]).map(v => v.token);
  return { variables, warnings: unknown.map(t => `[variable] uncurated token <${t}> (${counts.get(t)} uses)`) };
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const files = fs.readdirSync(RAW).filter(f => f.endsWith(".html")).sort();
const pages = [];
const warnings = [];
for (const f of files) {
  const metaFile = f.replace(/\.html$/, ".json");
  if (!fs.existsSync(path.join(RAW, metaFile))) { warnings.push(`missing meta for ${f}`); continue; }
  const { page, warnings: w } = parsePage(f, metaFile);
  pages.push(page);
  warnings.push(...w);
}

const order = Object.keys(PAGE_META);
pages.sort((a, b) => order.indexOf(a.slug) - order.indexOf(b.slug));

const { variables, warnings: vw } = buildVariables(pages);
warnings.push(...vw);

const stepCount = pages.reduce((n, p) => n + p.stepCount, 0);
const commandCount = pages.reduce((n, p) => n + p.commandCount, 0);

// Guidance steps without a command are legitimate (checklists, reading steps).
const noCommand = [];
for (const p of pages) for (const s of p.sections) for (const b of s.blocks) {
  if (b.type === "step" && !b.commands.length) noCommand.push(`${p.slug} step ${b.n}`);
}

// duplicate ids
const ids = pages.flatMap(p => p.sections.flatMap(s => s.blocks.filter(b => b.type === "step").map(b => b.id)));
const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);

const services = SERVICES.filter(s => pages.some(p => p.sections.some(sec => sec.blocks.some(b => b.type === "step" && b.tags.includes(s.id)))));

const meta = {
  generatedAt: new Date().toISOString(),
  source: {
    pages: pages.length,
    steps: stepCount,
    commands: commandCount,
    rawBytes: files.reduce((n, f) => n + fs.statSync(path.join(RAW, f)).size, 0),
    checksums: Object.fromEntries(files.map(f => [f, crypto.createHash("sha256").update(fs.readFileSync(path.join(RAW, f))).digest("hex").slice(0, 16)]))
  },
  statuses: STATUSES,
  priorities: PRIORITIES,
  stepsWithoutCommand: noCommand.length,
  noteSteps: noCommand,
  duplicateStepIds: dupes,
  warnings
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "commands.json"), JSON.stringify({ pages, services, groups: GROUP_LABELS }, null, 1));
fs.writeFileSync(path.join(OUT, "variables.json"), JSON.stringify({ variables }, null, 1));
fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));

console.log(`pages: ${pages.length}`);
console.log(`steps: ${stepCount}`);
console.log(`commands: ${commandCount}`);
console.log(`variables: ${variables.length}`);
console.log(`warnings: ${warnings.length}`);
if (meta.duplicateStepIds.length) console.log(`DUPLICATE IDS: ${meta.duplicateStepIds.join(", ")}`);
const wf = path.join(ROOT, "tools", "parse-report.txt");
fs.writeFileSync(wf, warnings.join("\n") + "\n");
console.log(`report: ${wf}`);
