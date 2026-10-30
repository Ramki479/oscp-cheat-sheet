/**
 * Post-remediation browser checks (2026-10-30).
 * Verifies AUD-12, AUD-13, AUD-17 and the generated tool reference in a real browser.
 * Requires `python3 -m http.server 8124` in the project root.
 */
import puppeteer from "puppeteer-core";

const BASE = "http://127.0.0.1:8124/";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"]
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const consoleErrors = [];
const failed = [];
const external = [];
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", e => consoleErrors.push(String(e)));
page.on("requestfailed", r => failed.push(`${r.url()} :: ${r.failure()?.errorText || ""}`));
page.on("request", r => { if (!r.url().startsWith(BASE) && !r.url().startsWith("data:")) external.push(r.url()); });

const out = [];
const log = (...a) => out.push(a.join(" "));
const go = async (hash) => {
  await page.goto(BASE + hash, { waitUntil: "networkidle0" });
  await page.waitForSelector("#pageTitle");
};
const stepInfo = (id) => page.$eval(`#${id}`, el => ({
  badges: [...el.querySelectorAll(".badge")].map(b => b.textContent.trim()),
  codeBlocks: el.querySelectorAll(".code-block").length,
  codes: [...el.querySelectorAll(".code-block code")].map(c => c.dataset.template || c.textContent),
  tables: [...el.querySelectorAll(".table-wrap")].map(t => ({
    head: [...t.querySelectorAll("thead th")].map(h => h.textContent.trim()),
    rows: t.querySelectorAll("tbody tr").length,
    text: t.textContent.replace(/\s+/g, " ").trim().slice(0, 240)
  })),
  fields: [...el.querySelectorAll(".fields dt")].map(d => d.textContent.trim()),
  text: el.textContent.replace(/\s+/g, " ").trim()
}));

/* 1. AUD-12 — FTP step exposes the three-way branch and a manual check */
await go("#/p/ftp");
const ftp = await stepInfo("ftp-02");
log("# AUD-12 FTP step");
log("badges:", JSON.stringify(ftp.badges));
log("code blocks:", ftp.codeBlocks, "| manual check present:", ftp.codes.some(c => /curl.*ftp:\/\/anonymous/.test(c)));
log("fields:", JSON.stringify(ftp.fields));
log("outcome table:", JSON.stringify(ftp.tables[0]));
log("failure field says inconclusive:", /does not prove/.test(ftp.text));

/* 2. AUD-13 — BloodHound GenericAll step is actionable */
await go("#/p/bloodhound");
const bh = await stepInfo("bloodhound-09");
log("");
log("# AUD-13 BloodHound GenericAll step");
log("badges:", JSON.stringify(bh.badges));
log("command:", JSON.stringify(bh.codes));
log("points back to Step 08:", /Step 08/.test(bh.text));
log("next field present:", bh.fields.includes("Next"));

/* 3. AUD-14 — generated tool reference page */
await go("#/p/tool-reference");
const ref = await page.evaluate(() => ({
  title: document.querySelector("#pageTitle").textContent.replace(/\s+/g, " ").trim(),
  kicker: document.querySelector(".page-kicker")?.textContent.trim(),
  sections: [...document.querySelectorAll(".section-title")].map(s => s.textContent.trim()),
  tables: [...document.querySelectorAll(".table-wrap")].map(t => ({
    head: [...t.querySelectorAll("thead th")].map(h => h.textContent.trim()),
    rows: t.querySelectorAll("tbody tr").length
  })),
  legend: [...document.querySelectorAll(".table-wrap")].map(t =>
    [...t.querySelectorAll("tbody tr")].map(r => r.children[0].textContent.trim())),
  hasSshpass: document.body.textContent.includes("sshpass"),
  hasImpacketLegacy: document.body.textContent.includes("secretsdump.py"),
  navItem: [...document.querySelectorAll(".nav-item")].some(n => /Tool Reference/.test(n.textContent))
}));
log("");
log("# AUD-14 tool reference page");
log("title:", ref.title, "| kicker:", ref.kicker, "| reachable from nav:", ref.navItem);
log("sections:", JSON.stringify(ref.sections));
log("table sizes:", JSON.stringify(ref.tables));
log("status legend rows:", JSON.stringify(ref.legend[0]));
log("names sshpass:", ref.hasSshpass, "| names secretsdump.py:", ref.hasImpacketLegacy);

/* 4. Five-level status vocabulary is offered in the filter and rendered */
await go("#/p/smb");
const statuses = await page.$$eval(".filterbar select", sels =>
  sels.map(s => [...s.options].map(o => o.value)).find(v => v.includes("Syntax Checked")) || []);
const envFilter = await page.evaluate(async () => {
  const status = [...document.querySelectorAll(".filterbar select")].find(s => s.getAttribute("aria-label") === "Status");
  status.value = "Environment Dependent";
  status.dispatchEvent(new Event("change"));
  await new Promise(r => setTimeout(r, 50));
  return { visible: document.querySelectorAll(".step").length, count: document.querySelector(".filter-count")?.textContent.trim() };
});
log("");
log("# Status taxonomy in the UI");
log("filter options:", JSON.stringify(statuses));
log("environment-dependent filter on SMB:", JSON.stringify(envFilter));

/* 5. AUD-17 — machine notes render a real table with the placeholder intact */
await go("#/p/machine-notes");
const notes = await page.evaluate(() => {
  const tables = [...document.querySelectorAll(".table-wrap")];
  const proof = tables.find(t => /Screenshot/.test(t.textContent));
  return {
    tableCount: tables.length,
    proofCells: proof ? [...proof.querySelectorAll("tbody tr")].map(r => r.textContent.replace(/\s+/g, " ").trim()) : [],
    paragraphPipes: [...document.querySelectorAll("p.prose")].filter(p => p.textContent.trim().startsWith("|")).length
  };
});
log("");
log("# AUD-17 machine-notes template");
log("tables on page:", notes.tableCount, "| paragraphs starting with a pipe:", notes.paragraphPipes);
log("proof rows:", JSON.stringify(notes.proofCells));

/* 6. The tool table must scroll, not widen the document, on a phone */
const mobile = [];
for (const [w, h] of [[1440, 1000], [390, 844]]) {
  await page.setViewport({ width: w, height: h });
  await go("#/p/tool-reference");
  mobile.push(await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    tables: document.querySelectorAll(".table-wrap").length,
    scrollable: [...document.querySelectorAll(".table-wrap")].filter(t => t.scrollWidth > t.clientWidth + 1).length
  })));
}
log("");
log("# TOOL REFERENCE LAYOUT");
log("1440px:", JSON.stringify(mobile[0]));
log("390px :", JSON.stringify(mobile[1]));

log("");
log("# CONSOLE / NETWORK");
log(`consoleErrors=${consoleErrors.length} failedRequests=${failed.length} external=${external.length}`);
if (consoleErrors.length) log(consoleErrors.join("\n"));

console.log(out.join("\n"));
await browser.close();
