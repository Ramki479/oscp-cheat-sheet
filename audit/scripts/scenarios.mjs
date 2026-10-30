import fs from "node:fs";
import { execSync } from "node:child_process";
const { pages } = JSON.parse(fs.readFileSync("data/commands.json","utf8"));
const stepById = new Map();
for (const p of pages) for (const s of p.sections) for (const b of s.blocks) if (b.type==="step") stepById.set(b.id,{...b,page:p.slug});
const site = (id)=>stepById.get(id)?.commands.map(c=>c.code).join("\n---\n") ?? "MISSING";
const evidence=[];
function run(scenario, stepId, label, cmd, {timeout=45, cwd="/tmp/oscp-lab"}={}) {
  const started=Date.now();
  let status=0, output="";
  try {
    output=execSync(cmd,{cwd,shell:"/bin/bash",timeout:timeout*1000,stdio:["ignore","pipe","pipe"],encoding:"utf8"});
  } catch(e) {
    status=e.status ?? "timeout/err";
    output=(e.stdout||"")+(e.stderr||"")+(e.signal?`\n[signal ${e.signal}]`:"");
  }
  const rec={scenario,stepId,label,site_command:site(stepId),executed_command:cmd,exit:status,duration_ms:Date.now()-started,output:output.trim().slice(0,2500)};
  evidence.push(rec);
  console.log(`\n### ${scenario} ${stepId} :: ${label} :: exit=${status} (${rec.duration_ms}ms)\n$ ${cmd}\n${rec.output.slice(0,600)}`);
  return rec;
}
const S="S01";
run(S,"nmap-01","connectivity check (localhost instead of fictional 10.10.10.10)","ip a | head -5; ip route get 127.0.0.1; ping -c 3 127.0.0.1");
run(S,"nmap-02","create evidence dir",`mkdir -p /tmp/oscp-lab/out && cd /tmp/oscp-lab/out && pwd`);
run(S,"nmap-03","ping sweep on loopback /24","nmap -sn 127.0.0.1/24 -oN /tmp/oscp-lab/out/sweep.txt");
run(S,"nmap-06","targeted version/script scan against local services","nmap -sCV -p22,139,445,2121,8443 -oA /tmp/oscp-lab/out/local 127.0.0.1",{timeout:120});
run(S,"nmap-04","negative: closed port (site command uses sudo -sS, unavailable)","nmap -sT -T4 -p1 127.0.0.1");
run(S,"nmap-06","missing variable: literal unresolved token in a shell","nmap -sCV -p139,445 <TARGET_IP>");

const H="S02";
run(H,"http-03","fetch headers/body from local site server (site assumes :80)",`curl -i -sS http://127.0.0.1:8124/ | head -20`);
run(H,"http-03","TLS header request against local self-signed TLS",`curl -I -sS https://127.0.0.1:8443/ -k`);
run(H,"http-04","compare codes/sizes across paths",`for p in / /index.html /assets/app.js /nope; do printf '%-16s ' "$p"; curl -s -o /dev/null -w '%{http_code} %{size_download} %{redirect_url}\\n' "http://127.0.0.1:8124$p"; done`);
run(H,"http-05","read robots/sitemap/asset hints",`curl -sS http://127.0.0.1:8124/robots.txt | head -5; curl -sS http://127.0.0.1:8124/ | grep -Eo '(src|href)="[^"]+"' | sort -u | head -10`);
run(H,"http-02","whatweb fingerprint (site assumes :80)",`whatweb -a 1 http://127.0.0.1:8124/`);
fs.writeFileSync("/tmp/oscp-lab/words.txt","assets\nassets/app.js\ndata\nindex.html\nnope\nadmin\n");
run(H,"directory-vhost-03","ffuf content discovery with a small wordlist",`ffuf -u http://127.0.0.1:8124/FUZZ -w /tmp/oscp-lab/words.txt -mc 200,204,301,302,307,401,403 -ac -s`);
run(H,"directory-vhost-04","gobuster dir",`gobuster dir -u http://127.0.0.1:8124 -w /tmp/oscp-lab/words.txt -t 10`);
run(H,"http-03","negative: service on a closed port",`curl -i -sS --max-time 4 http://127.0.0.1:9999/`);

const B="S03";
run(B,"smb-01","confirm SMB version","nmap -sCV -p139,445 127.0.0.1",{timeout:90});
run(B,"smb-02","NSE SMB baseline",`nmap -p139,445 --script smb-os-discovery,smb-security-mode,smb2-security-mode,smb-enum-shares,smb-enum-users 127.0.0.1`,{timeout:120});
run(B,"smb-03","dialect and signing",`nmap -p445 --script smb2-security-mode,smb2-capabilities 127.0.0.1`,{timeout:90});
run(B,"smb-05","null-session share listing",`smbclient -N -L //127.0.0.1/`);
run(B,"smb-06","smbmap null/guest permission map",`smbmap -H 127.0.0.1 -u '' -p ''`);
run(B,"smb-07","NetExec null/guest pass",`timeout 30 nxc smb 127.0.0.1 -u '' -p '' --shares`,{timeout:45});
run(B,"smb-10","negative: nonexistent share",`smbclient -N //127.0.0.1/NOPE -c 'ls'`);

const D="S04";
run(D,"dns-01","confirm DNS on :53 (negative on this host)","nmap -sCV -p53 127.0.0.1",{timeout:60});
run(D,"dns-02","A/AAAA via local dnsmasq on :5353 (site assumes :53)",`dig @127.0.0.1 -p 5353 corp.local A +short; dig @127.0.0.1 -p 5353 corp.local AAAA +short`);
run(D,"dns-03","NS/MX/TXT/SOA via :5353",`dig @127.0.0.1 -p 5353 corp.local NS +short; dig @127.0.0.1 -p 5353 corp.local MX +short; dig @127.0.0.1 -p 5353 corp.local TXT +short; dig @127.0.0.1 -p 5353 corp.local SOA +short`);
run(D,"dns-05","AXFR attempt",`dig axfr @127.0.0.1 -p 5353 corp.local`);
run(D,"dns-02","negative: no resolver on :53",`dig @127.0.0.1 corp.local A +short`);

const F="S05";
run(F,"ftp-01","confirm FTP on adapted port 2121","nmap -sCV -p2121 127.0.0.1",{timeout:60});
run(F,"ftp-02","FTP NSE checks",`nmap -p2121 --script ftp-anon,ftp-syst,ftp-vsftpd-backdoor 127.0.0.1`,{timeout:90});
run(F,"ftp-07","mirror anonymous FTP",`rm -rf /tmp/oscp-lab/mirror && mkdir -p /tmp/oscp-lab/mirror && cd /tmp/oscp-lab/mirror && wget -m ftp://anonymous:anonymous@127.0.0.1:2121/ 2>&1 | tail -8 && find . -type f`);
run(F,"ftp-09","triage downloaded files",`cd /tmp/oscp-lab/mirror && find . -type f -exec file {} + && grep -RIn -E 'pass|pwd|secret|token|key|user' .`);
run(F,"ftp-04","negative: bad FTP credentials",`curl -s --max-time 5 ftp://bad:bad@127.0.0.1:2121/`);

const K="S06";
run(K,"ssh-01","confirm SSH version","nmap -sV -p22 127.0.0.1",{timeout:60});
run(K,"ssh-02","ask for auth methods without a credential",`ssh -o PreferredAuthentications=none -o StrictHostKeyChecking=no -o BatchMode=yes ramki@127.0.0.1`);
run(K,"ssh-02","nmap auth-methods cross-check",`nmap -p22 --script ssh-auth-methods 127.0.0.1`,{timeout:60});
run(K,"ssh-10","algorithm list",`nmap -p22 --script ssh2-enum-algos 127.0.0.1`,{timeout:60});
run(K,"ssh-03","verbose trace (no credential supplied)",`ssh -v -o BatchMode=yes -o StrictHostKeyChecking=no ramki@127.0.0.1 2>&1 | tail -12`);
run(K,"ssh-04","environment check: sshpass prerequisite",`command -v sshpass || echo "sshpass NOT INSTALLED"`);

const L="S07";
run(L,"linux-privesc-01","identity and sudo rights",`timeout 8 bash -c 'id; whoami; sudo -l; sudo -V' 2>&1 | head -20`,{timeout:20,cwd:"/tmp"});
run(L,"linux-privesc-04","SUID enumeration",`timeout 40 find / -perm -4000 -type f 2>/dev/null | head -30`,{timeout:60,cwd:"/tmp"});
run(L,"linux-privesc-07","capabilities",`command -v getcap >/dev/null && timeout 30 getcap -r / 2>/dev/null | head -20 || echo "getcap NOT INSTALLED"`,{timeout:45,cwd:"/tmp"});
run(L,"linux-privesc-09","scheduled work",`cat /etc/crontab; ls -la /etc/cron.d /etc/cron.daily 2>/dev/null; crontab -l 2>/dev/null; systemctl list-timers --all 2>/dev/null | head -6`,{timeout:30,cwd:"/tmp"});
run(L,"linux-privesc-11","identity files permissions",`ls -la /etc/passwd /etc/shadow /etc/sudoers /etc/sudoers.d/ 2>/dev/null`,{timeout:20,cwd:"/tmp"});

const X="S08";
run(X,"active-directory-01","no DC in lab: SMB banner from local non-DC Samba",`nxc smb 127.0.0.1 2>&1 | head -8`,{timeout:45});
run(X,"active-directory-01","no DC in lab: LDAP SRV lookup",`dig @127.0.0.1 -p 5353 _ldap._tcp.corp.local SRV +short`,{timeout:20});

const R="S09";
run(R,"http-06","current shipped command (expected to fail)",`openssl s_client -connect 127.0.0.1:8443 -servername corp.local /dev/null | openssl x509 -noout -subject`,{timeout:20});
run(R,"http-06","corrected form with stdin redirect",`openssl s_client -connect 127.0.0.1:8443 -servername corp.local </dev/null 2>/dev/null | openssl x509 -noout -subject`,{timeout:20});
run(R,"linux-privesc-08","shipped capability command (interpreter lost by parser)","  -c 'print(open(\"/etc/shadow\").read())'",{timeout:10,cwd:"/tmp"});

const W="S10";
run(W,"directory-vhost-01","prerequisite check: wordlist paths",`ls /usr/share/seclists/Discovery/Web-Content/raft-medium-directories.txt /usr/share/wordlists/dirb/common.txt 2>&1`);
run(W,"directory-vhost-03","negative: missing wordlist path",`ffuf -u http://127.0.0.1:8124/FUZZ -w /tmp/oscp-lab/does-not-exist.txt -mc 200 -ac -s`,{timeout:30});
run(W,"directory-vhost-03","negative: closed web port",`ffuf -u http://127.0.0.1:9999/FUZZ -w /tmp/oscp-lab/words.txt -mc 200 -ac -s`,{timeout:30});
run(W,"http-12","negative: crawler tool absent",`command -v hakrawler || echo "hakrawler NOT INSTALLED"; command -v katana || echo "katana NOT INSTALLED"`);

const P="S11";
run(P,"windows-privesc-15","shipped Get-Acl command text (backslashes lost)",`bash -n -c 'Get-Acl HKLM:SOFTWARE<VENDOR> | Format-List' 2>&1 || true`);
run(P,"windows-privesc-05","service path lookup text on a Windows host (not executable here)","echo simulated");
fs.writeFileSync("audit/evidence/scenario-runs.json",JSON.stringify(evidence,null,2));
console.log(`\nTOTAL RUNS ${evidence.length}`);
