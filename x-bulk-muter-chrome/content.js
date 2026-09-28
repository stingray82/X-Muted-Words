
(()=>{
  if(window.__xBulkMuterV18)return;
  window.__xBulkMuterV18=true;

  let stopped=false,running=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function norm(v){
    return String(v||"").trim().replace(/\s+/g," ").toLocaleLowerCase();
  }

  function setNativeValue(input,value){
    const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
    d.set.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  }

  async function waitFor(sel,timeout=15000){
    const start=Date.now();
    while(Date.now()-start<timeout){
      if(stopped)throw new Error("Stopped");
      const el=document.querySelector(sel);
      if(el)return el;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${sel}`);
  }

  function bodyText(){ return (document.body?.innerText||"").toLowerCase(); }

  function looksRateLimited(){
    const t=bodyText();
    return t.includes("rate limit") ||
           t.includes("too many requests") ||
           t.includes("try again later") ||
           t.includes("429") ||
           t.includes("4209");
  }

  async function recentNetworkRateLimit(sinceMs=0,windowMs=30000){
    const s=await chrome.storage.local.get([
      "networkRateLimitAt","networkRateLimitStatus","networkRateLimitUrl"
    ]);
    const at=Number(s.networkRateLimitAt)||0;
    if(at && at>=sinceMs && Date.now()-at<=windowMs){
      return {at,status:s.networkRateLimitStatus,url:s.networkRateLimitUrl};
    }
    return null;
  }

  function onMutedList(){ return location.pathname.includes("/settings/muted_keywords"); }
  function onAddMutedWord(){ return location.pathname.includes("/settings/add_muted_keyword"); }

  async function spaBackToList(){
    if(onMutedList())return true;

    const back=document.querySelector('button[data-testid="app-bar-back"]');
    if(back){
      back.click();
      const start=Date.now();
      while(Date.now()-start<12000){
        if(onMutedList()){
          await waitFor('a[href="/settings/add_muted_keyword"]',12000);
          return true;
        }
        await sleep(200);
      }
    }
    return false;
  }

  async function goList(){
    if(onMutedList()){
      await waitFor('a[href="/settings/add_muted_keyword"]',15000);
      return;
    }

    // Prefer X's SPA back button so this content-script context survives.
    if(await spaBackToList())return;

    // Fallback full navigation. Durable job state allows the next content
    // script instance to auto-resume.
    location.href="/settings/muted_keywords";
    throw new Error("navigation-resume");
  }

  async function clickAdd(){
    await goList();
    const add=await waitFor('a[href="/settings/add_muted_keyword"]');
    add.click();
    await waitFor('input[name="keyword"]',15000);
  }

  function getMutedRows(){
    const rows=[];
    document.querySelectorAll('button[aria-label="Unmute"]').forEach(btn=>{
      const row=btn.closest('[role="link"]');
      if(!row)return;

      const lines=(row.innerText||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
      const durations=new Set(["forever","24 hours","7 days","30 days"]);
      const candidates=lines.filter(x=>{
        const n=norm(x);
        return n && n!=="unmute" && !durations.has(n);
      });
      if(!candidates.length)return;

      rows.push({word:candidates[0],key:norm(candidates[0]),row,button:btn});
    });
    return rows;
  }

  async function scanExisting(){
    if(!onMutedList())await goList();
    await sleep(900);
    const seen=new Set(),out=[];
    for(const r of getMutedRows()){
      if(!seen.has(r.key)){ seen.add(r.key); out.push(r.word); }
    }
    return out;
  }

  async function setJobPatch(patch){
    const s=await chrome.storage.local.get(["bulkJob"]);
    const job=s.bulkJob||{};
    await chrome.storage.local.set({bulkJob:{...job,...patch}});
  }

  async function getJob(){
    return (await chrome.storage.local.get(["bulkJob"])).bulkJob||null;
  }

  async function waitDurably(ms,reason){
    const until=Date.now()+ms;
    await setJobPatch({cooldownUntil:until});
    await chrome.storage.local.set({
      bulkMuteCooldownUntil:until,
      bulkMuteCooldownReason:reason||"429"
    });

    console.warn(`[X Bulk Muter] Cooling down ${Math.ceil(ms/60000)} minute(s)`);

    while(Date.now()<until){
      const job=await getJob();
      if(stopped || job?.active===false)throw new Error("Stopped");
      await sleep(Math.min(5000,Math.max(1,until-Date.now())));
    }

    await setJobPatch({cooldownUntil:0});
    await chrome.storage.local.remove(["bulkMuteCooldownUntil","bulkMuteCooldownReason"]);
  }

  async function restoreOutstandingCooldown(){
    const job=await getJob();
    const until=Number(job?.cooldownUntil)||0;
    if(until>Date.now()){
      console.warn(`[X Bulk Muter] Resuming stored cooldown: ${Math.ceil((until-Date.now())/60000)} minute(s) left`);
      await waitDurably(until-Date.now(),"429");
    }
  }

  async function addOne(word,delay){
    if(!onAddMutedWord())await clickAdd();

    const input=await waitFor('input[name="keyword"]');
    setNativeValue(input,word);
    await sleep(500);

    const save=await waitFor('button[data-testid="settingsDetailSave"]');
    const enableStart=Date.now();
    while((save.disabled||save.getAttribute("aria-disabled")==="true") &&
          Date.now()-enableStart<5000){
      await sleep(150);
    }
    if(save.disabled||save.getAttribute("aria-disabled")==="true")
      throw new Error("save-disabled");

    await setJobPatch({pendingWord:word});
    const saveStartedAt=Date.now();
    await chrome.runtime.sendMessage({type:"CLEAR_RATE_LIMIT_STATE"}).catch(()=>{});
    save.click();

    const start=Date.now();
    while(Date.now()-start<12000){
      const networkLimit=await recentNetworkRateLimit(saveStartedAt,30000);
      if(networkLimit)throw new Error(`rate-limit-http-${networkLimit.status||"unknown"}`);
      if(looksRateLimited())throw new Error("rate-limit-ui");

      if(onMutedList()){
        await sleep(900);
        const current=new Set((await scanExisting()).map(norm));
        if(current.has(norm(word))){
          await setJobPatch({pendingWord:null});
          await sleep(delay);
          return true;
        }

        const late=await recentNetworkRateLimit(saveStartedAt,30000);
        if(late)throw new Error(`rate-limit-http-${late.status||"unknown"}`);
        throw new Error("save-not-confirmed");
      }
      await sleep(250);
    }
    throw new Error("save-timeout");
  }

  async function recoverRateLimit(word){
    const job=await getJob();
    const next=Math.min(20,(Number(job?.backoffMinutes)||0)+1);

    await setJobPatch({
      backoffMinutes:next,
      pendingWord:word
    });

    // Important: WAIT BEFORE any fallback hard navigation.
    await waitDurably(next*60*1000,"429");

    // Clear stale network event only after cooldown.
    await chrome.runtime.sendMessage({type:"CLEAR_RATE_LIMIT_STATE"}).catch(()=>{});

    // Then get back to the list using SPA navigation where possible.
    if(!onMutedList()){
      try{
        await goList();
      }catch(e){
        if(String(e?.message||e)==="navigation-resume")return "navigation";
        throw e;
      }
    }
    return "ready";
  }

  async function runAdd(words,delay,retry,resume=false){
    await restoreOutstandingCooldown();

    let job=await getJob();
    let backoff=Number(job?.backoffMinutes)||0;

    if(!onMutedList() && !onAddMutedWord()){
      try{ await goList(); }catch(e){
        if(String(e?.message||e)==="navigation-resume")return;
        throw e;
      }
    }

    // Build a fresh queue from what is actually missing each time. This makes
    // reload/resume idempotent and avoids relying on a fragile numeric index.
    if(onAddMutedWord()){
      // If we resumed on the add page with a pending word, retry that exact word.
      job=await getJob();
      if(job?.pendingWord){
        words=[job.pendingWord,...words.filter(w=>norm(w)!==norm(job.pendingWord))];
      }else{
        try{ await goList(); }catch(e){
          if(String(e?.message||e)==="navigation-resume")return;
          throw e;
        }
      }
    }

    const existingSet=new Set((await scanExisting()).map(norm));
    const queue=[];
    const seen=new Set();
    for(const raw of words){
      const key=norm(raw);
      if(!key||seen.has(key)||existingSet.has(key))continue;
      seen.add(key);
      queue.push(raw);
    }

    await setJobPatch({
      active:true, mode:"add", words, delay, retry,
      totalRemaining:queue.length
    });

    let i=0;
    while(i<queue.length && !stopped){
      const activeJob=await getJob();
      if(activeJob?.active===false)break;

      const word=queue[i];
      try{
        console.log(`[X Bulk Muter] ADD ${i+1}/${queue.length}: ${word}`);
        await addOne(word,delay);

        i++;
        backoff=0;
        await setJobPatch({
          backoffMinutes:0,
          pendingWord:null,
          completed:(Number(activeJob?.completed)||0)+1
        });
      }catch(err){
        if(stopped)break;
        const emsg=String(err?.message||err);

        if(emsg==="navigation-resume")return;

        const limited=emsg.includes("rate-limit") ||
                      emsg.includes("http-429") ||
                      emsg.includes("http-420") ||
                      looksRateLimited();

        console.warn(`[X Bulk Muter] Add failed "${word}": ${emsg}`);

        if(limited){
          const r=await recoverRateLimit(word);
          if(r==="navigation")return;
          continue; // exact same word
        }

        // Generic failure: return to list, verify whether it secretly succeeded.
        try{ await goList(); }catch(e){
          if(String(e?.message||e)==="navigation-resume")return;
        }
        await sleep(10000);
        const current=new Set((await scanExisting()).map(norm));
        if(current.has(norm(word))){
          i++;
          await setJobPatch({pendingWord:null});
          continue;
        }

        if(!retry){
          i++;
          await setJobPatch({pendingWord:null});
        }
      }
    }

    if(i>=queue.length){
      await setJobPatch({
        active:false,
        pendingWord:null,
        cooldownUntil:0,
        backoffMinutes:0,
        totalRemaining:0
      });
      console.log("[X Bulk Muter] Add complete");
    }
  }

  async function unmuteOne(targetKey,delay){
    if(!onMutedList())await goList();
    await sleep(500);

    const match=getMutedRows().find(r=>r.key===targetKey);
    if(!match)return {found:false};

    const started=Date.now();
    await chrome.runtime.sendMessage({type:"CLEAR_RATE_LIMIT_STATE"}).catch(()=>{});
    match.button.click();
    await sleep(500);

    for(const sel of [
      'button[data-testid="confirmationSheetConfirm"]',
      'button[data-testid="confirm"]'
    ]){
      const b=document.querySelector(sel);
      if(b){b.click();break;}
    }

    const start=Date.now();
    while(Date.now()-start<8000){
      const networkLimit=await recentNetworkRateLimit(started,30000);
      if(networkLimit)throw new Error(`rate-limit-http-${networkLimit.status||"unknown"}`);

      if(!getMutedRows().some(r=>r.key===targetKey)){
        await sleep(delay);
        return {found:true,removed:true};
      }
      await sleep(250);
    }
    return {found:true,removed:false};
  }

  async function runUnmute(words,delay,retry){
    await restoreOutstandingCooldown();
    if(!onMutedList()){
      try{await goList();}catch(e){
        if(String(e?.message||e)==="navigation-resume")return;
        throw e;
      }
    }

    const targets=[...new Map(words.map(w=>[norm(w),w]).filter(([k])=>k)).entries()]
      .map(([key,raw])=>({key,raw}));

    let i=0;
    while(i<targets.length && !stopped){
      const job=await getJob();
      if(job?.active===false)break;

      const t=targets[i];
      try{
        console.log(`[X Bulk Muter] UNMUTE ${i+1}/${targets.length}: ${t.raw}`);
        const r=await unmuteOne(t.key,delay);
        if(!r.found || r.removed){
          i++;
          await setJobPatch({backoffMinutes:0,pendingWord:null});
          continue;
        }
        throw new Error("unmute-timeout");
      }catch(err){
        const emsg=String(err?.message||err);
        const limited=emsg.includes("rate-limit")||emsg.includes("http-429")||
                      emsg.includes("http-420")||looksRateLimited();
        if(limited){
          await setJobPatch({pendingWord:t.raw});
          const r=await recoverRateLimit(t.raw);
          if(r==="navigation")return;
          continue;
        }
        if(!retry)i++;
        else await sleep(10000);
      }
    }

    if(i>=targets.length){
      await setJobPatch({active:false,pendingWord:null,cooldownUntil:0,backoffMinutes:0});
      console.log("[X Bulk Muter] Unmute complete");
    }
  }

  async function startJob(mode,words,delay,retry){
    if(running)return;
    running=true;
    stopped=false;
    try{
      if(mode==="add")await runAdd(words,delay,retry);
      else await runUnmute(words,delay,retry);
    }finally{
      running=false;
    }
  }

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg?.type==="STOP_BULK_MUTE"){
      stopped=true;
      setJobPatch({active:false}).finally(()=>sendResponse({ok:true}));
      return true;
    }

    if(msg?.type==="SCAN_MUTED_WORDS"){
      (async()=>{
        try{sendResponse({ok:true,existing:await scanExisting()});}
        catch(e){sendResponse({ok:false,error:e?.message||String(e)});}
      })();
      return true;
    }

    if(msg?.type==="START_BULK_MUTE"){
      if(running){sendResponse({ok:false,message:"Already running."});return;}
      sendResponse({ok:true,message:"Persistent add job started. It will resume across page navigation and 429 cooldowns."});
      startJob("add",msg.words||[],Math.max(6000,Number(msg.delay)||20000),msg.retry!==false);
      return true;
    }

    if(msg?.type==="START_BULK_UNMUTE"){
      if(running){sendResponse({ok:false,message:"Already running."});return;}
      sendResponse({ok:true,message:"Persistent bulk-unmute job started."});
      startJob("unmute",msg.words||[],Math.max(6000,Number(msg.delay)||20000),msg.retry!==false);
      return true;
    }
  });

  // AUTO-RESUME:
  // Full X navigation destroys the old content script. A new instance picks up
  // the durable job and resumes it without requiring the popup to be clicked.
  (async()=>{
    await sleep(1000);
    const job=await getJob();
    if(job?.active && Array.isArray(job.words) && job.words.length){
      console.warn("[X Bulk Muter] Resuming persisted job after navigation/reload");
      startJob(
        job.mode==="unmute"?"unmute":"add",
        job.words,
        Math.max(6000,Number(job.delay)||20000),
        job.retry!==false
      );
    }
  })();
})();
