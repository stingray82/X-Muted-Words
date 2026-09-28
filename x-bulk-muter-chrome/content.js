
(()=>{
  if(window.__xBulkMuterV16)return;
  window.__xBulkMuterV16=true;

  let stopped=false,running=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));

  function norm(v){
    return String(v||"")
      .trim()
      .replace(/\s+/g," ")
      .toLocaleLowerCase();
  }

  function setNativeValue(input,value){
    const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value");
    d.set.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  }

  async function waitFor(sel,timeout=12000){
    const start=Date.now();
    while(Date.now()-start<timeout){
      if(stopped)throw new Error("Stopped");
      const el=document.querySelector(sel);
      if(el)return el;
      await sleep(150);
    }
    throw new Error(`Timed out waiting for ${sel}`);
  }

  function bodyText(){
    return (document.body?.innerText||"").toLowerCase();
  }

  function looksRateLimited(){
    const t=bodyText();
    return t.includes("rate limit") ||
           t.includes("too many requests") ||
           t.includes("try again later") ||
           t.includes("429");
  }

  function onMutedList(){
    return location.pathname.includes("/settings/muted_keywords");
  }

  function onAddMutedWord(){
    return location.pathname.includes("/settings/add_muted_keyword");
  }

  async function goList(){
    if(onMutedList()){
      await waitFor('a[href="/settings/add_muted_keyword"]',15000);
      return;
    }
    location.href="/settings/muted_keywords";
    await waitFor('a[href="/settings/add_muted_keyword"]',15000);
    await sleep(800);
  }

  async function clickAdd(){
    await goList();
    const add=await waitFor('a[href="/settings/add_muted_keyword"]');
    add.click();
    await waitFor('input[name="keyword"]',15000);
  }

  async function waitWithStatus(ms,reason){
    const until=Date.now()+ms;
    await chrome.storage.local.set({
      bulkMuteCooldownUntil:until,
      bulkMuteCooldownReason:reason||"rate-limit"
    });

    while(Date.now()<until){
      if(stopped)throw new Error("Stopped");
      await sleep(Math.min(5000,Math.max(1,until-Date.now())));
    }

    await chrome.storage.local.remove([
      "bulkMuteCooldownUntil",
      "bulkMuteCooldownReason"
    ]);
  }

  function getMutedRows(){
    const rows=[];

    document.querySelectorAll('button[aria-label="Unmute"]').forEach(btn=>{
      const row=btn.closest('[role="link"]');
      if(!row)return;

      const textLines=(row.innerText||"")
        .split(/\r?\n/)
        .map(x=>x.trim())
        .filter(Boolean);

      const durationLabels=new Set([
        "forever",
        "24 hours",
        "7 days",
        "30 days"
      ]);

      const candidates=textLines.filter(x=>{
        const n=norm(x);
        return n &&
               n!=="unmute" &&
               !durationLabels.has(n);
      });

      if(!candidates.length)return;

      const word=candidates[0];
      rows.push({
        word,
        key:norm(word),
        row,
        button:btn
      });
    });

    return rows;
  }

  async function scanExisting(){
    await goList();

    // Give X a moment to finish rendering the list.
    await sleep(1200);

    const rows=getMutedRows();
    const unique=[];
    const seen=new Set();

    for(const r of rows){
      if(!seen.has(r.key)){
        seen.add(r.key);
        unique.push(r.word);
      }
    }

    return unique;
  }

  async function addOne(word,delay){
    if(!onAddMutedWord()){
      await clickAdd();
    }

    const input=await waitFor('input[name="keyword"]');
    setNativeValue(input,word);
    await sleep(500);

    const save=await waitFor('button[data-testid="settingsDetailSave"]');
    const enableStart=Date.now();

    while((save.disabled||save.getAttribute("aria-disabled")==="true") &&
          Date.now()-enableStart<5000){
      if(stopped)throw new Error("Stopped");
      await sleep(150);
    }

    if(save.disabled||save.getAttribute("aria-disabled")==="true"){
      throw new Error("save-disabled");
    }

    save.click();

    const navStart=Date.now();
    while(Date.now()-navStart<10000){
      if(stopped)throw new Error("Stopped");

      if(onMutedList()){
        await sleep(delay);
        return true;
      }

      if(looksRateLimited()){
        throw new Error("rate-limit");
      }

      await sleep(250);
    }

    if(looksRateLimited())throw new Error("rate-limit");
    throw new Error("save-timeout");
  }

  async function unmuteOne(targetKey,delay){
    await goList();
    await sleep(600);

    const rows=getMutedRows();
    const match=rows.find(r=>r.key===targetKey);

    if(!match){
      return {found:false};
    }

    match.button.click();

    // X may unmute immediately, or show a confirm dialog in future.
    // Support either behavior.
    await sleep(500);

    const confirmButtons=[
      'button[data-testid="confirmationSheetConfirm"]',
      'button[data-testid="confirm"]'
    ];

    for(const sel of confirmButtons){
      const btn=document.querySelector(sel);
      if(btn){
        btn.click();
        break;
      }
    }

    const start=Date.now();
    while(Date.now()-start<8000){
      if(stopped)throw new Error("Stopped");
      const stillThere=getMutedRows().some(r=>r.key===targetKey);
      if(!stillThere){
        await sleep(delay);
        return {found:true,removed:true};
      }
      if(looksRateLimited())throw new Error("rate-limit");
      await sleep(250);
    }

    if(looksRateLimited())throw new Error("rate-limit");
    return {found:true,removed:false};
  }

  async function runAdd(words,delay,retry){
    await goList();

    const existing=(await scanExisting()).map(norm);
    const existingSet=new Set(existing);

    const queue=[];
    const seen=new Set();

    for(const raw of words){
      const key=norm(raw);
      if(!key || seen.has(key))continue;
      seen.add(key);
      if(!existingSet.has(key))queue.push(raw);
    }

    await chrome.storage.local.set({
      lastScanExistingCount:existingSet.size,
      lastAddSkippedExisting:words.length-queue.length
    });

    // Start fresh against the dynamically filtered queue.
    await chrome.storage.local.remove(["bulkMuteIndex"]);

    let i=0;
    let backoffMinutes=0;

    while(i<queue.length && !stopped){
      try{
        console.log(`[X Bulk Muter] ADD ${i+1}/${queue.length}: ${queue[i]}`);
        await addOne(queue[i],delay);
        i++;
        backoffMinutes=0;
        existingSet.add(norm(queue[i-1]));
        await chrome.storage.local.set({
          bulkMuteIndex:i,
          bulkMuteBackoffMinutes:0
        });
      }catch(err){
        if(stopped)break;

        const emsg=String(err?.message||err);
        const limited=emsg.includes("rate-limit")||looksRateLimited();

        console.warn(`[X Bulk Muter] Add failed "${queue[i]}": ${emsg}`);

        if(limited){
          backoffMinutes=Math.min(20,backoffMinutes+1);
          await chrome.storage.local.set({bulkMuteBackoffMinutes:backoffMinutes});
          await goList().catch(()=>{});
          await waitWithStatus(backoffMinutes*60*1000,"429");
          continue;
        }

        await goList().catch(()=>{});
        await sleep(15000);

        // Re-scan after a generic failure in case X actually saved it.
        const refreshed=new Set((await scanExisting()).map(norm));
        if(refreshed.has(norm(queue[i]))){
          i++;
          await chrome.storage.local.set({bulkMuteIndex:i});
          continue;
        }

        if(!retry){
          i++;
          await chrome.storage.local.set({bulkMuteIndex:i});
        }
      }
    }

    if(i>=queue.length){
      await chrome.storage.local.remove([
        "bulkMuteIndex",
        "bulkMuteBackoffMinutes",
        "bulkMuteCooldownUntil",
        "bulkMuteCooldownReason"
      ]);
    }

    return {
      existingCount:existingSet.size,
      queued:queue.length,
      skipped:words.length-queue.length
    };
  }

  async function runUnmute(words,delay,retry){
    await goList();

    const targets=[];
    const seen=new Set();
    for(const raw of words){
      const key=norm(raw);
      if(!key||seen.has(key))continue;
      seen.add(key);
      targets.push({raw,key});
    }

    let i=0;
    let backoffMinutes=0;
    let removed=0;
    let notFound=0;

    while(i<targets.length && !stopped){
      try{
        console.log(`[X Bulk Muter] UNMUTE ${i+1}/${targets.length}: ${targets[i].raw}`);
        const result=await unmuteOne(targets[i].key,delay);

        if(!result.found){
          notFound++;
          i++;
          continue;
        }

        if(result.removed){
          removed++;
          i++;
          backoffMinutes=0;
          continue;
        }

        throw new Error("unmute-timeout");
      }catch(err){
        if(stopped)break;

        const emsg=String(err?.message||err);
        const limited=emsg.includes("rate-limit")||looksRateLimited();

        console.warn(`[X Bulk Muter] Unmute failed "${targets[i].raw}": ${emsg}`);

        if(limited){
          backoffMinutes=Math.min(20,backoffMinutes+1);
          await chrome.storage.local.set({bulkMuteBackoffMinutes:backoffMinutes});
          await goList().catch(()=>{});
          await waitWithStatus(backoffMinutes*60*1000,"429");
          continue;
        }

        await goList().catch(()=>{});
        await sleep(10000);

        // Re-scan: if it's gone, count it as success.
        const current=new Set((await scanExisting()).map(norm));
        if(!current.has(targets[i].key)){
          removed++;
          i++;
          continue;
        }

        if(!retry){
          i++;
        }
      }
    }

    return {removed,notFound,total:targets.length};
  }

  chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{
    if(msg?.type==="STOP_BULK_MUTE"){
      stopped=true;
      sendResponse({ok:true});
      return;
    }

    if(msg?.type==="SCAN_MUTED_WORDS"){
      (async()=>{
        try{
          const existing=await scanExisting();
          sendResponse({ok:true,existing});
        }catch(e){
          sendResponse({ok:false,error:e?.message||String(e)});
        }
      })();
      return true;
    }

    if(msg?.type!=="START_BULK_MUTE" && msg?.type!=="START_BULK_UNMUTE"){
      return;
    }

    if(running){
      sendResponse({ok:false,message:"Already running in this tab."});
      return;
    }

    const words=[...new Set((msg.words||[]).map(x=>String(x).trim()).filter(Boolean))];
    const delay=Math.max(6000,Number(msg.delay)||15000);
    const retry=msg.retry!==false;

    running=true;
    stopped=false;

    if(msg.type==="START_BULK_MUTE"){
      sendResponse({
        ok:true,
        message:"Scanning existing muted words first, then adding only missing entries."
      });

      (async()=>{
        try{
          const r=await runAdd(words,delay,retry);
          console.log("[X Bulk Muter] Add complete",r);
        }finally{
          running=false;
        }
      })();

      return true;
    }

    if(msg.type==="START_BULK_UNMUTE"){
      sendResponse({
        ok:true,
        message:"Bulk unmute started. Only matching currently-muted words will be removed."
      });

      (async()=>{
        try{
          const r=await runUnmute(words,delay,retry);
          console.log("[X Bulk Muter] Unmute complete",r);
        }finally{
          running=false;
        }
      })();

      return true;
    }
  });
})();
