import fs from "node:fs";
import path from "node:path";
import { decode } from "node:querystring";
const { pages } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const decodeEnt = s => s.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'");
let totalFences=0, totalData=0, missing=[], extra=[];
for (const p of pages) {
  if (p.generated) continue; // generated pages have no source export
  const raw = decodeEnt(fs.readFileSync(path.join("content/raw",p.slug+".html"),"utf8"));
  const fences=[];
  const re=/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let m;
  while((m=re.exec(raw))) fences.push(m[2].replace(/\n$/,""));
  const data=[];
  for (const s of p.sections) for (const b of s.blocks) {
    if (b.type==="step") {
      for (const c of b.commands||[]) data.push({code:c.code, src:`${b.id}/cmd`});
      for (const o of b.outputs||[]) data.push({code:o.code, src:`${b.id}/out`});
    } else if (b.type==="code") data.push({code:b.code, src:"page/code"});
    else if (b.type==="output") data.push({code:b.code, src:"page/out"});
  }
  totalFences+=fences.length; totalData+=data.length;
  const norm = x=>x.replace(/\r/g,"").trim();
  const fenceSet = new Map(fences.map(f=>[norm(f),f]));
  const dataSet = new Set(data.map(d=>norm(d.code)));
  for (const f of fences) if(!dataSet.has(norm(f))) {
    // try find approximate (backslash-tag-loss)
    const approx=[...dataSet].find(d=>d.replace(/\s+/g,"").slice(0,60)===norm(f).replace(/\s+/g,"").slice(0,60));
    missing.push({page:p.slug, src:approx?"approx-match":undefined, fence:f.slice(0,300)});
  }
  for (const d of data) if(!fenceSet.has(norm(d.code))) {
    const approx=[...fenceSet.keys()].find(k=>k.replace(/\s+/g,"").slice(0,60)===norm(d.code).replace(/\s+/g,"").slice(0,60));
    extra.push({page:p.slug, src:d.src, code:d.code.slice(0,300), approx:approx?"approx-match":undefined});
  }
}
console.log(`fences=${totalFences} data_blocks=${totalData} missing=${missing.length} extra=${extra.length}`);
for(const x of missing) console.log("\n[FENCE NOT IN DATA]",x.page,x.src||"",JSON.stringify(x.fence.slice(0,200)));
for(const x of extra) console.log("\n[DATA NOT IN FENCE]",x.page,x.src,x.approx||"",JSON.stringify(x.code.slice(0,200)));
