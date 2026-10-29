(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./options-simulator-engine.js'));
  else root.IWSMArchive=factory(root.IWSMSimulator);
})(typeof globalThis!=='undefined'?globalThis:this,function(M){
  'use strict';
  const DAY=86400000,valid=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  const plus=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*DAY).toISOString().slice(0,10);
  function dates(c,symbol){return [...new Set((c.symbolDates?.[symbol]||(!c.symbolDates?c.dates:[])||[]).filter(valid))].sort();}
  function stepDate(list,current,direction,amount=1){const i=list.indexOf(current);if(i<0)return null;return list[i+Math.sign(direction)*amount]||null;}
  function windowFor(list,target){if(!list.includes(target))throw Error('No downloaded trading date selected. Choose a recorded weekday.');return {start:target,end:list.filter(d=>d>=target&&d<=plus(target,30)).at(-1)};}
  function chunks(start,end){if(!valid(start)||!valid(end)||end<start)throw Error('Invalid archive date range.');const out=[];for(let at=start;at<=end;){const stop=plus(at,30)<end?plus(at,30):end;out.push({start:at,end:stop});at=plus(stop,1);}return out;}
  function compact(records,s,keep,limit=200000){
    if(records.size<=limit)return {records,pruned:false};
    const traded=new Set(s.events.filter(e=>e.kind==='open').map(e=>[s.symbol,e.expiry,e.type,e.strike].join('|'))),anchors=new Set(),out=new Map();
    for(const [key,row]of records){const frame=row.symbol+'|'+row.stamp,trade=[row.symbol,row.expiry,row.type,row.strike].join('|');
      if(keep.has(row.date)||traded.has(trade)||!anchors.has(frame))out.set(key,row);
      anchors.add(frame);
    }
    if(out.size>limit)throw Error('This simulation exceeds the retained trade-history limit. Export it and start a new session for another period.');
    return {records:out,pruned:true};
  }
  function extend(d,s,incoming,target,retain=target){
    const next=M.prepareDataset(incoming);
    if(d.kind!=='daily'||next.kind!=='daily')throw Error('Archive extensions require daily observations.');
    if(next.symbols.length!==1||next.symbols[0]!==s.symbol)throw Error('Archive symbol differs from the active simulation.');
    const records=new Map(d.records);
    for(const [key,row]of next.records){if(records.has(key)&&JSON.stringify(records.get(key))!==JSON.stringify(row))throw Error('Conflicting archive observation; original trade prices preserved.');records.set(key,row);}
    const spots=new Map(d.spots);
    for(const [key,value]of next.spots){if(spots.has(key)&&spots.get(key)!==value)throw Error('Conflicting underlying observation.');spots.set(key,value);}
    const underlying=[...spots].map(([key,close])=>{const [symbol,stamp]=key.split('|');return {symbol,date:stamp.slice(0,10),close};});
    const provenance=[...(d.metadata.sources||[]),...(next.metadata.sources||[])];
    let fullDates=[...new Set([...(d.metadata.fullChainDates||d.contracts.map(r=>r.date)),...next.contracts.map(r=>r.date)])];
    const keep=new Set([s.cursor.slice(0,10),target,retain,next.contracts.at(-1).date]),bounded=compact(records,s,keep);
    if(bounded.pruned)fullDates=fullDates.filter(day=>keep.has(day));
    const data=M.prepareDataset({source:'Downloaded daily archive',metadata:{...d.metadata,...next.metadata,localArchive:true,fullChainDates:fullDates,sources:[...new Map(provenance.map(p=>[p.date,p])).values()]},contracts:[...bounded.records.values()],underlying});
    const frames=[...data.bySymbol.get(s.symbol)].sort();
    const stamp=target+'T15:30';if(!frames.includes(stamp))throw Error('No recorded observation for the selected date.');
    const restored=M.restore(data,{...s,start:frames[0].slice(0,10),end:frames.at(-1).slice(0,10),dataSignature:data.signature});
    if(Array.isArray(s.recording))restored.recording=s.recording.filter(r=>r&&frames.includes(r.at)&&Number.isInteger(r.events)).slice(-5000);
    return {data,raw:M.exportDataset(data),session:M.advance(data,restored,stamp)};
  }
  function install(api){
    const $=id=>document.getElementById('sm-'+id),h=api.host;
    let catalog=null,busy=false,playing=false,playTimer=null,playRevision=0;
    const originalDate=$('replay-date').onchange,originalDaily=$('original-data').onclick;
    const notice=document.createElement('span');notice.id='sm-archive-status';notice.hidden=true;$('replay-date').setAttribute('aria-describedby',notice.id);$('replay-date').parentElement.append(notice);
    const connected=()=>!!catalog&&api.dataset()?.kind==='daily'&&api.dataset().metadata.localArchive===true;
    function render(){
      if(!catalog||!api.session())return;
      if(connected()){
        const list=dates(catalog,api.session().symbol),day=api.session().cursor.slice(0,10);
        $('replay-date').min=list[0]||day;$('replay-date').max=list.at(-1)||day;
        notice.textContent=busy?'Loading recorded prices…':'Daily archive · '+list[0]+' — '+list.at(-1);
        $('replay-date').title=notice.textContent;
        $('move-note').textContent=notice.textContent+' · Recorded 15:30 closes. Minute replay requires timestamped data.';
        h.querySelectorAll('[data-jump="day"]').forEach(b=>b.disabled=busy||!stepDate(list,day,Number(b.dataset.dir)));
        for(const [id,dir]of [['prev',-1],['next',1]])$(id).disabled=busy||!stepDate(list,day,dir,Number($('step').value)||1);
      }else notice.textContent='';
      $('replay-date').disabled=busy;$('symbol').disabled=busy;
      $('time').disabled=busy;$('slider').disabled=busy;
      if(connected()){$('play').disabled=!playing&&(busy||!stepDate(dates(catalog,api.session().symbol),api.session().cursor.slice(0,10),1));$('play').textContent=playing?'Ⅱ Pause':'▶ Autoplay';}
    }
    async function request(symbol,start,end){
      const response=await fetch('/api/nse-library?'+new URLSearchParams({mode:'load',symbol,start,end}),{signal:AbortSignal.timeout(125000)}),raw=await response.json();
      if(!response.ok||!raw.success)throw Error(raw.error||'Archive load failed.');
      raw.metadata={...raw.metadata,localArchive:true};return raw;
    }
    async function go(target,symbol=api.session().symbol,fresh=false){
      if(busy)return;
      const oldData=api.dataset(),oldSession=api.session(),signature=JSON.stringify(oldSession),list=dates(catalog,symbol);
      try{
        windowFor(list,target);busy=true;api.act(()=>api.session());render();api.message('Loading downloaded daily prices for '+target+'…');
        let result;
        const same=connected()&&symbol===oldSession.symbol&&!fresh&&(oldSession.events.length>0||oldData.byFrame.has(symbol+'|'+target+'T15:30'));
        if(!same){
          const range=windowFor(list,target),raw=await request(symbol,range.start,range.end),data=M.prepareDataset(raw),session=M.createSession(data,{symbol,start:range.start,end:range.end});
          result={data,raw,session:M.advance(data,session,target+'T15:30')};
        }else{
          let data=oldData,state=oldSession;
          // Fetch every intervening close so risk rules cannot skip an unseen session.
          const from=target<state.cursor.slice(0,10)?target:state.cursor.slice(0,10),to=target>state.cursor.slice(0,10)?target:state.cursor.slice(0,10);
          for(const range of chunks(from,to)){
            const fullDates=data.metadata.fullChainDates;
            const missing=list.filter(day=>day>=range.start&&day<=range.end&&(!data.byFrame.has(symbol+'|'+day+'T15:30')||(fullDates&&!fullDates.includes(day))));
            if(!missing.length)continue;
            const raw=await request(symbol,missing[0],missing.at(-1));
            // Retain the cursor until the full continuous path is available.
            const merged=extend(data,state,raw,state.cursor.slice(0,10),target);data=merged.data;state=merged.session;
          }
          result={data,raw:M.exportDataset(data),session:M.advance(data,state,target+'T15:30')};
        }
        if(api.dataset()!==oldData||JSON.stringify(api.session())!==signature){api.message('The simulation changed while loading. Its current trades were preserved.');return;}
        if(same||!oldSession.events.length)api.commitDataset(result.raw,result.session);else api.adopt(result.raw,result.session);
        api.message('Recorded close · '+target+' 15:30 IST. Buy / Sell uses this date’s recorded price. Entry prices stay fixed during replay.');
      }catch(error){api.message(error.message+' Previous simulation preserved.');}
      finally{busy=false;api.refresh();}
    }
    function stop(){playing=false;clearTimeout(playTimer);playRevision++;render();}
    const originalPlay=$('play').onclick;
    $('play').onclick=e=>{
      if(!connected())return originalPlay(e);
      if(playing){stop();return;}
      playing=true;const version=++playRevision;render();
      async function tick(){
        if(!playing||version!==playRevision||document.hidden||h.hidden||!connected()){stop();return;}
        const before=api.session().cursor,target=stepDate(dates(catalog,api.session().symbol),before.slice(0,10),1,Number($('step').value)||1);
        if(!target){stop();return;}
        await go(target);
        if(!playing||version!==playRevision)return;
        if(api.session().cursor===before){stop();return;}
        playTimer=setTimeout(tick,Number($('speed').value)||1000);
      }
      playTimer=setTimeout(tick,Number($('speed').value)||1000);
    };
    h.addEventListener('click',e=>{if(playing&&!e.target.closest('#sm-play'))stop();},true);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    $('replay-date').onchange=e=>{stop();return connected()?go(e.target.value):originalDate(e);};
    const originalTime=$('time').onchange,originalSlider=$('slider').oninput;
    $('time').onchange=e=>{stop();return connected()?go(e.target.value.slice(0,10)):originalTime(e);};
    $('slider').oninput=e=>{stop();return connected()?go(M.frames(api.dataset(),api.session())[Number(e.target.value)].slice(0,10)):originalSlider(e);};
    h.querySelectorAll('[data-jump="day"]').forEach(b=>{const original=b.onclick;b.onclick=e=>{if(!connected())return original(e);const day=stepDate(dates(catalog,api.session().symbol),api.session().cursor.slice(0,10),Number(b.dataset.dir));if(day)go(day);};});
    for(const [id,dir]of [['prev',-1],['next',1]]){const original=$(id).onclick;$(id).onclick=e=>{if(!connected())return original(e);const day=stepDate(dates(catalog,api.session().symbol),api.session().cursor.slice(0,10),dir,Number($('step').value)||1);if(day)go(day);};}
    $('original-data').onclick=e=>{if(!catalog)return originalDaily(e);const list=dates(catalog,api.session().symbol),day=api.session().cursor.slice(0,10);go(list.includes(day)?day:list.at(-1),api.session().symbol,true);};
    const originalSymbol=$('symbol').onchange;
    $('symbol').onchange=e=>{if(!connected()){if(originalSymbol)originalSymbol(e);return;}const symbol=e.target.value,list=dates(catalog,symbol);$('symbol').value=api.session().symbol;if(!list.length){api.message('No downloaded dates for this symbol.');return;}const day=api.session().cursor.slice(0,10);go(list.includes(day)?day:list.at(-1),symbol,true);};
    const initial=()=>({data:api.dataset(),session:api.session()});
    Promise.resolve().then(()=>{const start=initial();return fetch('/api/nse-library?mode=catalog').then(r=>r.ok?r.json():null).then(c=>{if(!c?.success)return;catalog=c;if(api.dataset()===start.data&&api.session()===start.session&&!start.session.events.length&&start.data.kind==='daily'){
      const list=dates(c,start.session.symbol),day=start.session.cursor.slice(0,10);if(list.length)return go(list.includes(day)?day:list.at(-1),start.session.symbol,true);
    }render();});}).catch(()=>{notice.textContent='Local archive unavailable. Loaded and imported data remain usable.';});
    return {render};
  }
  return {dates,stepDate,window:windowFor,chunks,extend,compact,install};
});
