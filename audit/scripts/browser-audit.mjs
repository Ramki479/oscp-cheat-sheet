import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE="http://127.0.0.1:8124/";
const browser=await puppeteer.launch({executablePath:"/usr/bin/chromium",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage"]});
const ctx=browser.defaultBrowserContext();
await ctx.overridePermissions(BASE,["clipboard-read","clipboard-write"]);
const page=await browser.newPage();
await page.setViewport({width:1440,height:1000});
const logs=[], errors=[], failed=[], external=[];
page.on("console",m=>{ if(m.type()==="error") logs.push(m.text()); });
page.on("pageerror",e=>errors.push(String(e)));
page.on("requestfailed",r=>failed.push(r.url()+" :: "+(r.failure()?.errorText||"")));
page.on("request",r=>{const u=r.url(); if(!u.startsWith(BASE)&&!u.startsWith("data:")) external.push(u);});
const out=[];
const log=(...a)=>out.push(a.join(" "));
const goto=async(hash,sel=".page-head",ms=0)=>{ await page.goto(BASE+hash,{waitUntil:"networkidle0"}); await page.waitForSelector(sel); if(ms) await new Promise(r=>setTimeout(r,ms)); };

const data=JSON.parse(fs.readFileSync("data/commands.json","utf8"));

// 1. every page route
log("# PAGE ROUTES");
for(const p of data.pages){
  await goto(`#/p/${p.slug}`);
  const info=await page.evaluate(()=>({
    h1:document.querySelector("h1")?.innerText||"",
    steps:document.querySelectorAll(".step").length,
    sections:document.querySelectorAll("section.section").length,
    chips:document.querySelectorAll(".section-chip").length,
    empty:document.querySelectorAll(".empty").length,
    title:document.title
  }));
  const expected=p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step")).length;
  log(`${p.slug} h1="${info.h1}" steps=${info.steps}/${expected} sections=${info.sections} chips=${info.chips} empty=${info.empty}`);
}
// 2. service routes
log("\n# SERVICE ROUTES");
for(const s of data.services){
  await goto(`#/s/${s.id}`);
  const info=await page.evaluate(()=>({h1:document.querySelector("h1")?.innerText||"",steps:document.querySelectorAll(".step").length, chip:[...document.querySelectorAll(".chip")].some(c=>c.classList.contains("active"))}));
  log(`${s.id} -> "${info.h1}" steps=${info.steps} activeChip=${info.chip}`);
}
// 3. navigation inventory
await goto("#/p/nmap");
const nav=await page.evaluate(()=>({
  navItems:[...document.querySelectorAll(".nav-item")].map(e=>e.dataset.slug),
  chips:[...document.querySelectorAll(".chip")].map(e=>e.innerText.trim()),
  aria:[...document.querySelectorAll("button")].filter(b=>!b.innerText.trim()&&!b.getAttribute("aria-label")).length,
  inputs:[...document.querySelectorAll("input")].filter(i=>!i.getAttribute("aria-label")&&!document.querySelector(`label[for="${i.id}"]`)).length
}));
log("\n# NAV\nnavItems="+nav.navItems.length+" chips="+JSON.stringify(nav.chips));
log("unlabelled buttons="+nav.aria+" unlabelled inputs="+nav.inputs);

// 4. step titles that still contain markdown
log("\n# TITLES WITH MARKDOWN");
for(const p of data.pages) for(const s of p.sections) for(const b of s.blocks) if(b.type==="step" && /\[[^\]]+\]\([^)]+\)|\*\*|`/.test(b.title)) log(`${b.id} :: ${b.title}`);
await goto("#/p/post-exploitation");
const mdTitles=await page.$$eval(".step-title",els=>els.map(e=>e.innerText).filter(t=>/\[|\]\(|`/.test(t)));
log("rendered post-exploitation titles: "+JSON.stringify(mdTitles));

// 5. alternative/conditional presentation
log("\n# ALTERNATIVE PRESENTATION");
const alt=await page.evaluate(()=>{
  const arts=[...document.querySelectorAll(".step")];
  return arts.filter(a=>/^Alternative|^Fallback|^Optional/.test(a.querySelector(".step-title")?.innerText||"")).map(a=>({
    title:a.querySelector(".step-title")?.innerText,
    badges:[...a.querySelectorAll(".badge")].map(b=>b.innerText),
    hasAltClass:a.className
  }));
});
log(JSON.stringify(alt,null,1));
await goto("#/p/bleeding-edge");
const alt2=await page.evaluate(()=>[...document.querySelectorAll(".step")].filter(a=>/^Alternative/.test(a.querySelector(".step-title")?.innerText||"")).map(a=>({id:a.id,badges:[...a.querySelectorAll(".badge")].map(b=>b.innerText)})));
log("bleeding-edge alternatives: "+JSON.stringify(alt2));

// 6. runOn unspecified
log("\n# RUNON BADGES");
await goto("#/p/active-directory");
const runon=await page.evaluate(()=>[...new Set([...document.querySelectorAll(".badge.b-run")].map(b=>b.innerText))]);
log(JSON.stringify(runon));

// 7. variables
await goto("#/p/smb");
log("\n# VARIABLES");
const before=await page.$eval(".step .code-block code",e=>e.innerText);
await page.type("#pin-TARGET_IP","10.10.10.10");
await new Promise(r=>setTimeout(r,150));
const after=await page.$eval(".step .code-block code",e=>e.innerText);
log("before:",before.split("\n")[0]);
log("after :",after.split("\n")[0]);
// invalid IP
await page.$eval("#pin-TARGET_IP",e=>{e.value="";});
await page.type("#pin-TARGET_IP","10.10.10.10.10");
await new Promise(r=>setTimeout(r,150));
const invalid=await page.evaluate(()=>({
  value:document.querySelector("#pin-TARGET_IP").value,
  aria:document.querySelector("#pin-TARGET_IP").getAttribute("aria-invalid"),
  err:document.querySelector("#pin-error-TARGET_IP")?.textContent,
  code:document.querySelector(".step .code-block code").innerText.split("\n")[0],
  missing:document.querySelector(".step .missing")?.innerText
}));
log("invalid ip:",JSON.stringify(invalid));
// valid restore + copy
await page.$eval("#pin-TARGET_IP",e=>{e.value="";});
await page.type("#pin-TARGET_IP","10.10.10.10");
await page.type("#pin-DOMAIN","corp.local");
await new Promise(r=>setTimeout(r,150));
await page.click(".step .copy-btn");
await new Promise(r=>setTimeout(r,200));
const clip=await page.evaluate(()=>navigator.clipboard.readText());
log("clipboard first line:",clip.split("\n")[0]);
// missing variable copy
await goto("#/p/ftp");
await page.click(".step .copy-btn");
await new Promise(r=>setTimeout(r,200));
const toast=await page.$eval("#toast",e=>e.innerText);
const clip2=await page.evaluate(()=>navigator.clipboard.readText());
log("missing copy toast:",toast,"| clip:",clip2.split("\n")[0]);

// 8. search
log("\n# SEARCH");
await goto("#/p/nmap");
await page.type("#search","smb signing");
await new Promise(r=>setTimeout(r,300));
const search=await page.evaluate(()=>({h1:document.querySelector("h1")?.innerText,hits:document.querySelectorAll(".search-hit").length,desc:document.querySelector(".page-desc")?.innerText}));
log(JSON.stringify(search));
await page.$eval("#search",e=>{e.value="";e.dispatchEvent(new Event("input",{bubbles:true}));});
await page.type("#search","zzzznotfound");
await new Promise(r=>setTimeout(r,300));
log("no-result empty:",await page.$$eval(".empty",els=>els.map(e=>e.innerText)));

// 9. hash + back/forward + refresh
log("\n# ROUTING");
await goto("#/p/smb"); await goto("#/p/ftp");
await page.goBack(); await new Promise(r=>setTimeout(r,300));
log("after back:",await page.$eval("h1",e=>e.innerText));
await page.goForward(); await new Promise(r=>setTimeout(r,300));
log("after forward:",await page.$eval("h1",e=>e.innerText));
await goto("#/s/nfs");
log("service reload:",await page.$eval("h1",e=>e.innerText));
await page.goto(BASE+"#/p/nope",{waitUntil:"networkidle0"});
await page.waitForSelector(".page-head");
log("unknown route:",await page.$eval("h1",e=>e.innerText));

// 10. layout overflow at 1440 and 1024
log("\n# OVERFLOW");
for(const [w,h] of [[1440,1000],[1024,768],[390,844]]){
  await page.setViewport({width:w,height:h});
  await goto("#/p/nmap");
  const ov=await page.evaluate(()=>({
    doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    codes:[...document.querySelectorAll(".code-block pre")].filter(p=>p.scrollWidth>p.clientWidth+2).length,
    maxCode:Math.max(...[...document.querySelectorAll(".code-block pre")].map(p=>p.scrollWidth))
  }));
  log(`${w}px horizontalOverflow=${ov.doc} scrollableCodeBlocks=${ov.codes} maxCodeWidth=${ov.maxCode}`);
}

// 11. output blocks not copied / not substituted
log("\n# OUTPUT BLOCKS");
await goto("#/p/bleeding-edge");
const outputs=await page.evaluate(()=>({
  blocks:document.querySelectorAll(".output-block").length,
  copyButtons:document.querySelectorAll(".output-block .copy-btn").length,
  placeholders:[...document.querySelectorAll(".output-block code")].filter(c=>/<[A-Z][A-Z0-9_]+>/.test(c.innerText)).length
}));
log(JSON.stringify(outputs));

// 12. console/net
log("\n# CONSOLE / NETWORK");
log("consoleErrors="+logs.length+" pageErrors="+errors.length+" failedRequests="+failed.length+" external="+external.length);
for(const e of logs) log(" console:",e);
for(const e of errors) log(" pageerror:",e);
for(const e of failed) log(" failed:",e);
for(const e of [...new Set(external)]) log(" external:",e);

fs.writeFileSync("audit/evidence/browser-audit.txt",out.join("\n")+"\n");
console.log(out.join("\n"));
await browser.close();
