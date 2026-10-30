import puppeteer from "puppeteer-core";
const BASE="http://127.0.0.1:8124/";
const browser=await puppeteer.launch({executablePath:"/usr/bin/chromium",headless:"new",args:["--no-sandbox","--disable-dev-shm-usage"]});
const page=await browser.newPage(); await page.setViewport({width:1440,height:1000});
const errors=[]; page.on("pageerror",e=>errors.push(String(e))); page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
const checks=[
 ["#/p/http","#http-06","openssl s_client -connect <TARGET_IP>:443 -servername <DOMAIN> </dev/null 2>/dev/null"],
 ["#/p/active-directory","#active-directory-18","-delegate-to '<TARGET_COMPUTER$>'"],
 ["#/p/linux-privesc","#linux-privesc-08","<python3> -c 'print(open(\"/etc/shadow\").read())'"],
 ["#/p/windows-privesc","#windows-privesc-15","Get-Acl HKLM:\\SOFTWARE\\<VENDOR> | Format-List"],
 ["#/p/other-services","#other-services-07","SELECT LOAD_FILE('/etc/passwd');"],
 ["#/p/shells","#shells-14","[Convert]::FromBase64String"],
 ["#/p/exam-execution","#exam-execution-05","type C:\\Users\\Administrator\\Desktop\\proof.txt 2>nul"],
 ["#/p/machine-notes","#machine-notes-01","<command>"]
];
for(const [hash,sel,needle] of checks){
  await page.goto(BASE+hash,{waitUntil:"networkidle0"}); await page.waitForSelector(sel);
  const text=(await page.$$eval(sel+" .code-block code",els=>els.map(e=>e.textContent))).join("\n");
  console.log((text.includes(needle)?"OK  ":"FAIL")+" "+sel+" :: "+text.split("\n")[0].slice(0,90));
  if(!text.includes(needle)) console.log("   got:",JSON.stringify(text));
}
await page.goto(BASE+"#/p/shells",{waitUntil:"networkidle0"});
const langs=await page.$$eval("#shells-15 .lang",els=>els.map(e=>e.textContent));
console.log("shells-15 langs:",JSON.stringify(langs));
console.log("errors:",errors.length,errors.slice(0,3));
await browser.close();
