/**
 * Browser acceptance tests (headless Chromium via puppeteer-core).
 * Covers: structure, variable substitution, copy, drawer, filters,
 * search, no third-party requests, offline reload, mobile nav.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(import.meta.dirname, "..");
const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}/`;
const CHROME = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].find(p => fs.existsSync(p));

const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "commands.json"), "utf8"));

let server, browser, page;
const external = [];
const consoleErrors = [];

const wait = (ms) => new Promise(r => setTimeout(r, ms));

before(async () => {
  if (!CHROME) return;
  server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  await wait(700);
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
  });
  await browser.defaultBrowserContext().overridePermissions(BASE, ["clipboard-read", "clipboard-write"]);
  page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("request", (req) => {
    const u = req.url();
    if (!u.startsWith(BASE) && !u.startsWith("data:") && !u.startsWith("blob:")) external.push(u);
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  await page.goto(BASE, { waitUntil: "networkidle0" });
  await page.waitForSelector(".step");
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const skip = !CHROME;
const smb = data.pages.find(p => p.slug === "smb");
const smbSteps = smb.sections.flatMap(s => s.blocks.filter(b => b.type === "step"));

test("page structure: brand, 25 nav pages, default SMB service view", { skip }, async () => {
  assert.match(await page.$eval(".brand-name", el => el.textContent), /OSCP-CHEAT-SHEET/);
  // 24 source pages plus the generated tool reference.
  assert.equal(await page.$$eval(".nav-item", els => els.length), data.pages.length);
  assert.equal(data.pages.length, 25);
  assert.equal(await page.$$eval(".nav-item", els => els.filter(e => e.classList.contains("active")).length), 0);
  const h1 = await page.$eval("h1", el => el.textContent);
  assert.match(h1, /SMB commands/);
  const steps = await page.$$eval(".step", els => els.length);
  assert.equal(steps, smbSteps.length);
  assert.ok(steps > 15, `expected a full SMB view, got ${steps}`);
  assert.equal(consoleErrors.length, 0, consoleErrors.join("\n"));
});

test("layout: split header, fixed sidebar and centered content container", { skip }, async () => {
  const layoutPage = await browser.newPage();
  await layoutPage.setViewport({ width: 1920, height: 1200 });
  await layoutPage.goto(`${BASE}#/p/nmap`, { waitUntil: "networkidle0" });
  await layoutPage.waitForSelector(".section-chip");

  const layout = await layoutPage.evaluate(() => {
    const rect = (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
    const chipTops = [...new Set([...document.querySelectorAll(".section-chip")]
      .map(c => Math.round(c.getBoundingClientRect().top)))];
    return {
      justify: css(".topbar-row", "justifyContent"),
      brand: rect(".brand"),
      actions: rect(".top-actions"),
      row: rect(".topbar-row"),
      pinned: rect(".pinned"),
      topbar: rect(".topbar"),
      serviceBar: rect(".service-bar"),
      serviceBarPosition: css(".service-bar", "position"),
      layoutDisplay: css(".main-layout", "display"),
      sidebarWidth: rect(".sidebar").width,
      panelGrow: css(".command-panel", "flexGrow"),
      panel: rect(".command-panel"),
      content: rect(".content-container"),
      contentMax: css(".content-container", "maxWidth"),
      contentPad: css(".content-container", "padding"),
      chipRows: chipTops.length
    };
  });

  assert.equal(layout.justify, "space-between");
  assert.ok(layout.brand.right < layout.pinned.left, "inputs are not between brand and actions");
  assert.ok(layout.pinned.right < layout.actions.left, "inputs are not between brand and actions");
  assert.ok(layout.pinned.top >= layout.row.top - 1, "inputs are not in the top header row");
  assert.equal(layout.layoutDisplay, "flex");
  assert.equal(Math.round(layout.sidebarWidth), 260);
  assert.equal(layout.panelGrow, "1");
  assert.equal(layout.contentMax, "1200px");
  assert.equal(layout.contentPad, "32px");
  assert.ok(layout.chipRows > 1, "section chips did not wrap");
  assert.equal(Math.round(layout.serviceBar.width), Math.round(layout.panel.width));
  assert.ok(layout.serviceBar.top >= layout.topbar.bottom - 1, "service bar is not below the header");
  assert.equal(layout.serviceBarPosition, "static");

  const leftGap = layout.content.left - layout.panel.left;
  const rightGap = layout.panel.right - layout.content.right;
  assert.ok(Math.abs(leftGap - rightGap) < 2, `content not centered: ${leftGap} vs ${rightGap}`);

  // The Reference action jumps from a service view to the first reference page.
  await layoutPage.goto(BASE, { waitUntil: "networkidle0" });
  await layoutPage.click("#referenceBtn");
  await layoutPage.waitForFunction(() => location.hash === "#/p/nmap");
  assert.equal(await layoutPage.evaluate(() => location.hash), "#/p/nmap");
  await layoutPage.close();
});

test("variables propagate into commands and clear the missing banner", { skip }, async () => {
  await page.click("#pin-TARGET_IP");
  await page.type("#pin-TARGET_IP", "10.10.10.99");
  const result = await page.evaluate(() => {
    const codes = [...document.querySelectorAll("code[data-template]")];
    const hit = codes.find(c => c.dataset.template.includes("<TARGET_IP>"));
    return hit ? { text: hit.textContent, missing: hit.closest(".code-block").querySelector(".missing").hidden } : null;
  });
  assert.ok(result, "no command using TARGET_IP found");
  assert.match(result.text, /10\.10\.10\.99/);
  assert.doesNotMatch(result.text, /<TARGET_IP>/);
  assert.equal(result.missing, true);

  await page.$eval("#pin-TARGET_IP", (input) => {
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const cleared = await page.evaluate(() => {
    const codes = [...document.querySelectorAll("code[data-template]")];
    const hit = codes.find(c => c.dataset.template.includes("<TARGET_IP>"));
    return hit.textContent.includes("<TARGET_IP>");
  });
  assert.equal(cleared, true);
});

test("copy copies the rendered command, not the template", { skip }, async () => {
  await page.click("#pin-TARGET_IP");
  await page.type("#pin-TARGET_IP", "10.10.10.77");
  const expected = await page.evaluate(() => {
    const codes = [...document.querySelectorAll("code[data-template]")];
    const hit = codes.find(c => c.dataset.template.includes("<TARGET_IP>"));
    hit.closest(".code-block").querySelector(".copy-btn").click();
    return hit.textContent;
  });
  await wait(250);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clip, expected);
  assert.match(clip, /10\.10\.10\.77/);
  assert.doesNotMatch(clip, /<TARGET_IP>/);
});

test("inputs drawer edits a variable used by the page", { skip }, async () => {
  await page.click("#openInputs");
  await page.waitForSelector("#drawer:not([hidden])");
  const input = await page.$('input[aria-label^="Username"]');
  assert.ok(input, "Username input not in drawer");
  await input.click({ clickCount: 3 });
  await input.type("alice");
  await page.click("#closeInputs");
  const updated = await page.evaluate(() => {
    const codes = [...document.querySelectorAll("code[data-template]")];
    const hit = codes.find(c => c.dataset.template.includes("<USERNAME>"));
    return hit ? hit.textContent.includes("alice") : false;
  });
  assert.equal(updated, true);
});

test("pinned IP and domain inputs reject malformed values", { skip }, async () => {
  const inputPage = await browser.newPage();
  await inputPage.goto(`${BASE}#/p/nmap`, { waitUntil: "networkidle0" });
  await inputPage.waitForSelector("#pin-TARGET_IP");

  await inputPage.click("#pin-TARGET_IP");
  await inputPage.type("#pin-TARGET_IP", "10.10.10.10.10");
  const badIp = await inputPage.evaluate(() => {
    const input = document.querySelector("#pin-TARGET_IP");
    const error = document.querySelector("#pin-error-TARGET_IP");
    const code = [...document.querySelectorAll("code[data-template]")]
      .find(c => c.dataset.template.includes("<TARGET_IP>"));
    const topbar = document.querySelector(".topbar").getBoundingClientRect();
    const bar = document.querySelector(".service-bar").getBoundingClientRect();
    const errRect = error.getBoundingClientRect();
    const content = document.querySelector(".content-container").getBoundingClientRect();
    return {
      value: input.value,
      invalid: input.classList.contains("invalid"),
      aria: input.getAttribute("aria-invalid"),
      errorHidden: error.hidden,
      error: error.textContent,
      command: code?.textContent || "",
      topbarBottom: topbar.bottom,
      barTop: bar.top,
      errBottom: errRect.bottom,
      contentTop: content.top
    };
  });
  assert.equal(badIp.value, "10.10.10.10.10");
  assert.equal(badIp.invalid, true);
  assert.equal(badIp.aria, "true");
  assert.equal(badIp.errorHidden, false);
  assert.match(badIp.error, /valid IPv4/);
  assert.match(badIp.command, /<TARGET_IP>/);
  assert.ok(badIp.errBottom <= badIp.barTop + 1, "error overlaps the service bar");
  assert.ok(badIp.barTop >= badIp.topbarBottom - 1, "service bar overlaps the header");
  assert.ok(badIp.contentTop >= badIp.barTop - 1, "content overlaps the service bar");

  await inputPage.$eval("#pin-TARGET_IP", (input) => {
    input.value = "10.10.10.10";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const goodIp = await inputPage.evaluate(() => {
    const input = document.querySelector("#pin-TARGET_IP");
    const error = document.querySelector("#pin-error-TARGET_IP");
    const code = [...document.querySelectorAll("code[data-template]")]
      .find(c => c.dataset.template.includes("<TARGET_IP>"));
    return { invalid: input.classList.contains("invalid"), hidden: error.hidden, command: code?.textContent || "" };
  });
  assert.equal(goodIp.invalid, false);
  assert.equal(goodIp.hidden, true);
  assert.match(goodIp.command, /10\.10\.10\.10/);

  await inputPage.click("#pin-DOMAIN");
  await inputPage.type("#pin-DOMAIN", "corp..local");
  const badDomain = await inputPage.evaluate(() => {
    const input = document.querySelector("#pin-DOMAIN");
    const error = document.querySelector("#pin-error-DOMAIN");
    return { invalid: input.classList.contains("invalid"), error: error.textContent, hidden: error.hidden };
  });
  assert.equal(badDomain.invalid, true);
  assert.equal(badDomain.hidden, false);
  assert.match(badDomain.error, /valid domain/);

  await inputPage.$eval("#pin-DOMAIN", (input) => {
    input.value = "corp.local";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(await inputPage.$eval("#pin-DOMAIN", input => input.classList.contains("invalid")), false);
  await inputPage.close();
});

test("priority filter narrows the visible steps", { skip }, async () => {
  const before = await page.$$eval(".step", els => els.length);
  await page.select(".filterbar select", "Conditional");
  await page.waitForFunction((prev) => document.querySelectorAll(".step").length !== prev, {}, before);
  const after = await page.$$eval(".step", els => els.length);
  const expected = smbSteps.filter(s => s.priority === "Conditional").length;
  assert.equal(after, expected);
  await page.click(".filterbar .link-btn");
  assert.equal(await page.$$eval(".step", els => els.length), before);
});

test("search finds steps and navigates to the source page", { skip }, async () => {
  await page.click("#search");
  await page.type("#search", "kerberoast");
  await page.waitForSelector(".search-hit");
  const hits = await page.$$eval(".search-hit", els => els.length);
  assert.ok(hits >= 1);
  await page.click(".search-hit");
  await page.waitForSelector(".step");
  const h1 = await page.$eval("h1", el => el.textContent);
  assert.doesNotMatch(h1, /Results for/);
  assert.equal(await page.$eval("#search", el => el.value), "");
});

test("quick navigation chips scroll a section below the fixed header", { skip }, async () => {
  await page.goto(`${BASE}#/p/nmap`, { waitUntil: "networkidle0" });
  await page.waitForSelector("#nmap-scope-and-target");

  const labels = await page.$$eval(".section-nav .section-chip", els => els.map(e => e.textContent.trim()));
  assert.ok(labels.includes("1. Scope and target"), labels.join(" | "));
  assert.ok(labels.includes("5. UDP scanning"), labels.join(" | "));
  assert.equal(await page.$eval(".section-nav", el => getComputedStyle(el).flexWrap), "wrap");

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await wait(200);
  const beforeY = await page.evaluate(() => window.scrollY);
  assert.ok(beforeY > 500, `expected to be scrolled down, got ${beforeY}`);

  // Click via the DOM so Puppeteer does not scroll the chip row into view first.
  await page.evaluate(() => {
    [...document.querySelectorAll(".section-chip")]
      .find(c => c.textContent.trim() === "1. Scope and target")
      .click();
  });

  await page.waitForFunction(() => {
    const target = document.getElementById("nmap-scope-and-target");
    const topbar = document.querySelector(".topbar").getBoundingClientRect().height;
    const rect = target.getBoundingClientRect();
    return rect.top >= topbar && rect.top <= topbar + 80;
  }, { timeout: 5000 });

  const state = await page.evaluate(() => {
    const target = document.getElementById("nmap-scope-and-target");
    const header = document.querySelector(".topbar").getBoundingClientRect().height;
    const heading = target.querySelector(".section-title");
    const chip = [...document.querySelectorAll(".section-chip")]
      .find(c => c.textContent.trim() === "1. Scope and target");
    return {
      y: window.scrollY,
      top: target.getBoundingClientRect().top,
      header,
      flash: heading.classList.contains("target-flash"),
      active: chip.classList.contains("active"),
      aria: chip.getAttribute("aria-current")
    };
  });

  assert.ok(state.y < beforeY, `did not scroll up: ${beforeY} -> ${state.y}`);
  assert.ok(state.top >= state.header, `section hidden under header: top ${state.top}, header ${state.header}`);
  assert.ok(state.top <= state.header + 30, `section too far below header: top ${state.top}, header ${state.header}`);
  assert.equal(state.flash, true, "landing flash not applied");
  assert.equal(state.active, true, "clicked chip not active");
  assert.equal(state.aria, "location");
});

test("SSH page shows the ordered decision workflow and key-connect step", { skip }, async () => {
  const sshPage = await browser.newPage();
  await sshPage.goto(`${BASE}#/p/ssh`, { waitUntil: "networkidle0" });
  await sshPage.waitForSelector("#ssh-detection-and-version-identification");

  const ids = await sshPage.$$eval(".step", els => els.map(e => e.id));
  assert.deepEqual(ids, [
    "ssh-01", "ssh-02", "ssh-10", "ssh-03", "ssh-04", "ssh-05",
    "ssh-06", "ssh-07", "ssh-08", "ssh-09", "ssh-12", "ssh-11"
  ]);
  const titles = await sshPage.$$eval(".step-title", els => els.map(e => e.textContent.trim()));
  assert.deepEqual(titles.slice(0, 4), [
    "Confirm the service and version", "Ask without authenticating",
    "Read the algorithm list", "Verbose connection trace"
  ]);
  assert.ok(titles.indexOf("Read the algorithm list") < titles.indexOf("One deliberate attempt, not a brute force"));

  const labels = await sshPage.$eval("#ssh-01 .fields", el =>
    [...el.querySelectorAll("dt")].map(dt => dt.textContent.trim()));
  assert.deepEqual(labels, [
    "Purpose", "Prerequisites", "Look for", "Success path", "Failure path",
    "Decision", "Next", "Common mistake", "Evidence"
  ]);

  const chips = await sshPage.$$eval(".section-nav .section-chip", els => els.map(e => e.textContent.trim()));
  assert.ok(chips.includes("1. Detection and version identification"), chips.join(" | "));
  assert.ok(chips.includes("3. Algorithm enumeration"), chips.join(" | "));
  assert.ok(chips.includes("11. Connect using the key"), chips.join(" | "));

  await sshPage.click("#pin-TARGET_IP");
  await sshPage.type("#pin-TARGET_IP", "10.10.10.55");
  const connect = await sshPage.$eval("#ssh-12 code[data-template]", el => ({
    template: el.dataset.template, text: el.textContent
  }));
  assert.equal(connect.template, "ssh -i <KEY_FILE> <USERNAME>@<TARGET_IP>");
  assert.match(connect.text, /10\.10\.10\.55/);
  assert.match(connect.text, /<KEY_FILE>/);
  const missing = await sshPage.$eval("#ssh-12 .missing", el => el.textContent);
  assert.match(missing, /KEY_FILE/);

  assert.equal(await sshPage.$eval('a[href="#/p/tunneling"]', a => a.getAttribute("href")), "#/p/tunneling");
  await sshPage.evaluate(() => document.querySelector('a[href="#/p/tunneling"]').click());
  await sshPage.waitForFunction(() => location.hash === "#/p/tunneling");
  await sshPage.waitForSelector("h1");
  assert.match(await sshPage.$eval("h1", el => el.textContent), /Tunneling/i);
  await sshPage.close();
});

test("Bleeding Edge page renders 23 ordered steps and non-copyable output", { skip }, async () => {
  const bePage = await browser.newPage();
  await bePage.goto(`${BASE}#/p/bleeding-edge`, { waitUntil: "networkidle0" });
  await bePage.waitForSelector("#bleeding-edge-nopac-samaccountname-spoofing");

  const ids = await bePage.$$eval(".step", els => els.map(e => e.id));
  assert.equal(ids.length, 23);
  assert.deepEqual(ids.slice(0, 3), ["bleeding-edge-01", "bleeding-edge-02", "bleeding-edge-03"]);
  assert.deepEqual(ids.slice(-3), ["bleeding-edge-21", "bleeding-edge-22", "bleeding-edge-23"]);

  const outputs = await bePage.$$eval(".output-block", els => els.map(e => ({
    lang: e.querySelector(".lang")?.textContent.trim(),
    copyButtons: e.querySelectorAll(".copy-btn").length,
    templates: e.querySelectorAll("code[data-template]").length,
    text: e.querySelector("code")?.textContent
  })));
  assert.equal(outputs.length, 21);
  for (const o of outputs) {
    assert.equal(o.lang, "output");
    assert.equal(o.copyButtons, 0, "output must not offer a copy button");
    assert.equal(o.templates, 0, "output must not be variable-substituted");
  }
  assert.ok(outputs.some(o => o.text.includes("<SNIP>")), "redaction marker must render literally");

  await bePage.click("#pin-ATTACKER_IP");
  await bePage.type("#pin-ATTACKER_IP", "10.10.14.9");
  const cmd = await bePage.$eval("#bleeding-edge-11 code[data-template]", el => el.textContent);
  assert.match(cmd, /10\.10\.14\.9/);
  assert.doesNotMatch(cmd, /<ATTACKER_IP>/);
  // The captured output beside it keeps the source's own addresses.
  const stepOut = await bePage.$eval("#bleeding-edge-11 .output-block code", el => el.textContent);
  assert.match(stepOut, /172\.16\.5\.225/);
  assert.doesNotMatch(stepOut, /10\.10\.14\.9/);

  const active = await bePage.$$eval(".nav-item.active", els => els.map(e => e.textContent.trim()));
  assert.equal(active.length, 1);
  assert.match(active[0], /Bleeding Edge/);
  await bePage.close();
});

test("no third-party requests", { skip }, async () => {
  assert.deepEqual(external, []);
  const notionLinks = await page.$$eval('a[href*="notion"]', els => els.map(a => a.href));
  assert.deepEqual(notionLinks, []);
});

test("offline reload works after the first visit", { skip }, async () => {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle0" });
  await page.setOfflineMode(true);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
  } catch { /* reload can throw while offline; the SW should still answer */ }
  await page.waitForSelector(".step", { timeout: 10000 });
  const h1 = await page.$eval("h1", el => el.textContent);
  assert.ok(h1.length > 3);
  const offlinePill = await page.$eval("#netText", el => el.textContent);
  assert.match(offlinePill, /^Offline/);
  await page.setOfflineMode(false);
});

test("step titles render as plain text and alternative branches are labelled", { skip }, async () => {
  const t = await browser.newPage();
  await t.goto(`${BASE}#/p/post-exploitation`, { waitUntil: "networkidle0" });
  await t.waitForSelector("#post-exploitation-13 .step-title");
  const title = await t.$eval("#post-exploitation-13 .step-title", el => el.textContent);
  assert.equal(title, "psexec.py (SYSTEM, noisy)");
  const raw = await t.$$eval(".step-title", els => els.map(e => e.textContent).filter(x => /\]\(|`/.test(x)));
  assert.deepEqual(raw, [], "no step heading may show Markdown syntax");

  await t.goto(`${BASE}#/p/bleeding-edge`, { waitUntil: "networkidle0" });
  await t.waitForSelector("#bleeding-edge-15");
  const altBadge = await t.$eval("#bleeding-edge-15 .badges", el => el.innerText);
  assert.match(altBadge, /Alternative/i);
  const primaryBadge = await t.$eval("#bleeding-edge-16 .badges", el => el.innerText);
  assert.doesNotMatch(primaryBadge, /Alternative/i);
  await t.close();
});

test("every tagged service is reachable from the chip row", { skip }, async () => {
  const t = await browser.newPage();
  await t.goto(BASE, { waitUntil: "networkidle0" });
  await t.waitForSelector(".chip");
  const labels = await t.$$eval(".chip", els => els.map(e => e.innerText.split("\n")[0].trim()));
  for (const label of ["File Transfer", "Content Discovery", "Node Inspector", "Exam", "Notes", "Troubleshooting"]) {
    assert.ok(labels.includes(label), `chip row is missing ${label}`);
  }
  await t.goto(`${BASE}#/s/transfer`, { waitUntil: "networkidle0" });
  await t.waitForSelector("h1");
  assert.equal(await t.$$eval(".chip.active", els => els.length), 1);
  await t.close();
});

test("an unknown in-app hash falls back to a rendered service, not a mismatched page", { skip }, async () => {
  const t = await browser.newPage();
  await t.goto(`${BASE}#/p/nmap`, { waitUntil: "networkidle0" });
  await t.waitForSelector(".step");
  await t.evaluate(() => { location.hash = "#/p/does-not-exist"; });
  await t.waitForFunction(() => /SMB commands/.test(document.querySelector("h1")?.textContent || ""));
  assert.match(await t.$eval("h1", el => el.textContent), /SMB commands/);
  await t.close();
});

test("unspecified execution context is shown in readable form", { skip }, async () => {
  const t = await browser.newPage();
  await t.goto(`${BASE}#/p/active-directory`, { waitUntil: "networkidle0" });
  await t.waitForSelector("#active-directory-14");
  const badges = await t.$eval("#active-directory-14 .badges", el => el.innerText);
  assert.match(badges, /Context varies/i);
  assert.doesNotMatch(badges, /UNSPECIFIED/i);
  await t.close();
});

test("machine notes template keeps its command placeholders", { skip }, async () => {
  const t = await browser.newPage();
  await t.goto(`${BASE}#/p/machine-notes`, { waitUntil: "networkidle0" });
  await t.waitForSelector("#machine-notes-01");
  const codes = await t.$$eval(".code-block code", els => els.map(e => e.textContent));
  assert.ok(codes.includes("<command exactly as run>"));
  assert.ok(codes.every(c => c.trim().length > 0));
  await t.close();
});

test("mobile layout exposes the navigation toggle", { skip }, async () => {
  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, isMobile: true });
  await mobile.goto(BASE, { waitUntil: "networkidle0" });
  await mobile.waitForSelector(".step");
  const display = await mobile.$eval("#navToggle", el => getComputedStyle(el).display);
  assert.notEqual(display, "none");
  await mobile.click("#navToggle");
  assert.equal(await mobile.$eval("#sidebar", el => el.classList.contains("open")), true);
  await mobile.close();
});
