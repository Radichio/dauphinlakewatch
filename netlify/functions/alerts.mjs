// Dauphin Lake Watch — alerts: two-channel ECCC alert probe, self-reporting.
// Channel A: CAP-XML on Datamart (dd.weather.gc.ca/alerts/cap/YYYYMMDD/{OFFICE}/{hh}/).
//   Tornado + severe-thunderstorm WARNINGS file under the special office "LAND" (per MSC docs);
//   other Manitoba warnings/watches under "CWWG" (Winnipeg). We scan both, newest hours first.
// Channel B: GeoMet WMS ALERTS GetFeatureInfo at the lake point (same query the page makes).
// Every stage that can fail reports a string into `errors`. Open this endpoint to see health.
const LAKE={lat:51.131,lon:-99.79};
const AREA_RE=/(dauphin|ochre|ste\.?\s*rose|alonsa|mccreary|riding\s*mountain|lakeshore|gilbert\s*plains|grandview|winnipegosis|mossey)/i;
const DD='https://dd.weather.gc.ca/alerts/cap/';
const H=(c)=>({'content-type':'application/json','access-control-allow-origin':'*','cache-control':'public,max-age=120','x-cache':c});
let cache={t:0,body:null};

async function get(url,ms){
  const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),ms||6500);
  try{ const r=await fetch(url,{signal:ctl.signal}); if(!r.ok) throw new Error('http '+r.status); return await r.text(); }
  finally{ clearTimeout(to); }
}
const dirs=(html)=>[...html.matchAll(/href="([^"\/?][^"]*\/)"/g)].map(x=>x[1]).filter(d=>!/^\.|parent/i.test(d));
const files=(html)=>[...html.matchAll(/href="([^"]+\.cap)"/g)].map(x=>x[1]);
const tag=(s,t)=>{ const m=s.match(new RegExp('<'+t+'>([^<]*)</'+t+'>')); return m?m[1].trim():null; };
function sevRank(s){ s=String(s||'').toLowerCase();
  if(/tornado|tornade/.test(s)&&/warning|avertissement/.test(s)) return 5;
  if(/(thunderstorm|orage)/.test(s)&&/warning|avertissement/.test(s)) return 4;
  if(/warning|avertissement/.test(s)) return 3;
  if(/watch|veille/.test(s)) return 2;
  return 0;
}
function pip(lat,lon,poly){
  let inside=false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const yi=poly[i][0],xi=poly[i][1],yj=poly[j][0],xj=poly[j][1];
    if(((yi>lat)!==(yj>lat))&&(lon<(xj-xi)*(lat-yi)/(yj-yi)+xi)) inside=!inside;
  }
  return inside;
}
function parseCap(xml){
  if(!/<status>\s*Actual/i.test(xml)) return null;
  if(/<msgType>\s*Cancel/i.test(xml)) return null;
  const infos=xml.split(/<info>/).slice(1).map(b=>'<info>'+b);
  if(!infos.length) return null;
  let info=infos.find(b=>/en-CA/.test(b))||infos[0];
  const event=tag(info,'event'), headline=tag(info,'headline');
  const desc=(tag(info,'description')||'').slice(0,1500);
  const head=headline||event; if(!head) return null;
  const sev=sevRank(head)||sevRank(event); if(sev<2) return null;
  let exp=null; const e=tag(info,'expires'); if(e){const t2=Date.parse(e); if(!isNaN(t2)) exp=t2;}
  if(exp&&exp<Date.now()) return null;
  const areas=[...info.matchAll(/<area>([\s\S]*?)<\/area>/g)].map(m=>m[1]);
  let hit=false; const names=[];
  for(const a of areas){
    const desc=tag(a,'areaDesc')||''; names.push(desc);
    if(AREA_RE.test(desc)){hit=true;}
    if(!hit){
      for(const pm of a.matchAll(/<polygon>([^<]+)/g)){
        const poly=pm[1].trim().split(/\s+/).map(p=>p.split(',').map(Number)).filter(p=>p.length===2&&!isNaN(p[0]));
        if(poly.length>=3&&pip(LAKE.lat,LAKE.lon,poly)){hit=true;break;}
      }
    }
    if(hit)break;
  }
  if(!hit) return null;
  const txt=head+' '+desc;
  let gustTo=null, rainTo=null;
  const gmm=txt.match(/(?:gust|wind)[^.]{0,60}?(\d{2,3})(?:\s*(?:to|-|\u2013)\s*(\d{2,3}))?\s*\+?\s*km\/?h/i);
  if(gmm) gustTo=Math.max(parseInt(gmm[1],10),gmm[2]?parseInt(gmm[2],10):0);
  if(/rain/i.test(txt)){ const rmm=txt.match(/(\d{2,3})\s*(?:to\s*(\d{2,3})\s*)?mm/i); if(rmm) rainTo=Math.max(parseInt(rmm[1],10),rmm[2]?parseInt(rmm[2],10):0); }
  return {head:head.slice(0,120),sev:sev,expires:exp?new Date(exp).toISOString():null,
          areas:names.filter(n=>AREA_RE.test(n)).slice(0,4),src:'cap',gustTo:gustTo,rainTo:rainTo};
}
async function capChannel(errors){
  const out=[]; let scanned=0;
  const fmt=(d)=>d.toISOString().slice(0,10).replace(/-/g,'');
  const days=[fmt(new Date()),fmt(new Date(Date.now()-86400000))];
  for(const day of days){
    let dayIdx=null;
    try{ dayIdx=dirs(await get(DD+day+'/',7000)); }
    catch(e){ errors.push('cap day '+day+': '+(e.message||e)); continue; }
    for(const office of ['LAND/','CWWG/']){
      if(!dayIdx.includes(office)){ errors.push('cap '+day+': no '+office.replace('/','')+' shelf'); continue; }
      let hours=null;
      try{ hours=dirs(await get(DD+day+'/'+office,7000)).sort(); }
      catch(e){ errors.push('cap '+day+' '+office+': '+(e.message||e)); continue; }
      for(const hh of hours.slice(-4).reverse()){
        if(scanned>=28) break;
        let fl=null;
        try{ fl=files(await get(DD+day+'/'+office+hh,7000)); }
        catch(e){ errors.push('cap '+day+' '+office+hh+': '+(e.message||e)); continue; }
        if(office==='LAND/') fl=fl.filter(f=>{const p=f.split('_'); return p[1]&&/MB/.test(p[1]);});
        for(const f of fl.slice(-14).reverse()){
          if(scanned>=28) break;
          scanned++;
          try{ const a=parseCap(await get(DD+day+'/'+office+hh+f,7000)); if(a) out.push(a); }
          catch(e){ errors.push('cap file '+f+': '+(e.message||e)); }
        }
      }
    }
    if(out.length) break;   // today found alerts; yesterday only as fallback
  }
  return {alerts:out,scanned:scanned};
}
async function wmsChannel(errors){
  const d=0.02;
  const url='https://geo.weather.gc.ca/geomet?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetFeatureInfo'
    +'&LAYERS=ALERTS&QUERY_LAYERS=ALERTS&CRS=EPSG:4326'
    +'&BBOX='+(LAKE.lat-d)+','+(LAKE.lon-d)+','+(LAKE.lat+d)+','+(LAKE.lon+d)
    +'&WIDTH=3&HEIGHT=3&I=1&J=1&INFO_FORMAT=application/json&FORMAT=image/png&FEATURE_COUNT=8';
  try{
    const j=JSON.parse(await get(url,6500));
    const out=[];
    for(const f of (j.features||[])){
      const p=(f&&f.properties)||{}; let head=null,bestR=0,exp=null,alltxt='';
      for(const k in p){ const v=p[k]; if(typeof v!=='string') continue;
        alltxt+=' '+v;
        if(!/(ended|no longer)/i.test(v)){ const r0=sevRank(v); if(r0>bestR||(r0===bestR&&r0>0&&head&&v.length>head.length)){bestR=r0;head=v.split(/[\n\r]/)[0].slice(0,120);} }
        if(/expir|end/i.test(k)){ const t2=Date.parse(v); if(!isNaN(t2)) exp=t2; }
      }
      if(head&&bestR>=2&&(!exp||exp>Date.now())){
        let mg=null,mr=null;
        const gm3=alltxt.match(/(?:gust|wind)[^.]{0,60}?(\d{2,3})(?:\s*(?:to|-|\u2013)\s*(\d{2,3}))?\s*\+?\s*km\/?h/i);
        if(gm3) mg=Math.max(parseInt(gm3[1],10),gm3[2]?parseInt(gm3[2],10):0);
        if(/rain/i.test(alltxt)){ const rm3=alltxt.match(/(\d{2,3})\s*(?:to\s*(\d{2,3})\s*)?mm/i); if(rm3) mr=Math.max(parseInt(rm3[1],10),rm3[2]?parseInt(rm3[2],10):0); }
        out.push({head:head,sev:bestR,expires:exp?new Date(exp).toISOString():null,areas:[],src:'wms',gustTo:mg,rainTo:mr});
      }
    }
    return out;
  }catch(e){ errors.push('wms: '+(e.message||e)); return []; }
}
export default async ()=>{
  if(cache.body && Date.now()-cache.t < 4*60000) return new Response(cache.body,{headers:H('hit')});
  const errors=[];
  const [cap,wms]=await Promise.all([capChannel(errors),wmsChannel(errors)]);
  const seen={}; const alerts=[];
  for(const a of [...cap.alerts,...wms]){
    const k=a.head.toLowerCase();
    if(seen[k]){ if(a.sev>seen[k].sev)seen[k].sev=a.sev; if(a.expires&&(!seen[k].expires||a.expires>seen[k].expires))seen[k].expires=a.expires; continue; }
    seen[k]=a; alerts.push(a);
  }
  alerts.sort((x,y)=>y.sev-x.sev);
  const body=JSON.stringify({ok:true,t:Date.now(),
    src:'ECCC CAP via Datamart (LAND + CWWG shelves) + GeoMet WMS ALERTS',
    channels:{cap:{filesScanned:cap.scanned,matched:cap.alerts.length},wms:{matched:wms.length}},
    errors:errors, alerts:alerts});
  cache={t:Date.now(),body:body};
  return new Response(body,{headers:H('miss')});
};
