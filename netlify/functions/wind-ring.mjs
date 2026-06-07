// Dauphin Lake Watch -- wind-ring: 8-station observation ring around the basin.
// Source: ECCC SWOB realtime (api.weather.gc.ca), name-agnostic bbox probe per station.
// Self-reporting: each station entry carries spd/gust/dir/obs/age OR its error string,
// so the first deploy doubles as reconnaissance of which stations flow through SWOB.
const RING=[
 {id:'sterose',  name:'Ste. Rose',      lat:51.0816, lon:-99.5237,  dist:19.3, brg:106},
 {id:'cydn',     name:'Dauphin Aprt',   lat:51.1008, lon:-100.0525, dist:18.6, brg:260},
 {id:'rorketon', name:'Rorketon',       lat:51.3327, lon:-99.4934,  dist:30.5, brg:43},
 {id:'laurier',  name:'Laurier',        lat:50.8753, lon:-99.6024,  dist:31.2, brg:155},
 {id:'keld',     name:'Keld',           lat:50.9929, lon:-100.2264, dist:34.0, brg:243},
 {id:'ashville', name:'Ashville',       lat:51.1623, lon:-100.2970, dist:35.5, brg:276},
 {id:'drifting', name:'Drifting River', lat:51.3575, lon:-100.3609, dist:47.0, brg:302},
 {id:'forkriver',name:'Fork River',     lat:51.5380, lon:-100.0062, dist:47.6, brg:342},
];
const H=(c)=>({'content-type':'application/json','access-control-allow-origin':'*','cache-control':'public,max-age=120','x-cache':c});
const base=(s)=>({id:s.id,name:s.name,dist:s.dist,brg:s.brg});
const pick=(p,re)=>{for(const k of Object.keys(p)){if(re.test(k)){const v=parseFloat(p[k]);if(!isNaN(v))return v;}}return null;};
let cache={t:0,body:null};

async function fetchStation(s){
  const d=0.045;
  const url='https://api.weather.gc.ca/collections/swob-realtime/items?f=json&limit=6&sortby=-date_tm-value'
    +'&bbox='+(s.lon-d).toFixed(3)+','+(s.lat-d).toFixed(3)+','+(s.lon+d).toFixed(3)+','+(s.lat+d).toFixed(3);
  const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(),6500);
  try{
    const r=await fetch(url,{signal:ctl.signal,headers:{accept:'application/json'}});
    if(!r.ok) return Object.assign(base(s),{err:'http '+r.status});
    const j=await r.json();
    const feats=(j.features||[]).filter(f=>f&&f.properties);
    if(!feats.length) return Object.assign(base(s),{err:'no SWOB station in bbox'});
    const p=feats[0].properties;
    const spd =pick(p,/^avg_wnd_spd_10m_pst(15|10|2)mts/) ?? pick(p,/^avg_wnd_spd_10m_pst1hr/);
    const gust=pick(p,/^max_wnd_gst_spd_10m_pst(15|10)mts/) ?? pick(p,/^max_wnd_gst_spd_10m_pst1hr/);
    const dir =pick(p,/^avg_wnd_dir_10m_pst(15|10|2)mts/) ?? pick(p,/^avg_wnd_dir_10m_pst1hr/);
    const tm=p['date_tm-value']||p['date_tm']||null;
    const age=tm?Math.round((Date.now()-Date.parse(tm))/60000):null;
    return Object.assign(base(s),{stn:p['stn_nam-value']||p['stn_nam']||null,spd:spd,gust:gust,dir:dir,obs:tm,age:age});
  }catch(e){
    return Object.assign(base(s),{err:(e&&e.name==='AbortError')?'timeout':String(e)});
  }finally{clearTimeout(to);}
}

export default async ()=>{
  if(cache.body && Date.now()-cache.t < 8*60000)
    return new Response(cache.body,{headers:H('hit')});
  const stations=await Promise.all(RING.map(fetchStation));
  const body=JSON.stringify({ok:true,t:Date.now(),src:'ECCC SWOB via api.weather.gc.ca (bbox probe)',stations:stations});
  cache={t:Date.now(),body:body};
  return new Response(body,{headers:H('miss')});
};
