// Dauphin Lake Watch -- wind-ring v2: self-discovering 8-station ring.
// CYDN: ECCC SWOB realtime API (proven). The 7 provincial stations: discovered live from
// the federal Datamart partners shelf (dd.weather.gc.ca/observations/swob-ml/partners/):
// find the Manitoba network folder, match station folders by name, read the newest XML.
// Every stage self-reports; a failed stage becomes the station's error string.
const RING=[
 {id:'sterose',  name:'Ste. Rose',      lat:51.0816, lon:-99.5237,  dist:19.3, brg:106, m:/ste.?_?rose/i},
 {id:'rorketon', name:'Rorketon',       lat:51.3327, lon:-99.4934,  dist:30.5, brg:43,  m:/rorketon/i},
 {id:'laurier',  name:'Laurier',        lat:50.8753, lon:-99.6024,  dist:31.2, brg:155, m:/laurier/i},
 {id:'keld',     name:'Keld',           lat:50.9929, lon:-100.2264, dist:34.0, brg:243, m:/keld/i},
 {id:'ashville', name:'Ashville',       lat:51.1623, lon:-100.2970, dist:35.5, brg:276, m:/ashville/i},
 {id:'drifting', name:'Drifting River', lat:51.3575, lon:-100.3609, dist:47.0, brg:302, m:/drifting/i},
 {id:'forkriver',name:'Fork River',     lat:51.5380, lon:-100.0062, dist:47.6, brg:342, m:/fork_?river/i},
];
const CYDN={id:'cydn',name:'Dauphin Aprt',lat:51.1008,lon:-100.0525,dist:18.6,brg:260};
const DD='https://dd.weather.gc.ca/observations/swob-ml/partners/';
const H=(c)=>({'content-type':'application/json','access-control-allow-origin':'*','cache-control':'public,max-age=120','x-cache':c});
const base=(s)=>({id:s.id,name:s.name,dist:s.dist,brg:s.brg});
let cache={t:0,body:null};
let disco={net:null,map:null,t:0};

async function get(url,ms){
  const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),ms||6500);
  try{ const r=await fetch(url,{signal:ctl.signal}); if(!r.ok) throw new Error('http '+r.status); return await r.text(); }
  finally{ clearTimeout(to); }
}
const dirs=(html)=>[...html.matchAll(/href="([^"\/?][^"]*\/)"/g)].map(x=>x[1]).filter(d=>!/^\.|parent/i.test(d));
const files=(html)=>[...html.matchAll(/href="([^"]+\.xml)"/g)].map(x=>x[1]);

function xval(xml,re){
  const m=xml.match(new RegExp('name=["\\\'](?:'+re+')["\\\'][^>]*?(?:uom=["\\\']([^"\\\']*)["\\\'][^>]*?)?value=["\\\']([^"\\\']+)["\\\']'));
  if(!m) return null;
  let v=parseFloat(m[2]); if(isNaN(v)) return null;
  if(m[1]&&/m\/s/i.test(m[1])) v=v*3.6;
  return v;
}
function xstr(xml,name){
  const m=xml.match(new RegExp('name=["\\\']'+name+'["\\\'][^>]*value=["\\\']([^"\\\']+)["\\\']'));
  return m?m[1]:null;
}

async function discover(){
  if(disco.map && Date.now()-disco.t < 6*3600000) return disco;
  const idx=await get(DD,7000);
  const nets=dirs(idx);
  const net=nets.find(d=>/^mb[-_]/i.test(d)&&/ag/i.test(d)) || nets.find(d=>/^mb[-_]/i.test(d)) || nets.find(d=>/manitoba/i.test(d));
  if(!net) throw new Error('no Manitoba network on partners shelf; saw: '+nets.slice(0,12).join(' '));
  const day=new Date(); const fmt=(d)=>d.toISOString().slice(0,10).replace(/-/g,'');
  let stns=null, used=null;
  for(const d of [fmt(day), fmt(new Date(day.getTime()-86400000))]){
    try{ stns=dirs(await get(DD+net+d+'/',7000)); used=d; break; }catch(e){}
  }
  if(!stns) throw new Error('network '+net+' has no listing for today/yesterday');
  const map={};
  for(const r of RING){ const hit=stns.find(d=>r.m.test(d)); map[r.id]=hit||null; }
  disco={net:net,day:used,stations:stns.length,map:map,t:Date.now()};
  return disco;
}

async function fetchProvincial(r,d){
  const dir=d.map[r.id];
  if(!dir) return Object.assign(base(r),{err:'no match among '+d.stations+' stations in '+d.net});
  try{
    const fl=files(await get(DD+d.net+d.day+'/'+dir,7000));
    if(!fl.length) return Object.assign(base(r),{err:'no xml in '+dir});
    const xml=await get(DD+d.net+d.day+'/'+dir+fl[fl.length-1],7000);
    const spd=xval(xml,'avg_wnd_spd_10m_pst(?:15|10|2)mts')??xval(xml,'avg_wnd_spd_10m_pst1hr');
    const gust=xval(xml,'max_wnd_gst_spd_10m_pst(?:15|10)mts')??xval(xml,'max_wnd_gst_spd_10m_pst1hr');
    const dirn=xval(xml,'avg_wnd_dir_10m_pst(?:15|10|2)mts')??xval(xml,'avg_wnd_dir_10m_pst1hr');
    const tm=xstr(xml,'date_tm');
    const age=tm?Math.round((Date.now()-Date.parse(tm))/60000):null;
    return Object.assign(base(r),{stn:xstr(xml,'stn_nam'),spd:spd,gust:gust,dir:dirn,obs:tm,age:age,via:d.net.replace(/\/$/,'')});
  }catch(e){ return Object.assign(base(r),{err:String(e.message||e)}); }
}

async function fetchCydn(){
  const d=0.045;
  const url='https://api.weather.gc.ca/collections/swob-realtime/items?f=json&limit=6&sortby=-date_tm-value'
    +'&bbox='+(CYDN.lon-d).toFixed(3)+','+(CYDN.lat-d).toFixed(3)+','+(CYDN.lon+d).toFixed(3)+','+(CYDN.lat+d).toFixed(3);
  try{
    const j=JSON.parse(await get(url,6500));
    const f=(j.features||[]).filter(x=>x&&x.properties)[0];
    if(!f) return Object.assign(base(CYDN),{err:'no SWOB station in bbox'});
    const p=f.properties;
    const pick=(re)=>{for(const k of Object.keys(p)){if(re.test(k)){const v=parseFloat(p[k]);if(!isNaN(v))return v;}}return null;};
    const tm=p['date_tm-value']||p['date_tm']||null;
    return Object.assign(base(CYDN),{stn:p['stn_nam-value']||p['stn_nam']||null,
      spd:pick(/^avg_wnd_spd_10m_pst(15|10|2)mts/)??pick(/^avg_wnd_spd_10m_pst1hr/),
      gust:pick(/^max_wnd_gst_spd_10m_pst(15|10)mts/)??pick(/^max_wnd_gst_spd_10m_pst1hr/),
      dir:pick(/^avg_wnd_dir_10m_pst(15|10|2)mts/)??pick(/^avg_wnd_dir_10m_pst1hr/),
      obs:tm, age:tm?Math.round((Date.now()-Date.parse(tm))/60000):null, via:'eccc-api'});
  }catch(e){ return Object.assign(base(CYDN),{err:String(e.message||e)}); }
}

export default async ()=>{
  if(cache.body && Date.now()-cache.t < 8*60000)
    return new Response(cache.body,{headers:H('hit')});
  let d=null, derr=null;
  try{ d=await discover(); }catch(e){ derr=String(e.message||e); }
  const prov=d ? await Promise.all(RING.map(r=>fetchProvincial(r,d)))
               : RING.map(r=>Object.assign(base(r),{err:'discovery: '+derr}));
  const cydn=await fetchCydn();
  const stations=[prov[0],cydn,...prov.slice(1)];
  const body=JSON.stringify({ok:true,t:Date.now(),
    src:d?('Manitoba network "'+d.net.replace(/\/$/,'')+'" on ECCC Datamart ('+d.stations+' stations listed) + ECCC API'):'ECCC API only (discovery failed)',
    stations:stations});
  cache={t:Date.now(),body:body};
  return new Response(body,{headers:H('miss')});
};
