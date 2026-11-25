/* Arcane Ledger core: pure logic shared by the page and the weekly refresh job */
const f1=x=>x.toFixed(1),f2=x=>x.toFixed(2),sg=(x,d=1)=>(x>0?'+':'')+x.toFixed(d);
const pc=x=>Math.round(x*100)+'%';
/* Pronunciation fixes applied only to what is spoken (captions keep the original text) */
const PRONUNCIATIONS=[[/\bD-ST\b/gi,'D S T']];
function spoken(t){return PRONUNCIATIONS.reduce((s,[re,to])=>s.replace(re,to),t);}
const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
const sdev=a=>{if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1));};
const median=a=>{const b=[...a].sort((x,y)=>x-y),n=b.length;return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0;};
function mulberry(seed){return function(){seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function corr(a,b){const x=[],y=[];for(let i=0;i<a.length;i++)if(a[i]!=null&&b[i]!=null){x.push(a[i]);y.push(b[i]);}
  if(x.length<3)return 0;const mx=mean(x),my=mean(y);let n=0,dx=0,dy=0;
  for(let i=0;i<x.length;i++){n+=(x[i]-mx)*(y[i]-my);dx+=(x[i]-mx)**2;dy+=(y[i]-my)**2;}
  return dx&&dy?n/Math.sqrt(dx*dy):0;}
function linreg(xs,ys){const mx=mean(xs),my=mean(ys);let n=0,d=0;xs.forEach((x,i)=>{n+=(x-mx)*(ys[i]-my);d+=(x-mx)**2;});const m=d?n/d:0;return{m,b:my-m*mx};}

function parseCSV(text){
  const rows=[];
  text.split(/\r?\n/).forEach(line=>{
    line=line.trim();if(!line)return;
    const p=line.split(/\t|,/).map(x=>x.trim().replace(/^"|"$/g,''));
    const wk=parseInt(p[0],10),pts=parseFloat(p[2]);
    if(isNaN(wk)||isNaN(pts)||!p[1])return;
    rows.push({week:wk,team:p[1],points:pts,opp:p[3]||''});
  });
  return rows;
}
function buildLeague(rows){
  if(!rows.length)throw new Error('No readable score lines found. Each line needs: week,team,points,opponent.');
  const teams=[...new Set(rows.map(r=>r.team))];
  if(teams.length<3)throw new Error('Need at least 3 teams to analyze a league.');
  const byW={};
  rows.forEach(r=>{const o=byW[r.week]=byW[r.week]||{w:r.week,score:{},opp:{}};o.score[r.team]=r.points;if(r.opp)o.opp[r.team]=r.opp;});
  const weeks=Object.values(byW).sort((a,b)=>a.w-b.w);
  weeks.forEach(wk=>{for(const t in wk.opp){const o=wk.opp[t];if(wk.score[o]!=null&&!wk.opp[o])wk.opp[o]=t;}});
  return{teams,weeks};
}

function compute(L){
  const T=L.teams,n=T.length,W=L.weeks,nW=W.length;
  const S={},H={};
  T.forEach(t=>{S[t]={team:t,sc:new Array(nW).fill(null),oppSc:[],gl:[],w:0,l:0,tie:0,g:0,pf:0,pa:0,ap:0,apG:0,expW:0,vsAvg:0,beatAvg:0,aboveMed:0,close:[0,0],vsTop:[0,0],bestW:0,worstW:0,res:new Array(nW).fill(null),wkPct:new Array(nW).fill(null)};H[t]={};});
  W.forEach((wk,wi)=>{
    const pr=T.filter(t=>wk.score[t]!=null),vals=pr.map(t=>wk.score[t]),avg=mean(vals),med=median(vals);
    pr.forEach(t=>{
      const r=S[t],s=wk.score[t];r.sc[wi]=s;r.pf+=s;
      let beat=0,mn=Infinity,mx=-Infinity;
      pr.forEach(o=>{if(o===t)return;const x=wk.score[o];beat+=s>x?1:s===x?.5:0;mn=Math.min(mn,x);mx=Math.max(mx,x);});
      const k=pr.length-1;r.ap+=beat;r.apG+=k;const p=k?beat/k:.5;r.wkPct[wi]=p;
      r.vsAvg+=s-avg;if(s>avg)r.beatAvg++;r.aboveMed+=s-med;
      const o=wk.opp[t];
      if(o&&wk.score[o]!=null){
        const os=wk.score[o];r.g++;r.pa+=os;r.oppSc.push(os);r.expW+=p;r.gl.push({o,s,os});
        H[t][o]=H[t][o]||[0,0,0];
        if(s>os){r.w++;r.res[wi]='W';H[t][o][0]++;}else if(s<os){r.l++;r.res[wi]='L';H[t][o][1]++;}else{r.tie++;r.res[wi]='T';H[t][o][2]++;}
        r.bestW+=s>mn?1:s===mn?.5:0;r.worstW+=s>mx?1:s===mx?.5:0;
      }
    });
  });
  const ppgs=T.map(t=>{const c=S[t].sc.filter(x=>x!=null).length||1;return S[t].pf/c;});
  const medPpg=median(ppgs);
  const topSet=new Set(T.filter((t,i)=>ppgs[i]>medPpg));
  T.forEach((t,i)=>{
    const r=S[t],sc=r.sc.filter(x=>x!=null);
    r.nPlayed=sc.length;r.ppg=ppgs[i];
    r.winPct=r.g?(r.w+r.tie/2)/r.g:0;r.effW=r.w+r.tie/2;
    r.luck=r.effW-r.expW;r.apPct=r.apG?r.ap/r.apG:0;
    r.eff=r.pf?r.effW/r.pf*1000:0;
    r.sd=sdev(sc);r.cv=r.ppg?r.sd/r.ppg:0;
    const srt=[...sc].sort((a,b)=>a-b);
    r.floor=srt[0];r.ceil=srt[srt.length-1];r.bot3=mean(srt.slice(0,3));r.top3=mean(srt.slice(-3));
    const last=sc.slice(-4),wts=[1,2,3,4].slice(0,last.length);
    r.recent=last.reduce((s,x,j)=>s+x*wts[j],0)/(wts.reduce((a,b)=>a+b,0)||1);r.trend=r.recent-r.ppg;
    r.sos=mean(r.oppSc);
    const others=ppgs.filter((_,j)=>j!==i);r.expOpp=mean(others);r.schedEase=r.expOpp-r.sos;
    const e=2.37;r.pyth=r.g&&r.pf+r.pa?Math.pow(r.pf,e)/(Math.pow(r.pf,e)+Math.pow(r.pa,e))*r.g:0;r.pythDiff=r.effW-r.pyth;
    r.gl.forEach(x=>{const d=Math.abs(x.s-x.os),res=x.s>x.os?0:x.s<x.os?1:-1;
      if(res>=0){if(d<=10)r.close[res]++;if(topSet.has(x.o))r.vsTop[res]++;}});
  });
  const A=T.map(t=>S[t]);
  const z=key=>{const v=A.map(r=>r[key]),m=mean(v),s=sdev(v)||1;A.forEach(r=>r['z_'+key]=(r[key]-m)/s);};
  ['recent','apPct','winPct','schedEase','ppg'].forEach(z);
  A.forEach(r=>{r.power=.3*r.z_recent+.3*r.z_apPct+.2*r.z_winPct+.15*r.z_ppg+.05*r.z_schedEase;r.powerScore=Math.max(0,Math.min(100,50+18*r.power));});
  const pairs=[];
  for(let i=0;i<n;i++)for(let j=i+1;j<n;j++)pairs.push({a:T[i],b:T[j],r:corr(S[T[i]].sc,S[T[j]].sc)});
  pairs.sort((x,y)=>y.r-x.r);
  return{S,T,W,H,pairs,avgPpg:mean(ppgs)};
}
function simulate(L,N,rand){
  rand=rand||Math.random;
  const T=L.teams,idx={};T.forEach((t,i)=>idx[t]=i);
  const nW=L.weeks.length,hist=T.map(()=>new Array(nW+1).fill(0));
  const present=L.weeks.map(wk=>T.filter(t=>wk.score[t]!=null).map(t=>idx[t]));
  const scores=L.weeks.map(wk=>T.map(t=>wk.score[t]));
  for(let it=0;it<N;it++){
    const wins=new Array(T.length).fill(0);
    for(let w=0;w<nW;w++){
      const a=present[w].slice();
      for(let i=a.length-1;i>0;i--){const j=Math.floor(rand()*(i+1));const tmp=a[i];a[i]=a[j];a[j]=tmp;}
      for(let i=0;i+1<a.length;i+=2){const x=a[i],y=a[i+1],sx=scores[w][x],sy=scores[w][y];
        if(sx>sy)wins[x]++;else if(sy>sx)wins[y]++;else{wins[x]+=.5;wins[y]+=.5;}}
    }
    for(let i=0;i<T.length;i++)hist[i][Math.min(nW,Math.floor(wins[i]))]++;
  }
  return{N,hist};
}
function multiSummary(sim,ST){
  return ST.T.map((t,i)=>{
    const h=sim.hist[i],N=sim.N,r=ST.S[t];let m=0,cum=0,p10=null,p90=null,win=0;
    h.forEach((c,k)=>{m+=k*c/N;cum+=c;if(p10===null&&cum/N>=.1)p10=k;if(p90===null&&cum/N>=.9)p90=k;if(k>r.g/2)win+=c;});
    const aw=Math.floor(r.effW+1e-9);let ge=0,le=0;
    h.forEach((c,k)=>{if(k>=aw)ge+=c;if(k<=aw)le+=c;});
    return{team:t,mean:m,p10,p90,pGE:ge/N,pLE:le/N,pWin:win/N,actual:aw};
  });
}
function demoRows(){
  const rand=mulberry(1337);
  const gauss=()=>Math.sqrt(-2*Math.log(rand()+1e-9))*Math.cos(2*Math.PI*rand());
  const names=["Gandalf's Gridiron","Merlin's Misfits","Dumbledore's Fumbles","Rincewind Runs Wild","The Sorcerer's Backfield","Elminster's Elite","Radagast Rushers","Saruman's Sack Attack","Voldemort's Waiver Wire","Jafar's Lamp Lions","Yennefer's Yardage","Prospero's Picks"];
  const mu=names.map(()=>108+gauss()*8),sg=names.map(()=>11+rand()*15);
  const n=names.length,weeks=10;let arr=[...Array(n).keys()];const rows=[];
  for(let w=1;w<=weeks;w++){
    const sc=names.map((_,i)=>Math.max(55,Math.round((mu[i]+gauss()*sg[i])*10)/10));
    for(let i=0;i<n/2;i++){const a=arr[i],b=arr[n-1-i];
      rows.push({week:w,team:names[a],points:sc[a],opp:names[b]});rows.push({week:w,team:names[b],points:sc[b],opp:names[a]});}
    arr=[arr[0],arr[n-1],...arr.slice(1,n-1)];
  }
  return rows;
}

function buildSlides(ST,LG,SM,SIM){
  const A=ST.T.map(t=>ST.S[t]),n=A.length,nW=LG.weeks.length;
  const by=(k,d=-1)=>[...A].sort((a,b)=>d*(a[k]-b[k]));
  const rec=r=>`${r.w}-${r.l}${r.tie?'-'+r.tie:''}`;
  const pw=by('powerScore'),lu=by('luck'),ef=by('eff'),ea=by('schedEase'),cv=by('cv'),tr=by('trend'),bw=by('bestW');
  const frauds=[...A].sort((a,b)=>(b.winPct-b.beatAvg/b.g)-(a.winPct-a.beatAvg/a.g));
  const va=by('vsAvg');
  const sm={};SM.forEach(s=>sm[s.team]=s);
  const cheated=[...SM].sort((a,b)=>(b.actual-b.mean)-(a.actual-a.mean));
  const S=[];
  S.push({k:'Welcome, mortals',h:'The Season Reading',big:`${n} houses, ${nW} weeks of war`,rows:[],
    say:`Well, hello there, gentlemen. I am Dominique, Keeper of the Arcane Ledger. I have gazed into the scrying pool across ${nW} weeks of battle and ${n} wizard houses. Prepare yourselves. Some of you will be flattered. Most of you will be furious.`});
  S.push({k:'The Council of Archmages',h:'Power Rankings',big:pw[0].team,
    rows:pw.slice(0,5).map((r,i)=>({n:`${i+1}. ${r.team}`,v:r.powerScore.toFixed(0),c:'g'})).concat([{n:`${n}. ${pw[n-1].team}`,v:pw[n-1].powerScore.toFixed(0),c:'b'}]),
    say:`First, the Council of Archmages. At the summit sits ${pw[0].team}, wielding the strongest sorcery in the realm. ${pw[1].team} and ${pw[2].team} lurk close behind. And at the bottom of the tower? ${pw[n-1].team}. The stars weep for you.`});
  S.push({k:"Fate's Favorite",h:'The Luckiest Wizard',big:lu[0].team,
    rows:lu.slice(0,3).map(r=>({n:r.team,v:`${rec(r)} (${f1(r.expW)} earned)`,c:'g'})),
    say:`Fate has favorites, and ${lu[0].team} is the favorite. Their sorcery earned ${f1(lu[0].expW)} wins, yet they claimed ${f1(lu[0].effW)}. That is ${f1(lu[0].luck)} wins of pure cosmic charity.`});
  const u=lu[n-1];
  S.push({k:"Fate's Victim",h:'The Cursed One',big:u.team,
    rows:lu.slice(-3).reverse().map(r=>({n:r.team,v:`${rec(r)} (${f1(r.expW)} earned)`,c:'b'})),
    say:`Now, weep for ${u.team}. Their magic earned ${f1(u.expW)} wins. The calendar paid out ${f1(u.effW)}. That is ${f1(Math.abs(u.luck))} wins stolen by the schedule gods. Truly, a hex.`});
  S.push({k:'Mana Efficiency',h:'Wins per Thousand Points',big:`${ef[0].team} vs ${ef[n-1].team}`,
    rows:[{n:ef[0].team,v:`${f2(ef[0].eff)} wins per 1k pts`,c:'g'},{n:ef[1].team,v:`${f2(ef[1].eff)}`,c:'g'},{n:ef[n-2].team,v:`${f2(ef[n-2].eff)}`,c:'b'},{n:ef[n-1].team,v:`${f2(ef[n-1].eff)} wins per 1k pts`,c:'b'}],
    say:`On to efficiency. ${ef[0].team} turned every thousand points into ${f2(ef[0].eff)} wins. A thrifty enchanter. Meanwhile ${ef[n-1].team} burned ${f1(ef[n-1].pf)} points for a mere ${ef[n-1].effW} victories. All that mana, squandered.`});
  const fr=frauds[0];
  S.push({k:'The Average Mortal',h:'Versus the League Average Team',big:va[0].team,
    rows:[{n:va[0].team,v:`beat avg ${va[0].beatAvg} of ${va[0].g}`,c:'g'},{n:va[n-1].team,v:`beat avg ${va[n-1].beatAvg} of ${va[n-1].g}`,c:'b'},{n:fr.team+' (record vs. truth)',v:`${rec(fr)} but ${fr.beatAvg}/${fr.g} vs avg`,c:'b'}],
    say:`Let us duel the Average Mortal, a phantom who scores the league average every week. ${va[0].team} dominates this phantom, beating it ${va[0].beatAvg} times in ${va[0].g}. ${va[n-1].team} loses to it most weeks. And a word on ${fr.team}: a record of ${rec(fr)}, yet only ${fr.beatAvg} wins over the Average Mortal. Smoke and mirrors.`});
  S.push({k:'The Roads Traveled',h:'Strength of Schedule',big:ea[n-1].team,
    rows:[{n:ea[0].team+' (softest road)',v:`${sg(ea[0].schedEase)} pts/game`,c:'g'},{n:ea[n-1].team+' (cruelest road)',v:`${sg(ea[n-1].schedEase)} pts/game`,c:'b'},{n:bw[0].team+' (best possible)',v:`${bw[0].bestW}-${bw[0].g-bw[0].bestW}`,c:'g'}],
    say:`Consider the roads you walked. ${ea[0].team} strolled a gentle path, facing foes who scored ${f1(ea[0].schedEase)} fewer points than a typical schedule. ${ea[n-1].team} marched through fire. And in the kindest possible cosmos, ${bw[0].team} would have gone ${bw[0].bestW} and ${bw[0].g-bw[0].bestW}.`});
  const ch=cheated[0],bl=cheated[n-1];
  S.push({k:'The Multiverse',h:`${SIM.N.toLocaleString()} Parallel Universes`,big:`${ch.team} got away with it`,
    rows:[{n:ch.team,v:`won ${ch.actual}, universes say ${f1(ch.mean)}`,c:'g'},{n:bl.team,v:`won ${bl.actual}, universes say ${f1(bl.mean)}`,c:'b'}],
    say:`I opened ${SIM.N.toLocaleString()} parallel universes, each with a fresh random schedule. In the typical timeline, ${ch.team} wins ${f1(ch.mean)} games, not the ${ch.actual} they enjoyed. Enjoy it while the prophecy lasts. And ${bl.team}? Across the multiverse they average ${f1(bl.mean)} wins. In this cruel timeline they got ${bl.actual}.`});
  const hi=cv[0],lo=cv[n-1];
  S.push({k:'Chaos and Order',h:'Boom or Bust',big:hi.team,
    rows:[{n:hi.team+' (chaos)',v:`${f1(hi.floor)} to ${f1(hi.ceil)}`,c:'b'},{n:lo.team+' (metronome)',v:`${f1(lo.floor)} to ${f1(lo.ceil)}`,c:'g'}],
    say:`Volatility. ${hi.team} is chaos incarnate, scoring ${f1(hi.floor)} one week and ${f1(hi.ceil)} the next. You never know which wizard shows up. ${lo.team} is a metronome, forever between ${f1(lo.floor)} and ${f1(lo.ceil)}. Boring, but dependable.`});
  S.push({k:'The Omens',h:'Recent Form',big:tr[0].team,
    rows:[{n:tr[0].team+' (rising)',v:`${sg(tr[0].trend)} pts/game`,c:'g'},{n:tr[1].team,v:`${sg(tr[1].trend)}`,c:'g'},{n:tr[n-1].team+' (fading)',v:`${sg(tr[n-1].trend)} pts/game`,c:'b'}],
    say:`Finally, the omens. ${tr[0].team} is running hot, scoring ${f1(tr[0].trend)} points per game above their season norm over the recent weeks. ${tr[n-1].team} has gone cold, ${f1(Math.abs(tr[n-1].trend))} points below. The frost spreads.`});
  S.push({k:'The Ledger is closed',h:'Until next week',big:'Let the arguments begin',rows:[],
    say:`That is the Ledger, boys. Copy the scroll, send it to the group chat, and watch the friendships burn. I am Dominique. Try not to miss me.`});
  return S;
}
