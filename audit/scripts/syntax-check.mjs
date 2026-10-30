import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { applyVariables, buildAliasIndex } from "../../assets/engine.js";
const { pages } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const { variables } = JSON.parse(fs.readFileSync("data/variables.json","utf8"));
const aliasIndex = buildAliasIndex(variables);
const values = { TARGET_IP:"10.10.10.10", ATTACKER_IP:"10.10.14.5", DOMAIN:"corp.local", DOMAIN_CONTROLLER_IP:"10.10.10.10",
  DOMAIN_PART1:"corp", DOMAIN_PART2:"local", TARGET_HOST:"fileserver", DC_HOSTNAME:"dc01", USERNAME:"alice",
  PASSWORD:"Passw0rd!", NEW_PASSWORD:"N3wPass!", NTHASH:"aad3b435b51404eeaad3b435b51404ee", SHARE_NAME:"share",
  TARGET_PORT:"445", LOCAL_PORT:"4444", REMOTE_PORT:"8080", ATTACKER_IP2:"10.10.14.5", KEY_FILE:"key", OUTPUT_FILE:"out", OUTPUT_DIR:"/tmp/out",
  WORDLIST:"/usr/share/wordlists/rockyou.txt", USERLIST:"users.txt", FILE:"file", PATH:"/tmp", SUBDIR:"sub", HASH_FILE:"hash.txt",
  TARGET_USER:"bob", TARGET_GROUP:"grp", GROUP:"grp", SERVICE_NAME:"svc", SERVICE:"svc", SERVICE_PORT:"80", PRODUCT:"p", VENDOR:"v",
  VERSION:"1", KEYWORD:"smb", INTERFACE:"tun0", RANDOM:"x1y2", BASELINE_SIZE:"1234", DEFAULT_VHOST_SIZE:"1234", COOKIE_VALUE:"abc",
  TOKEN:"abc", BASE64_BLOB:"AAAA", ASREP_KEY:"00", CA_NAME:"CORP-CA", CA_HOSTNAME:"ca01", TEMPLATE:"User", BINARY:"bin",
  WHAT:"whoami", TLD:"local", PIVOT_IP:"10.10.20.5", PIVOT1_IP:"10.10.20.5", PIVOT2_IP:"10.10.30.5", INTERNAL_IP:"10.10.20.10",
  HASH:"deadbeef", HTTP_PORT:"80", STEP:"1", EDb_ID:"1", EDB_ID:"1", PATH2:"x" };
const results=[];
for (const p of pages) for (const s of p.sections) for (const b of s.blocks) {
  if (b.type!=="step") continue;
  for (const c of b.commands||[]) {
    if (!["bash","shen","shell","sh","console"].includes(c.lang) && c.lang!=="") { results.push({id:b.id,lang:c.lang,ok:true,skipped:true}); continue; }
    const { text, missing } = applyVariables(c.code, values, aliasIndex);
    const tmp="/tmp/oscp-syntax-"+process.pid+".sh";
    fs.writeFileSync(tmp, text+"\n");
    let ok=true, err="";
    try { execFileSync("bash",["-n",tmp],{stdio:"pipe"}); } catch(e) { ok=false; err=String(e.stderr||e.message).split("\n").slice(0,3).join(" | "); }
    results.push({id:b.id,page:p.slug,lang:c.lang||"bash",ok,err,code:text,missing});
  }
}
const fails=results.filter(r=>!r.ok);
const skipped=results.filter(r=>r.skipped);
console.log(`checked=${results.length-skipped.length} failed=${fails.length} skipped(non-bash)=${skipped.length}`);
for(const f of fails) console.log(`\nFAIL ${f.page}/${f.id} [${f.lang}] ${f.err}\n${f.code}`);
fs.writeFileSync("audit/evidence/syntax-check.json",JSON.stringify({checked:results.length,failed:fails.length,fails},null,1));
