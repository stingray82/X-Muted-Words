
const $=id=>document.getElementById(id);
const repoUrl=$("repoUrl"),wordsEl=$("words"),countEl=$("count"),statusEl=$("status"),delayEl=$("delay"),retryEl=$("retry");

function parseWords(text){
  const seen=new Set();
  return String(text||"").split(/\r?\n/).map(x=>x.trim())
    .map(x=>x.replace(/^[-*+]\s+/,"").replace(/^\d+\.\s+/,"").replace(/^`+|`+$/g,"").trim())
    .filter(x=>x && !x.startsWith("# ") && x!=="```")
    .filter(x=>{const k=x.toLowerCase();if(seen.has(k))return false;seen.add(k);return true;});
}

function refresh(){countEl.textContent=`${parseWords(wordsEl.value).length} items`;}
wordsEl.addEventListener("input",refresh);

async function activeXTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id||!/^https:\/\/(x|twitter)\.com\//.test(tab.url||"")){
    throw new Error("Open x.com in the active tab first.");
  }
  return tab;
}

async function loadBuiltin(){
  const text=await fetch(chrome.runtime.getURL("words.txt")).then(r=>r.text());
  wordsEl.value=parseWords(text).join("\n");
  refresh();
  statusEl.textContent="Built-in list loaded.";
}
$("loadBuiltin").onclick=loadBuiltin;

$("loadRemote").onclick=async()=>{
  const url=repoUrl.value.trim();
  if(!url){statusEl.textContent="Paste a raw GitHub URL first.";return;}
  statusEl.textContent="Loading repo list…";
  const r=await chrome.runtime.sendMessage({type:"FETCH_WORDS",url});
  if(!r?.ok){statusEl.textContent=`Load failed: ${r?.error||"unknown error"}`;return;}
  wordsEl.value=parseWords(r.text).join("\n");
  refresh();
  await chrome.storage.local.set({repoUrl:url,words:wordsEl.value});
  statusEl.textContent="Repo list loaded.";
};

$("scan").onclick=async()=>{
  try{
    const tab=await activeXTab();
    statusEl.textContent="Scanning X muted words…";
    const r=await chrome.tabs.sendMessage(tab.id,{type:"SCAN_MUTED_WORDS"});
    if(!r?.ok)throw new Error(r?.error||"Scan failed");
    statusEl.textContent=`Found ${r.existing.length} currently muted words.`;
  }catch(e){
    statusEl.textContent=e?.message||String(e);
  }
};

async function persistSettings(){
  await chrome.storage.local.set({
    repoUrl:repoUrl.value.trim(),
    words:wordsEl.value,
    delay:delayEl.value,
    retry:retryEl.checked
  });
}

$("startAdd").onclick=async()=>{
  const words=parseWords(wordsEl.value);
  if(!words.length){statusEl.textContent="No words to add.";return;}

  try{
    const tab=await activeXTab();
    await persistSettings();
    const r=await chrome.tabs.sendMessage(tab.id,{
      type:"START_BULK_MUTE",
      words,
      delay:Number(delayEl.value),
      retry:retryEl.checked
    });
    statusEl.textContent=r?.message||"Started.";
  }catch(e){
    statusEl.textContent=e?.message||"Reload the X tab once, then try again.";
  }
};

$("startUnmute").onclick=async()=>{
  const words=parseWords(wordsEl.value);
  if(!words.length){statusEl.textContent="No words to unmute.";return;}

  try{
    const tab=await activeXTab();
    await persistSettings();
    const r=await chrome.tabs.sendMessage(tab.id,{
      type:"START_BULK_UNMUTE",
      words,
      delay:Number(delayEl.value),
      retry:retryEl.checked
    });
    statusEl.textContent=r?.message||"Bulk unmute started.";
  }catch(e){
    statusEl.textContent=e?.message||"Reload the X tab once, then try again.";
  }
};

$("stop").onclick=async()=>{
  try{
    const tab=await activeXTab();
    await chrome.tabs.sendMessage(tab.id,{type:"STOP_BULK_MUTE"});
  }catch{}
  statusEl.textContent="Stop requested.";
};

$("reset").onclick=async()=>{
  await chrome.storage.local.remove([
    "bulkMuteIndex",
    "bulkMuteBackoffMinutes",
    "bulkMuteCooldownUntil",
    "bulkMuteCooldownReason"
  ]);
  statusEl.textContent="Saved progress reset.";
};

(async()=>{
  const s=await chrome.storage.local.get([
    "repoUrl","words","delay","retry",
    "bulkMuteIndex","bulkMuteBackoffMinutes","bulkMuteCooldownUntil"
  ]);

  if(s.repoUrl)repoUrl.value=s.repoUrl;
  if(s.delay)delayEl.value=s.delay;
  if(typeof s.retry==="boolean")retryEl.checked=s.retry;

  if(s.words){
    wordsEl.value=s.words;
    refresh();
  }else{
    await loadBuiltin();
  }

  if(Number(s.bulkMuteCooldownUntil)>Date.now()){
    const mins=Math.ceil((Number(s.bulkMuteCooldownUntil)-Date.now())/60000);
    statusEl.textContent=`Rate-limit cooldown active: about ${mins} minute(s) remaining.`;
  }
})();
