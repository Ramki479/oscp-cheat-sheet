import fs from "node:fs";
import { execFileSync } from "node:child_process";
const { pages } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const steps = pages.flatMap(p=>p.sections.flatMap(s=>s.blocks.filter(b=>b.type==="step").map(b=>({p,step:b}))));
const skip = new Set(["#","cd","ls","cat","echo","printf","find","grep","head","tail","wc","mkdir","cp","mv","rm","chmod","chown","export","for","do","done","type","dir","whoami","ipconfig","id","ps","ss","netstat","tasklist","uname","getent","systemctl","crontab","file","strings","ssh-keygen","openssl","curl","wget","nc","ncat","socat","scp","ssh","sshpass","ftp","telnet","python","python3","pip","pip3","git","sudo","su","runas","reg","sc","net","wmic","powershell","cmd","klist","kinit","msfconsole","msfvenom","use","set","run","shell","exec","type","del","copy","dir","base64","certutil","tar","zip","unzip","env","which","sudo","socat","proxychains4","xsltproc","smbserver.py","secretsdump.py","rpcdump.py","ntlmrelayx.py","certipy","bloodhound","neo4j","node"]);
const bins = new Map();
for (const {p,step} of steps) for (const c of step.commands) {
  for (const rawLine of c.code.split("\n")) {
    const line = rawLine.trim().replace(/^#\s*/,"");
    if (!line) continue;
    let m = line.match(/^sudo\s+(?:-\S+\s+)*([\w./-]+)/) || line.match(/^([\w][\w.+-]*)/);
    if (!m) continue;
    let bin = m[1].replace(/^\.\//,"").replace(/^.*\//,"");
    if (line.startsWith("$")||line.startsWith(">")) continue;
    if (bin.includes("=") || /^\d/.test(bin)) continue;
    if (!bins.has(bin)) bins.set(bin, new Set());
    bins.get(bin).add(step.id);
  }
}
const have = new Map();
for (const bin of [...bins.keys()].sort()) {
  let found=false;
  try { execFileSync("bash",["-lc",`command -v ${JSON.stringify(bin)}`],{stdio:"ignore"}); found=true; } catch {}
  have.set(bin,found);
}
const missing=[...have].filter(([,v])=>!v).map(([k])=>k);
const present=[...have].filter(([,v])=>v).map(([k])=>k);
console.log("PRESENT",present.length,"MISSING",missing.length);
console.log("MISSING:",missing.join(", "));
fs.writeFileSync("audit/evidence/tool-inventory.txt",
  "PRESENT ("+present.length+"):\n"+present.join(", ")+"\n\nMISSING ("+missing.length+"):\n"+missing.join(", ")+"\n\n"+
  [...missing].map(b=>`${b}: used by ${[...bins.get(b)].join(", ")}`).join("\n")+"\n");
