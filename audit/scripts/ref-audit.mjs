import fs from "node:fs";
const { pages } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const out=[]; const log=(...a)=>out.push(a.join(" "));
const byNum = new Map(); // page -> n -> step
for (const p of pages) {
  const m=new Map(p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step")).map(b=>[String(b.n),b]));
  byNum.set(p.slug,m);
}
log("# STEP REFERENCES");
for (const p of pages) {
  const own=byNum.get(p.slug);
  for (const s of p.sections) for (const b of s.blocks) {
    if (b.type!=="step") continue;
    const text=[...Object.entries(b.fields||{}).map(([k,v])=>`${k}=${v}`), b.notes||""].join("\n");
    for (const m of text.matchAll(/\bSteps?\s+(\d{1,2}[a-z]?)(?:\s*[-–]\s*(\d{1,2}[a-z]?))?/g)) {
      const refs=[m[1],m[2]].filter(Boolean);
      for (const r of refs) {
        const t=own.get(r);
        log(`${b.id} -> Step ${r} ${t?`= "${t.title}"`:"*** MISSING ON PAGE ***"}`);
      }
    }
    // other page references by name
    for (const m of text.matchAll(/([A-Z][A-Za-z &\/]+?) — Complete Command Reference/g)) {
      const name=m[1].trim();
      const match=pages.find(x=>x.title.startsWith(name));
      if(!match) log(`${b.id} -> PAGE "${name} — Complete Command Reference" *** NOT FOUND ***`);
    }
    for (const m of text.matchAll(/#\/p\/([a-z0-9-]+)/g)) {
      if(!pages.some(x=>x.slug===m[1])) log(`${b.id} -> LINK #/p/${m[1]} *** NOT FOUND ***`);
    }
    if (/\(batch \d\)/.test(text)) log(`${b.id} -> BATCH REF ${text.match(/\(batch \d\)/)[0]}`);
  }
}
// sections referenced as "Section C" / "section I"
log("\n# SECTION REFERENCES");
for (const p of pages) {
  const sections=p.sections.map(s=>s.title);
  for (const s of p.sections) for (const b of s.blocks) {
    if (b.type!=="step") continue;
    const text=[...Object.values(b.fields||{}),b.notes||""].join(" ");
    for (const m of text.matchAll(/\b[Ss]ection ([A-Z])\b/g)) {
      const found=sections.some(t=>new RegExp(`^${m[1]}\\.`).test(t));
      if(!found) log(`${b.id} -> Section ${m[1]} *** NOT FOUND *** sections=${JSON.stringify(sections)}`);
    }
  }
}
fs.writeFileSync("audit/evidence/ref-audit.txt",out.join("\n")+"\n");
console.log(out.filter(l=>l.includes("***")).join("\n")||"(no missing refs)");
console.log("total lines",out.length);
