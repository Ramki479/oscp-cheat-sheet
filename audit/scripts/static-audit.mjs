import fs from "node:fs";
const { pages, services } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const { variables } = JSON.parse(fs.readFileSync("data/variables.json","utf8"));
const steps = pages.flatMap(p=>p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step").map(b=>({page:p,section:s,step:b}))));
const out = [];
const log = (...a)=>out.push(a.join(" "));

log("# STEP INVENTORY");
for (const p of pages) {
  log(`\n## ${p.slug} (${p.stepCount} steps / ${p.commandCount} cmds)`);
  for (const s of p.sections) {
    const st = s.blocks.filter(b=>b.type==="step");
    if (st.length) log(`  § ${s.id} :: ${s.title} [${st.length}]`);
  }
}

log("\n# ANOMALIES");

// 1. tokens inside output blocks
const reg = new Set(variables.map(v=>v.token));
for (const v of variables) for (const a of v.aliases||[]) reg.add(a);
for (const {page,step} of steps) for (const o of step.outputs||[]) {
  const m=[...o.code.matchAll(/<([A-Z][A-Z0-9_]+)>/g)].map(x=>x[1]);
  if (m.length) log(`OUTPUT-TOKEN ${step.id} ${page.slug}: ${m.join(",")}`);
}

// 2. tokens in fields/notes not registered
for (const {page,step} of steps) {
  for (const [k,v] of Object.entries(step.fields||{})) {
    for (const m of String(v).matchAll(/<([A-Z][A-Z0-9_]{1,})>/g)) if(!reg.has(m[1])) log(`UNREG-FIELD ${step.id} ${k}: <${m[1]}>`);
  }
  if (step.notes) for (const m of String(step.notes).matchAll(/<([A-Z][A-Z0-9_]{1,})>/g)) if(!reg.has(m[1])) log(`UNREG-NOTE ${step.id}: <${m[1]}>`);
}

// 3. duplicate command text
const byCode = new Map();
for (const {page,step} of steps) for (const c of step.commands) {
  const k=c.code.trim();
  if(!byCode.has(k)) byCode.set(k,[]);
  byCode.get(k).push(`${page.slug}/${step.id}`);
}
for (const [code,where] of byCode) if (where.length>1) log(`DUP-CMD ${where.join(" | ")} :: ${code.split("\n")[0].slice(0,90)}`);

// 4. step number ordering
for (const p of pages) {
  const nums = p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step").map(b=>String(b.n)));
  const parsed = nums.map(n=>parseFloat(n));
  for (let i=1;i<parsed.length;i++) if (parsed[i] < parsed[i-1]) log(`ORDER ${p.slug}: ${nums[i-1]} -> ${nums[i]}`);
}

// 5. fields coverage
for (const {page,step} of steps) {
  const f=step.fields||{};
  const missing=["purpose","prereqs","next"].filter(k=>!f[k]);
  if (step.commands.length && missing.length===3) log(`NO-GUIDANCE ${page.slug}/${step.id} "${step.title}"`);
}

// 6. runOn vs page
const ro={};
for (const {page,step} of steps){ (ro[page.slug] ||= {}); ro[page.slug][step.runOn]=(ro[page.slug][step.runOn]||0)+1; }
for (const [k,v] of Object.entries(ro)) log(`RUNON ${k}: ${JSON.stringify(v)}`);

// 7. suspicious "target" runOn on attacker tools
for (const {page,step} of steps) {
  if (step.runOn==="target" && step.commands.some(c=>/^(nmap|nxc|netexec|smbclient|ffuf|gobuster|hydra|impacket|enum4linux|curl|dig|nslookup|ssh)\b/.test(c.code.trim())))
    log(`RUNON-TARGET-TOOL ${page.slug}/${step.id}: ${step.commands[0].code.split("\n")[0].slice(0,80)}`);
}

// 8. commands with backslash continuation / multiline
for (const {page,step} of steps) for (const c of step.commands) {
  if (c.code.includes("\\\n")) log(`MULTILINE ${page.slug}/${step.id} lines=${c.code.split("\n").length}`);
}

// 9. destructive commands without a warning-ish field
const danger=/rm -rf|mkfs|dd if=|shutdown|reboot|DROP |truncate|chmod 777|net user .* \/add|reg add|schtasks|crontab|Stop-Service|wevtutil|vssadmin|bcdedit|Clear-EventLog|del \/f|format /i;
for (const {page,step} of steps) for (const c of step.commands) {
  if (danger.test(c.code)) {
    const f=step.fields||{};
    const warn=/warning|caution|destruct|affect|disrupt|avoid|do not/i.test(JSON.stringify(f));
    log(`DANGER ${warn?"warned":"NO-WARNING"} ${page.slug}/${step.id} :: ${c.code.split("\n")[0].slice(0,90)}`);
  }
}

// 10. status distribution per page
for (const p of pages) {
  const st=p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step"));
  const c=st.reduce((a,s)=>(a[s.status]=(a[s.status]||0)+1,a),{});
  log(`STATUS ${p.slug}: ${JSON.stringify(c)}`);
}

// 11. empty fields / placeholder leftovers
for (const {page,step} of steps) {
  if (/lorem|TODO|TBD|FIXME|xxx+$/i.test(step.title)) log(`PLACEHOLDER-TITLE ${step.id} ${step.title}`);
}
for (const {page,step} of steps) for (const c of step.commands) {
  if (/<[A-Z][A-Z0-9_]+>/.test(c.code)===false && /example\.com|10\.10\.10\.10|192\.168\.1\.|corp\.local/.test(c.code)) log(`HARDCODED ${page.slug}/${step.id} :: ${c.code.split("\n")[0].slice(0,90)}`);
}

// 12. alternatives structure
for (const {page,step} of steps) {
  if (step.commands.length>1) log(`MULTI-CMD ${page.slug}/${step.id} n=${step.commands.length} "${step.title}" langs=${step.commands.map(c=>c.lang).join("/")}`);
}

fs.writeFileSync("audit/evidence/static-audit.txt", out.join("\n")+"\n");
log(`\nWROTE ${out.length} lines`);
console.log(out.slice(-12).join("\n"));
