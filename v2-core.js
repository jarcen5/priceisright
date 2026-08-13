(() => {
  'use strict';
  const P = window.PC = {};
  P.STORAGE_KEY = 'priceChallenge.settings.v2';
  P.LEGACY_STORAGE_KEY = 'priceChallenge.settings.v1';
  P.DB_NAME = 'priceChallengeDB';
  P.DB_STORE = 'games';
  P.DB_VERSION = 1;
  P.COLORS = ['#ef4444','#2563eb','#16a34a','#9333ea'];
  P.app = document.getElementById('app');
  P.dbPromise = null;
  P.toastTimer = null;

  P.uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  P.team = (name,i) => ({id:P.uid(),name,color:P.COLORS[i],score:0});
  P.esc = (v='') => String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  P.money = v => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number(v||0));
  P.byId = id => P.state.game.teams.find(t=>t.id===id);
  P.itemNow = () => P.state.playItems[P.state.roundIndex] || null;
  P.teamNow = () => P.byId(P.state.turnOrder[P.state.turnIndex]);
  P.shuffle = list => { const a=[...list]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

  P.state = {
    screen:'teams',
    game:{title:'Price Challenge',timerSeconds:30,sound:true,randomizeItems:true,randomizeTeams:true,rotateTeams:true,pointsPerRound:1,tieMode:'both',hostPin:'',teams:[P.team('Team 1',0),P.team('Team 2',1)],items:[]},
    savedGames:[],playItems:[],baseTeamOrder:[],roundIndex:0,turnOrder:[],turnIndex:0,turnStatus:'ready',bids:{},draftBid:'',remaining:30,timerId:null,revealTimerId:null,paused:false,hostControlsOpen:false,roundScored:false,roundHistory:[],pendingTiebreaker:[],tiebreakerTeams:null,isTiebreaker:false
  };

  P.showToast = message => {
    let el=document.querySelector('.toast');
    if(!el){el=document.createElement('div');el.className='toast';document.body.appendChild(el);}
    el.textContent=message;el.classList.add('show');clearTimeout(P.toastTimer);
    P.toastTimer=setTimeout(()=>el.classList.remove('show'),2400);
  };

  P.beep = (kind='normal') => {
    if(!P.state.game.sound)return;
    try{
      const AC=window.AudioContext||window.webkitAudioContext,ctx=new AC(),master=ctx.createGain();master.gain.value=.055;master.connect(ctx.destination);
      const tones={normal:[[520,0,.08]],start:[[480,0,.08],[620,.09,.09]],lock:[[620,0,.07],[820,.08,.1]],urgent:[[760,0,.07]],timeup:[[320,0,.12],[240,.14,.18]],reveal:[[440,0,.09],[560,.1,.09],[700,.2,.16]],win:[[660,0,.11],[820,.12,.11],[990,.24,.24]]};
      let end=0;(tones[kind]||tones.normal).forEach(([f,d,n])=>{const o=ctx.createOscillator(),g=ctx.createGain();o.frequency.value=f;g.gain.setValueAtTime(1,ctx.currentTime+d);g.gain.exponentialRampToValueAtTime(.01,ctx.currentTime+d+n);o.connect(g);g.connect(master);o.start(ctx.currentTime+d);o.stop(ctx.currentTime+d+n);end=Math.max(end,d+n);});
      setTimeout(()=>ctx.close(),Math.ceil((end+.1)*1000));
    }catch(_){ }
  };

  P.saveSettings = () => {
    const s=P.state.game;
    const safe={title:s.title,timerSeconds:s.timerSeconds,sound:s.sound,randomizeItems:s.randomizeItems,randomizeTeams:s.randomizeTeams,rotateTeams:s.rotateTeams,pointsPerRound:s.pointsPerRound,tieMode:s.tieMode,hostPin:s.hostPin,teams:s.teams.map(({id,name,color})=>({id,name,color}))};
    try{localStorage.setItem(P.STORAGE_KEY,JSON.stringify(safe));}catch(_){ }
  };
  P.loadSettings = () => {
    try{
      const s=JSON.parse(localStorage.getItem(P.STORAGE_KEY)||localStorage.getItem(P.LEGACY_STORAGE_KEY));if(!s)return;
      Object.assign(P.state.game,{title:s.title||'Price Challenge',timerSeconds:Number(s.timerSeconds)||30,sound:s.sound!==false,randomizeItems:s.randomizeItems!==false,randomizeTeams:s.randomizeTeams!==false,rotateTeams:s.rotateTeams!==false,pointsPerRound:Math.max(1,Number(s.pointsPerRound)||1),tieMode:s.tieMode==='tiebreaker'?'tiebreaker':'both',hostPin:String(s.hostPin||'')});
      if(Array.isArray(s.teams)&&s.teams.length>=2)P.state.game.teams=s.teams.slice(0,4).map((t,i)=>({id:t.id||P.uid(),name:t.name||`Team ${i+1}`,color:t.color||P.COLORS[i],score:0}));
      P.state.remaining=P.state.game.timerSeconds;
    }catch(_){ }
  };

  P.openDb = () => {
    if(P.dbPromise)return P.dbPromise;
    P.dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(P.DB_NAME,P.DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(P.DB_STORE))r.result.createObjectStore(P.DB_STORE,{keyPath:'id'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    return P.dbPromise;
  };
  P.dbGetAll = async () => {const db=await P.openDb();return new Promise((res,rej)=>{const r=db.transaction(P.DB_STORE,'readonly').objectStore(P.DB_STORE).getAll();r.onsuccess=()=>res(r.result||[]);r.onerror=()=>rej(r.error);});};
  P.dbPut = async v => {const db=await P.openDb();return new Promise((res,rej)=>{const tx=db.transaction(P.DB_STORE,'readwrite');tx.objectStore(P.DB_STORE).put(v);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});};
  P.dbDelete = async id => {const db=await P.openDb();return new Promise((res,rej)=>{const tx=db.transaction(P.DB_STORE,'readwrite');tx.objectStore(P.DB_STORE).delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error);});};
  P.refreshSavedGames = async () => {try{P.state.savedGames=(await P.dbGetAll()).sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0));}catch(_){P.state.savedGames=[];}};

  P.serializeGame = () => {const s=P.state.game;return{id:P.uid(),version:2,title:s.title.trim()||'Price Challenge',timerSeconds:Number(s.timerSeconds),sound:s.sound,randomizeItems:s.randomizeItems,randomizeTeams:s.randomizeTeams,rotateTeams:s.rotateTeams,pointsPerRound:Number(s.pointsPerRound),tieMode:s.tieMode,teams:s.teams.map(({name,color})=>({name,color})),items:s.items.map(({name,price,image})=>({name,price:Number(price),image:image||''})),updatedAt:Date.now()};};
  P.loadSerializedGame = s => {
    P.stopTimer?.();P.clearRevealTimer?.();const pin=P.state.game.hostPin;
    P.state.game={title:s.title||'Price Challenge',timerSeconds:Math.max(5,Number(s.timerSeconds)||30),sound:s.sound!==false,randomizeItems:s.randomizeItems!==false,randomizeTeams:s.randomizeTeams!==false,rotateTeams:s.rotateTeams!==false,pointsPerRound:Math.max(1,Number(s.pointsPerRound)||1),tieMode:s.tieMode==='tiebreaker'?'tiebreaker':'both',hostPin:pin,teams:(s.teams||[]).slice(0,4).map((t,i)=>({id:P.uid(),name:t.name||`Team ${i+1}`,color:t.color||P.COLORS[i],score:0})),items:(s.items||[]).map(x=>({id:P.uid(),name:x.name||'Mystery Item',price:Number(x.price)||0,image:x.image||''}))};
    while(P.state.game.teams.length<2)P.state.game.teams.push(P.team(`Team ${P.state.game.teams.length+1}`,P.state.game.teams.length));
    P.resetProgress();P.state.screen='teams';P.saveSettings();P.render();
  };
  P.resetProgress = () => {P.stopTimer?.();P.clearRevealTimer?.();Object.assign(P.state,{playItems:[],baseTeamOrder:[],roundIndex:0,turnOrder:[],turnIndex:0,turnStatus:'ready',bids:{},draftBid:'',remaining:P.state.game.timerSeconds,paused:false,hostControlsOpen:false,roundScored:false,roundHistory:[],pendingTiebreaker:[],tiebreakerTeams:null,isTiebreaker:false});P.state.game.teams.forEach(t=>t.score=0);};

  P.resizeImage = async (file,max=1100,q=.78) => {const data=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file);}),img=await new Promise((res,rej)=>{const x=new Image();x.onload=()=>res(x);x.onerror=rej;x.src=data;});let w=img.width,h=img.height,s=Math.min(1,max/Math.max(w,h));w=Math.max(1,Math.round(w*s));h=Math.max(1,Math.round(h*s));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);return c.toDataURL('image/jpeg',q);};

  P.init = async () => {P.loadSettings();await P.refreshSavedGames();P.render();};
})();
