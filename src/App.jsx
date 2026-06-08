import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { loadAll, insertJob, updateJob, deleteJobDb, setCapacityDb, clearCapacityDb, setDeptResDb, seedIfEmpty } from './data'

// ─── Constants ───────────────────────────────────────────────
const DEPTS = [
  { key:'design',      label:'Design',         res:3,  color:'#185FA5', bg:'#E6F1FB', text:'#0C447C' },
  { key:'laser',       label:'Laser Cutting',  res:4,  color:'#0F6E56', bg:'#E1F5EE', text:'#085041' },
  { key:'deburring',   label:'Deburring',      res:4,  color:'#854F0B', bg:'#FAEEDA', text:'#633806' },
  { key:'folding',     label:'Folding',        res:6,  color:'#533AB7', bg:'#EEEDFE', text:'#26215C' },
  { key:'fabrication', label:'Fabrication',    res:10, color:'#993556', bg:'#FBEAF0', text:'#72243E' },
  { key:'machining',   label:'Machining',      res:4,  color:'#3B6D11', bg:'#EAF3DE', text:'#173404' },
  { key:'finishing',   label:'Finishing',      res:4,  color:'#A32D2D', bg:'#FCEBEB', text:'#791F1F' },
  { key:'powder',      label:'Powder Coating', res:3,  color:'#BA7517', bg:'#FFF3DC', text:'#412402' },
  { key:'qa',          label:'QA',             res:2,  color:'#5F5E5A', bg:'#F1EFE8', text:'#2C2C2A' },
]
// Back-compat: old data used 'secondary' for what is now 'machining'
const LEGACY_MAP = { secondary:'machining' }
const DKEYS = DEPTS.map(d => d.key)
const STATUS = {
  scheduled:{dot:'#3B74BF',label:'Scheduled'},
  in_progress:{dot:'#39BF5B',label:'In Progress'},
  done:{dot:'#2ecc71',label:'Done'},
  delayed:{dot:'#e74c3c',label:'Delayed'},
}
const PRIORITY = {
  high:{label:'High', rank:0, color:'#e74c3c'},
  normal:{label:'Normal', rank:1, color:'#3B74BF'},
  low:{label:'Low', rank:2, color:'#888'},
}
const DEF_CAP = 480, WD = 480
const DAY_START = 8, DAY_END = 17

// ─── Helpers ─────────────────────────────────────────────────
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
const parseD = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d) }
const addDays = (s,n) => { const d = parseD(s); d.setDate(d.getDate()+n); return fmt(d) }
const isWknd = s => { const w = parseD(s).getDay(); return w===0||w===6 }
const nextWd = s => { let d = addDays(s,1); while(isWknd(d)) d = addDays(d,1); return d }
const fmtM = m => { m=Math.round(m||0); const h=Math.floor(m/60),r=m%60; return h>0?(r>0?`${h}h ${r}m`:`${h}h`):`${r}m` }
const fmtT = m => { const h=Math.floor(m/60)%24,mn=m%60; return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}` }
const deptOf = k => DEPTS.find(d=>d.key===k)||DEPTS[0]
const todayStr = () => fmt(new Date())
const dowLabel = s => ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][parseD(s).getDay()]
const dateLE = (a,b) => a <= b // ISO date strings compare correctly

// Migrate a job's deptMins/waits/resources/done keys from legacy names
function migrateJob(job){
  const remap = obj => {
    if(!obj) return obj
    const out = {...obj}
    for(const [oldK,newK] of Object.entries(LEGACY_MAP)){
      if(oldK in out){ if(!(newK in out) || !out[newK]) out[newK] = out[oldK]; delete out[oldK] }
    }
    return out
  }
  return {
    priority:'normal', dueDate:'',
    ...job,
    deptMins:remap(job.deptMins),
    waits:remap(job.waits),
    resources:remap(job.resources),
    done:remap(job.done||{}),
    actual:remap(job.actual||{}),
  }
}

// ─── (Seed data now lives in the database; first run seeds dept resources only) ───


export default function App({ session }) {
  const [jobs, setJobsRaw] = useState([])
  const setJobs = arr => setJobsRaw(arr.map(migrateJob))

  const [capacity, setCapacity] = useState({})
  const [deptRes, setDeptRes] = useState(() => Object.fromEntries(DEPTS.map(d=>[d.key,d.res])))
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)

  const [view, setView] = useState('month')
  const [anchor, setAnchor] = useState(() => todayStr())
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y:d.getFullYear(), m:d.getMonth() } })
  const [tab, setTab] = useState('all')
  const [modal, setModal] = useState(null)
  const [editId, setEditId] = useState(null)
  const [capEdit, setCapEdit] = useState(null)
  const [capVal, setCapVal] = useState('')
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false) // schedule changed, awaiting reschedule
  const [dragJob, setDragJob] = useState(null) // {jobId, dept}

  // Load all data from Supabase, then subscribe to realtime changes
  async function refresh() {
    try {
      const { jobs:j, capacity:c, deptRes:r } = await loadAll()
      setJobsRaw(j.map(migrateJob))
      setCapacity(c)
      if (Object.keys(r).length) setDeptRes(r)
      setLoadErr(null)
    } catch (e) {
      setLoadErr(e.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    ;(async () => {
      // Seed default dept resources on very first run
      try { await seedIfEmpty(Object.fromEntries(DEPTS.map(d=>[d.key,d.res]))) } catch {}
      if (active) await refresh()
    })()

    // Realtime: any change to any table → reload (simple + reliable)
    const channel = supabase
      .channel('planner-changes')
      .on('postgres_changes', { event:'*', schema:'public', table:'jobs' }, () => refresh())
      .on('postgres_changes', { event:'*', schema:'public', table:'capacity' }, () => refresh())
      .on('postgres_changes', { event:'*', schema:'public', table:'dept_resources' }, () => refresh())
      .subscribe()

    return () => { active = false; supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const TODAY = todayStr()
  const capOf = (dk,date) => (capacity[dk]||{})[date] ?? DEF_CAP
  const resOf = dk => deptRes[dk] ?? (DEPTS.find(d=>d.key===dk)||{}).res ?? 1
  const manCap = (dk,date) => resOf(dk) * capOf(dk,date)
  const waitMins = w => (!w||!w.amount)?0:w.unit==='hours'?w.amount*60:w.unit==='days'?w.amount*1440:Number(w.amount)||0

  function advCursor(cur, mins){
    let { date, min } = cur, rem = mins
    while(rem>0){
      if(isWknd(date)){ date=addDays(date,1); min=WD; continue }
      const avail = WD+DEF_CAP-min
      if(avail<=0){ date=addDays(date,1); min=WD; continue }
      if(rem<=avail){ min+=rem; rem=0 } else { rem-=avail; date=addDays(date,1); min=WD }
    }
    return { date, min }
  }

  // ── Scheduling engine (priority → due → start; forward; locked done steps) ──
  const { entries, jobFinish } = useMemo(() => {
    const ordered = [...jobs].sort((a,b)=>{
      const pa=PRIORITY[a.priority||'normal'].rank, pb=PRIORITY[b.priority||'normal'].rank
      if(pa!==pb) return pa-pb
      const da=a.dueDate||'9999-12-31', db=b.dueDate||'9999-12-31'
      if(da!==db) return da<db?-1:1
      if(a.startDate!==b.startDate) return a.startDate<b.startDate?-1:1
      return a.id-b.id
    })
    const ents = []
    const finish = {}
    for(const job of ordered){
      const phases = DKEYS.filter(k => (job.deptMins[k]||0)>0)
      if(!phases.length) continue
      let cur = { date:job.startDate, min:WD }
      while(isWknd(cur.date)) cur = { date:addDays(cur.date,1), min:WD }
      let lastEnd = null
      for(let pi=0; pi<phases.length; pi++){
        const dk = phases[pi]
        const isDone = !!(job.done||{})[dk]
        if(dk==='laser' && job.materialDate && job.materialDate>cur.date){
          cur = { date:job.materialDate, min:WD }
          while(isWknd(cur.date)) cur = { date:addDays(cur.date,1), min:WD }
        }
        if(pi>0){
          const wm = waitMins((job.waits||{})[phases[pi-1]]||{})
          if(wm>0){ cur = advCursor(cur,wm); if(isWknd(cur.date)) cur = { date:nextWd(cur.date), min:WD } }
        }
        const jr = (job.resources||{})[dk]||0
        const actualRes = jr>0 ? Math.min(jr, resOf(dk)) : 1
        // use actual minutes if recorded, else estimate
        let remMM = ((job.actual||{})[dk] && isDone) ? job.actual[dk] : job.deptMins[dk]
        const stepStartDate = cur.date
        while(remMM>0){
          if(isWknd(cur.date)){ cur={date:addDays(cur.date,1),min:WD}; continue }
          const usedMM = ents.filter(e=>e.dept===dk&&e.date===cur.date).reduce((s,e)=>s+e.manMins,0)
          const availMM = Math.max(0, manCap(dk,cur.date)-usedMM)
          if(availMM<=0){ cur={date:addDays(cur.date,1),min:WD}; continue }
          const dayE = ents.filter(e=>e.dept===dk&&e.date===cur.date).sort((a,b)=>a.s-b.s)
          let ss = Math.max(cur.min, WD), dayEnd = WD+capOf(dk,cur.date)
          for(const e of dayE){ if(e.e<=ss) continue; if(e.s<=ss) ss=e.e }
          if(ss>=dayEnd){ cur={date:addDays(cur.date,1),min:WD}; continue }
          let se = dayEnd
          for(const e of dayE){ if(e.s>ss) se=Math.min(se,e.s) }
          const takeMM = Math.min(remMM, (se-ss)*actualRes, availMM)
          if(takeMM<=0){ cur={date:addDays(cur.date,1),min:WD}; continue }
          const wallUsed = Math.ceil(takeMM/actualRes)
          ents.push({ jobId:job.id, dept:dk, date:cur.date, s:ss, e:ss+wallUsed, mins:wallUsed, resources:actualRes, manMins:takeMM, done:isDone, phaseIndex:pi })
          remMM -= takeMM
          cur = { date:cur.date, min:ss+wallUsed }
          if(cur.min>=dayEnd && remMM>0) cur = { date:addDays(cur.date,1), min:WD }
        }
        lastEnd = cur.date
      }
      finish[job.id] = lastEnd
    }
    return { entries:ents, jobFinish:finish }
  }, [jobs, capacity, deptRes])

  // is a job's step "ready" (all prior steps done)?
  const stepReady = (job, dept) => {
    const phases = DKEYS.filter(k => (job.deptMins[k]||0)>0)
    const idx = phases.indexOf(dept)
    if(idx<=0) return true
    for(let i=0;i<idx;i++){ if(!(job.done||{})[phases[i]]) return false }
    return true
  }

  const show = tab==='all' ? DEPTS : DEPTS.filter(d=>d.key===tab)

  // ── Reusable bits ──
  const capBadge = (dk, date) => {
    const de = entries.filter(e=>e.dept===dk&&e.date===date)
    const usedMM = de.reduce((s,e)=>s+e.manMins,0), totMM = manCap(dk,date)
    const over=usedMM>totMM, warn=!over&&totMM>0&&usedMM>totMM*0.8
    const cbg=over?'#FCEBEB':warn?'#FFF3DC':'#EAF3DE', ctxt=over?'#7a1e1e':warn?'#633806':'#1a5c2e'
    return (
      <span className="cb" style={{background:cbg,color:ctxt}}
            onClick={e=>{e.stopPropagation();setCapEdit(`${dk}|${date}`);setCapVal(String(capOf(dk,date)));setModal('cap')}}>
        {fmtM(usedMM)}/{fmtM(totMM)}
      </span>
    )
  }

  // remaining (available) minutes summary footer per dept for a set of dates
  const availSummary = (dates) => (
    <div className="avail-bar">
      {DEPTS.filter(d=>tab==='all'||d.key===tab).map(dp=>{
        let used=0, tot=0
        for(const date of dates){ if(isWknd(date)) continue; used += entries.filter(e=>e.dept===dp.key&&e.date===date).reduce((s,e)=>s+e.manMins,0); tot += manCap(dp.key,date) }
        const rem = tot-used
        const over = rem<0
        return (
          <div key={dp.key} className="avail-item" title={`${dp.label}: ${fmtM(rem)} free of ${fmtM(tot)}`}>
            <span className="avail-dot" style={{background:dp.color}} />
            <span className="avail-lbl">{dp.label}</span>
            <span className="avail-val" style={{color:over?'#c0392b':'#1a5c2e'}}>{over?'-':''}{fmtM(Math.abs(rem))} free</span>
          </div>
        )
      })}
    </div>
  )

  const dueChip = job => {
    if(!job.dueDate) return null
    const fin = jobFinish[job.id]
    const late = fin && fin>job.dueDate
    return <span className="due-chip" style={{background:late?'#FCEBEB':'#EAF3DE',color:late?'#7a1e1e':'#1a5c2e'}}>{late?'⚠ ':''}Due {parseD(job.dueDate).toLocaleString('default',{day:'numeric',month:'short'})}</span>
  }

  const jobPill = (e, i, withTime=true) => {
    const job=jobs.find(j=>j.id===e.jobId); if(!job) return null
    const dp=deptOf(e.dept)
    const ready = stepReady(job, e.dept)
    const done = e.done
    // colour state: done = solid green tint check; not ready = hollow/grey; ready = normal dept colour
    let bg=dp.bg, txt=dp.text, bl=dp.color, opacity=1, dash=false
    if(done){ bg='#EAF7EE'; txt='#1a5c2e'; bl='#2ecc71' }
    else if(!ready){ bg='#f4f4f4'; txt='#999'; bl='#ccc'; dash=true }
    const prio = PRIORITY[job.priority||'normal']
    return (
      <div key={i} className="pill" draggable={!done}
           style={{background:bg,color:txt,borderLeft:`${dash?'2px dashed':'2px solid'} ${bl}`,opacity}}
           title={`${job.title} | ${fmtT(e.s)}–${fmtT(e.e)} | ${fmtM(e.mins)} | ×${e.resources}${done?' | DONE':ready?'':' | waiting on previous step'}`}
           onClick={ev=>{ev.stopPropagation();openEdit(job.id)}}
           onDragStart={()=>!done&&setDragJob({jobId:job.id,dept:e.dept})}
           onDragEnd={()=>setDragJob(null)}>
        <span className="tick" onClick={ev=>{ev.stopPropagation();toggleDone(job.id,e.dept)}} title="Mark this step done">
          {done?'✓':'○'}
        </span>
        {job.priority==='high' && <span className="prio-dot" style={{background:prio.color}} title="High priority" />}
        <span style={{overflow:'hidden',textOverflow:'ellipsis',flex:1,fontWeight:600,textDecoration:done?'line-through':'none'}}>{job.title}</span>
        {e.resources>1 && <span style={{background:bl,color:'#fff',borderRadius:2,padding:'0 3px',fontSize:8,fontWeight:700,flexShrink:0}}>×{e.resources}</span>}
        {withTime && <span style={{opacity:.6,fontSize:8,flexShrink:0}}>{fmtT(e.s)}</span>}
      </div>
    )
  }

  // drop a dragged step onto a later date → set that job's start (or push) and mark dirty
  const onDropDate = (date) => {
    if(!dragJob) return
    const job = jobs.find(j=>j.id===dragJob.jobId); if(!job){ setDragJob(null); return }
    const cur = entries.filter(e=>e.dept===dragJob.dept&&e.jobId===job.id).sort((a,b)=>a.date<b.date?-1:1)[0]
    if(!cur){ setDragJob(null); return }
    if(date<=cur.date){ setDragJob(null); return }
    const deltaDays = (parseD(date)-parseD(cur.date))/(1000*60*60*24)
    const newStart = addDays(job.startDate, Math.round(deltaDays))
    const updated = {...job, startDate:newStart}
    setJobs(jobs.map(j=>j.id===job.id?updated:j))
    updateJob(updated).catch(e=>setLoadErr(e.message))
    setDirty(true)
    setDragJob(null)
  }

  const toggleDone = (jobId, dept) => {
    const job = jobs.find(j=>j.id===jobId); if(!job) return
    const done={...(job.done||{})}; done[dept]=!done[dept]
    const updated = {...job, done}
    setJobs(jobs.map(j=>j.id===jobId?updated:j))
    updateJob(updated).catch(e=>setLoadErr(e.message))
    setDirty(true)
  }

  // Reschedule = pull not-started jobs whose start is in the past up to today.
  const rescheduleNow = async () => {
    const changed = []
    const next = jobs.map(j=>{
      const phases = DKEYS.filter(k => (j.deptMins[k]||0)>0)
      const allDone = phases.every(p=>(j.done||{})[p])
      if(allDone) return j
      const anyDone = phases.some(p=>(j.done||{})[p])
      let ns = j.startDate
      if(!anyDone && j.startDate < TODAY) ns = isWknd(TODAY)?nextWd(TODAY):TODAY
      if(ns!==j.startDate){ const u={...j,startDate:ns}; changed.push(u); return u }
      return j
    })
    setJobs(next)
    setDirty(false)
    for(const u of changed){ try { await updateJob(u) } catch(e){ setLoadErr(e.message) } }
  }

  // ── Calendars ──
  const monthDays = () => {
    const { y, m } = cursor
    const first = new Date(y,m,1), off = first.getDay()
    const days = []
    for(let i=0;i<off;i++){ const d=new Date(y,m,1-off+i); days.push({date:fmt(d),inM:false}) }
    for(let i=1;i<=new Date(y,m+1,0).getDate();i++) days.push({date:fmt(new Date(y,m,i)),inM:true})
    while(days.length%7!==0){ const p=parseD(days[days.length-1].date); p.setDate(p.getDate()+1); days.push({date:fmt(p),inM:false}) }
    return days
  }
  const weekDays = () => { const d=parseD(anchor),dow=d.getDay(),start=addDays(anchor,-dow); return Array.from({length:7},(_,i)=>addDays(start,i)) }

  let headerLabel = ''
  if(view==='month') headerLabel = new Date(cursor.y,cursor.m,1).toLocaleString('default',{month:'long',year:'numeric'})
  else if(view==='week'){ const w=weekDays(); headerLabel = `${parseD(w[0]).toLocaleString('default',{day:'numeric',month:'short'})} – ${parseD(w[6]).toLocaleString('default',{day:'numeric',month:'short',year:'numeric'})}` }
  else headerLabel = parseD(anchor).toLocaleString('default',{weekday:'long',day:'numeric',month:'long',year:'numeric'})

  const navPrev = () => { if(view==='month'){ let nm=cursor.m-1,ny=cursor.y; if(nm<0){nm=11;ny--} setCursor({y:ny,m:nm}) } else if(view==='week') setAnchor(addDays(anchor,-7)); else setAnchor(addDays(anchor,-1)) }
  const navNext = () => { if(view==='month'){ let nm=cursor.m+1,ny=cursor.y; if(nm>11){nm=0;ny++} setCursor({y:ny,m:nm}) } else if(view==='week') setAnchor(addDays(anchor,7)); else setAnchor(addDays(anchor,1)) }
  const goToday = () => { const d=new Date(); setCursor({y:d.getFullYear(),m:d.getMonth()}); setAnchor(todayStr()) }
  const zoomToDay = date => { setAnchor(date); setView('day') }

  const emptyForm = () => ({ title:'', startDate:TODAY, dueDate:'', materialDate:'', status:'scheduled', priority:'normal', notes:'',
    deptMins:Object.fromEntries(DKEYS.map(k=>[k,0])),
    waits:Object.fromEntries(DKEYS.map(k=>[k,{amount:0,unit:'mins'}])),
    resources:Object.fromEntries(DKEYS.map(k=>[k,0])),
    done:Object.fromEntries(DKEYS.map(k=>[k,false])),
    actual:Object.fromEntries(DKEYS.map(k=>[k,''])) })

  function openAdd(date){ setForm({...emptyForm(), startDate:date||TODAY}); setEditId(null); setModal('job') }
  function openEdit(id){
    const job = jobs.find(j=>j.id===id); if(!job) return
    setForm({ title:job.title, startDate:job.startDate, dueDate:job.dueDate||'', materialDate:job.materialDate||'', status:job.status, priority:job.priority||'normal', notes:job.notes||'',
      deptMins:{...Object.fromEntries(DKEYS.map(k=>[k,0])),...job.deptMins},
      waits:{...Object.fromEntries(DKEYS.map(k=>[k,{amount:0,unit:'mins'}])),...(job.waits||{})},
      resources:{...Object.fromEntries(DKEYS.map(k=>[k,0])),...(job.resources||{})},
      done:{...Object.fromEntries(DKEYS.map(k=>[k,false])),...(job.done||{})},
      actual:{...Object.fromEntries(DKEYS.map(k=>[k,''])),...(job.actual||{})} })
    setEditId(id); setModal('job')
  }
  async function saveJob(){
    if(!form.title.trim()) return
    const data = { title:form.title.trim(), startDate:form.startDate, dueDate:form.dueDate, materialDate:form.materialDate, status:form.status, priority:form.priority, notes:form.notes, deptMins:form.deptMins, waits:form.waits, resources:form.resources, done:form.done, actual:form.actual }
    setDirty(true); setModal(null)
    try {
      if(editId!==null){
        const updated = {...jobs.find(j=>j.id===editId), ...data, id:editId}
        setJobs(jobs.map(j=>j.id===editId?updated:j))
        await updateJob(updated)
      } else {
        const created = await insertJob(data)   // DB assigns the id
        setJobs([...jobs, created])
      }
    } catch(e){ setLoadErr(e.message) }
  }
  async function deleteJob(id){
    setJobs(jobs.filter(j=>j.id!==id)); setDirty(true); setModal(null)
    try { await deleteJobDb(id) } catch(e){ setLoadErr(e.message) }
  }
  const totalMins = form ? DKEYS.reduce((s,k)=>s+(Number(form.deptMins[k])||0),0) : 0

  return (
    <div className="app">
      <header className="hdr">
        <img src="/dm-logo.png" alt="D&M Design & Fabrication" />
        <div>
          <div className="hdr-title">D&M Design &amp; Fabrication</div>
          <div className="hdr-sub">Production Planner</div>
        </div>
        <div className="hdr-right">
          <span className="hdr-user">{session?.user?.email}</span>
          <button className="hdr-signout" onClick={()=>supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {loadErr && <div className="reschedule-banner" style={{background:'#FCEBEB',borderColor:'#e74c3c',color:'#7a1e1e'}}>⚠ {loadErr}</div>}
      {loading && <div style={{padding:24,textAlign:'center',color:'#888'}}>Loading schedule…</div>}

      {dirty && (
        <div className="reschedule-banner">
          <span>⟳ Schedule affected by your changes.</span>
          <div style={{display:'flex',gap:8}}>
            <button className="btn-green" onClick={rescheduleNow}>Reschedule now</button>
            <button className="btn" onClick={()=>setDirty(false)}>Later</button>
          </div>
        </div>
      )}

      <div className="content">
        <div className="toolbar">
          <button className="btn" onClick={navPrev}>‹</button>
          <span className="ml">{headerLabel}</span>
          <button className="btn" onClick={navNext}>›</button>
          <button className="btn" onClick={goToday}>Today</button>
          <div className="vtoggle">
            <button className={`vtab ${view==='month'?'on':''}`} onClick={()=>setView('month')}>Month</button>
            <button className={`vtab ${view==='week'?'on':''}`} onClick={()=>setView('week')}>Week</button>
            <button className={`vtab ${view==='day'?'on':''}`} onClick={()=>setView('day')}>Day</button>
          </div>
          <div style={{flex:1}} />
          <button className="btn-blue" onClick={()=>setModal('resources')}>⚙ Resources</button>
          <button className="btn-green" onClick={()=>openAdd(view==='month'?undefined:anchor)}>+ Add Job</button>
        </div>

        <div className="legend">
          {Object.entries(STATUS).map(([k,v])=>(<span className="li" key={k}><span className="li-dot" style={{background:v.dot}} />{v.label}</span>))}
          <span className="li"><span className="tick" style={{position:'static'}}>○</span>not done</span>
          <span className="li"><span className="tick" style={{position:'static',color:'#2ecc71'}}>✓</span>done</span>
          <span style={{fontSize:10,color:'#aaa'}}>Tap ○ to complete · drag a job later to delay · grey = waiting on previous step</span>
        </div>

        <div className="tabs">
          <button className={`tab ${tab==='all'?'on':''}`} style={tab==='all'?{borderBottomColor:'#39BF5B'}:{}} onClick={()=>setTab('all')}>All</button>
          {DEPTS.map(d=>(<button key={d.key} className={`tab ${tab===d.key?'on':''}`} style={tab===d.key?{borderBottomColor:d.color}:{}} onClick={()=>setTab(d.key)}>{d.label}</button>))}
        </div>

        {/* MONTH */}
        {view==='month' && (<>
          <div className="cal">
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=><div className="dhdr" key={d}>{d}</div>)}
            {monthDays().map(({date,inM})=>{
              const isT=date===TODAY, wknd=isWknd(date)
              return (
                <div key={date} className={`cell${!inM?' other':''}${isT?' tod':''}${wknd?' wknd':''}`}
                     onClick={()=>openAdd(date)}
                     onDragOver={e=>{if(dragJob&&!wknd)e.preventDefault()}}
                     onDrop={()=>!wknd&&onDropDate(date)}>
                  <div className="cell-top">
                    <span className={`dn${isT?' now':''}`}>{parseD(date).getDate()}</span>
                    {inM && !wknd && <button className="zoom-btn" title="Open this day" onClick={e=>{e.stopPropagation();zoomToDay(date)}}>⤢</button>}
                  </div>
                  {show.map(dp=>{
                    const de = entries.filter(e=>e.dept===dp.key&&e.date===date).sort((a,b)=>a.s-b.s)
                    return (
                      <div key={dp.key}>
                        {inM && !wknd && (tab==='all' ? (
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginTop:2}}>
                            <span className="dl" style={{color:dp.color}}>{dp.label}</span>{capBadge(dp.key,date)}
                          </div>
                        ) : (<div style={{marginBottom:3}}>{capBadge(dp.key,date)} <span style={{fontSize:9,color:'#aaa'}}>{resOf(dp.key)} res</span></div>))}
                        {de.map((e,i)=>jobPill(e,i))}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {availSummary(monthDays().filter(d=>d.inM).map(d=>d.date))}
        </>)}

        {/* WEEK */}
        {view==='week' && (<>
          <div className="week-grid">
            {weekDays().map(date=>{
              const isT=date===TODAY, wknd=isWknd(date)
              return (
                <div key={date} className={`week-col${isT?' tod':''}${wknd?' wknd':''}`}
                     onDragOver={e=>{if(dragJob&&!wknd)e.preventDefault()}} onDrop={()=>!wknd&&onDropDate(date)}>
                  <div className="week-head" onClick={()=>zoomToDay(date)}>
                    <span className="week-dow">{dowLabel(date)}</span>
                    <span className={`week-dnum${isT?' now':''}`}>{parseD(date).getDate()}</span>
                  </div>
                  <div className="week-body" onClick={()=>openAdd(date)}>
                    {wknd ? <div className="wknd-note">Weekend</div> : show.map(dp=>{
                      const de = entries.filter(e=>e.dept===dp.key&&e.date===date).sort((a,b)=>a.s-b.s)
                      if(de.length===0 && tab!=='all') return null
                      return (
                        <div key={dp.key} style={{marginBottom:5}}>
                          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                            <span className="dl" style={{color:dp.color}}>{dp.label}</span>{capBadge(dp.key,date)}
                          </div>
                          {de.map((e,i)=>jobPill(e,i))}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
          {availSummary(weekDays())}
        </>)}

        {/* DAY */}
        {view==='day' && (() => {
          const date = anchor, wknd = isWknd(date)
          const hours = []; for(let hH=DAY_START; hH<=DAY_END; hH++) hours.push(hH)
          const colDepts = tab==='all' ? DEPTS : DEPTS.filter(d=>d.key===tab)
          const HOUR_PX = 56
          const minToY = mins => ((mins - DAY_START*60) / 60) * HOUR_PX
          return (
            <>
              <div className="day-wrap"
                   onDragOver={e=>{if(dragJob&&!wknd)e.preventDefault()}} onDrop={()=>!wknd&&onDropDate(date)}>
                {wknd && <div className="wknd-note" style={{padding:'14px'}}>This is a weekend — no production scheduled. Use ‹ › to move to a weekday.</div>}
                {!wknd && (
                  <div className="day-grid" style={{gridTemplateColumns:`52px repeat(${colDepts.length}, minmax(120px,1fr))`}}>
                    <div className="day-corner" />
                    {colDepts.map(dp=>(
                      <div key={dp.key} className="day-colhead" style={{borderTopColor:dp.color}}>
                        <span style={{color:dp.color,fontWeight:700}}>{dp.label}</span>
                        <span style={{fontSize:9,color:'#999'}}>{resOf(dp.key)} res · {capBadge(dp.key,date)}</span>
                      </div>
                    ))}
                    <div className="day-gutter" style={{height:(DAY_END-DAY_START)*HOUR_PX}}>
                      {hours.map(hH=>(<div key={hH} className="day-hour" style={{height:HOUR_PX}}>{String(hH).padStart(2,'0')}:00</div>))}
                    </div>
                    {colDepts.map(dp=>{
                      const de = entries.filter(e=>e.dept===dp.key&&e.date===date).sort((a,b)=>a.s-b.s)
                      return (
                        <div key={dp.key} className="day-lane" style={{height:(DAY_END-DAY_START)*HOUR_PX}} onClick={()=>openAdd(date)}>
                          {hours.map(hH=><div key={hH} className="day-slot" style={{height:HOUR_PX}} />)}
                          {de.map((e,i)=>{
                            const job=jobs.find(j=>j.id===e.jobId); if(!job) return null
                            const ready=stepReady(job,e.dept), done=e.done
                            let bg=dp.bg,bl=dp.color,txt=dp.text
                            if(done){bg='#EAF7EE';bl='#2ecc71';txt='#1a5c2e'} else if(!ready){bg='#f4f4f4';bl='#ccc';txt='#999'}
                            const top=minToY(e.s), height=Math.max(20,((e.e-e.s)/60)*HOUR_PX)
                            return (
                              <div key={i} className="day-block" draggable={!done}
                                   style={{top,height,background:bg,borderLeft:`3px ${!ready&&!done?'dashed':'solid'} ${bl}`,color:txt}}
                                   title={`${job.title} | ${fmtT(e.s)}–${fmtT(e.e)} | ${fmtM(e.mins)} | ×${e.resources}`}
                                   onClick={ev=>{ev.stopPropagation();openEdit(job.id)}}
                                   onDragStart={()=>!done&&setDragJob({jobId:job.id,dept:e.dept})} onDragEnd={()=>setDragJob(null)}>
                                <div style={{display:'flex',alignItems:'center',gap:3}}>
                                  <span className="tick" style={{position:'static'}} onClick={ev=>{ev.stopPropagation();toggleDone(job.id,e.dept)}}>{done?'✓':'○'}</span>
                                  <strong style={{fontSize:10,overflow:'hidden',textOverflow:'ellipsis'}}>{job.title}</strong>
                                  {e.resources>1 && <span style={{background:bl,color:'#fff',borderRadius:2,padding:'0 3px',fontSize:8,fontWeight:700}}>×{e.resources}</span>}
                                </div>
                                <div style={{fontSize:8,opacity:.7}}>{fmtT(e.s)}–{fmtT(e.e)}</div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
              {!wknd && availSummary([date])}
            </>
          )
        })()}
      </div>

      {/* Capacity modal */}
      {modal==='cap' && capEdit && (() => {
        const [dk,ds]=capEdit.split('|'), dp=deptOf(dk), res=resOf(dk)
        return (
          <div className="mwrap" onClick={()=>setModal(null)}>
            <div className="mbox" onClick={e=>e.stopPropagation()}>
              <div className="mh"><h2>Capacity — {dp.label}</h2><button className="x" onClick={()=>setModal(null)}>×</button></div>
              <div className="mb">
                <div style={{fontSize:12,color:'#666',marginBottom:10}}>{ds} · {res} resource{res!==1?'s':''}</div>
                <label className="lbl">Minutes per resource (default 480 = 8h)</label>
                <input type="number" min="0" max="1440" value={capVal} onChange={e=>setCapVal(e.target.value)} />
                <div style={{fontSize:10,color:'#888',marginTop:4}}>{fmtM(parseInt(capVal)||0)} each · total {fmtM((parseInt(capVal)||0)*res)}</div>
              </div>
              <div className="mf">
                <button className="btn-del" onClick={()=>{ const c={...capacity}; if(c[dk]) delete c[dk][ds]; setCapacity(c); clearCapacityDb(dk,ds).catch(e=>setLoadErr(e.message)); setDirty(true); setModal(null) }}>Reset</button>
                <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
                <button className="btn-green" onClick={()=>{ const v=parseInt(capVal)||0; setCapacity({...capacity,[dk]:{...(capacity[dk]||{}),[ds]:v}}); setCapacityDb(dk,ds,v).catch(e=>setLoadErr(e.message)); setDirty(true); setModal(null) }}>Save</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Resources modal */}
      {modal==='resources' && (
        <div className="mwrap" onClick={()=>setModal(null)}>
          <div className="mbox" onClick={e=>e.stopPropagation()}>
            <div className="mh"><h2>Department Resources</h2><button className="x" onClick={()=>setModal(null)}>×</button></div>
            <div className="mb">
              <p style={{fontSize:12,color:'#666',marginBottom:10}}>Number of men or machines per department. Sets total daily man-minute capacity.</p>
              <table className="dtbl">
                <thead><tr><th>Department</th><th>Resources</th></tr></thead>
                <tbody>
                  {DEPTS.map(d=>(
                    <tr key={d.key}>
                      <td><span style={{display:'inline-flex',alignItems:'center',gap:5}}><span style={{width:8,height:8,borderRadius:2,background:d.color,display:'inline-block'}} /><strong>{d.label}</strong></span></td>
                      <td style={{width:100}}><input type="number" min="1" max="99" value={resOf(d.key)} onChange={e=>{const v=parseInt(e.target.value)||1; setDeptRes({...deptRes,[d.key]:v}); setDeptResDb(d.key,v).catch(er=>setLoadErr(er.message)); setDirty(true)}} style={{width:80,textAlign:'center'}} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mf"><button className="btn-green" onClick={()=>setModal(null)}>Done</button></div>
          </div>
        </div>
      )}

      {/* Job modal */}
      {modal==='job' && form && (
        <div className="mwrap" onClick={()=>setModal(null)}>
          <div className="mbox" onClick={e=>e.stopPropagation()}>
            <div className="mh"><h2>{editId!==null?'Edit Job':'New Job'}</h2><button className="x" onClick={()=>setModal(null)}>×</button></div>
            <div className="mb">
              <div className="fr2">
                <div><label className="lbl">Job title</label><input type="text" value={form.title} placeholder="e.g. Control Panel Enclosure" onChange={e=>setForm({...form,title:e.target.value})} /></div>
                <div><label className="lbl">Priority</label><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{Object.entries(PRIORITY).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
              </div>
              <div className="fr3" style={{marginTop:8}}>
                <div><label className="lbl">Start date</label><input type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})} /></div>
                <div><label className="lbl">Delivery / Due</label><input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} /></div>
                <div><label className="lbl">Material due <span className="tag">LASER</span></label><input type="date" value={form.materialDate} onChange={e=>setForm({...form,materialDate:e.target.value})} /></div>
              </div>
              <div className="stitle">Departments — time, wait, resources &amp; completion</div>
              <div className="sbox">
                <table className="dtbl" style={{minWidth:480}}>
                  <thead><tr><th>Dept</th><th style={{width:54}}>Est. min</th><th style={{width:96}}>Wait after</th><th style={{width:48}}>Res</th><th style={{width:40}}>Done</th><th style={{width:54}}>Actual</th></tr></thead>
                  <tbody>
                    {DEPTS.map(d=>{
                      const w=form.waits[d.key]||{amount:0,unit:'mins'}, mx=resOf(d.key)
                      return (
                        <tr key={d.key}>
                          <td style={{whiteSpace:'nowrap'}}><span style={{display:'inline-flex',alignItems:'center',gap:4}}><span style={{width:7,height:7,borderRadius:2,background:d.color,display:'inline-block',flexShrink:0}} /><strong style={{fontSize:11}}>{d.label}</strong>{d.key==='laser'&&<span className="tag">MAT.</span>}</span></td>
                          <td><input type="number" min="0" value={form.deptMins[d.key]||''} placeholder="0" onChange={e=>setForm({...form,deptMins:{...form.deptMins,[d.key]:parseInt(e.target.value)||0}})} style={{textAlign:'right'}} /></td>
                          <td><div style={{display:'flex',gap:3}}>
                            <input type="number" min="0" value={w.amount||''} placeholder="0" onChange={e=>setForm({...form,waits:{...form.waits,[d.key]:{...w,amount:parseInt(e.target.value)||0}}})} style={{width:34,textAlign:'center'}} />
                            <select value={w.unit} onChange={e=>setForm({...form,waits:{...form.waits,[d.key]:{...w,unit:e.target.value}}})} style={{width:52}}><option value="mins">m</option><option value="hours">h</option><option value="days">d</option></select>
                          </div></td>
                          <td><input type="number" min="0" max={mx} value={form.resources[d.key]||''} placeholder="1" onChange={e=>setForm({...form,resources:{...form.resources,[d.key]:parseInt(e.target.value)||0}})} style={{width:40,textAlign:'center'}} /></td>
                          <td style={{textAlign:'center'}}><input type="checkbox" checked={!!form.done[d.key]} onChange={e=>setForm({...form,done:{...form.done,[d.key]:e.target.checked}})} style={{width:'auto'}} /></td>
                          <td><input type="number" min="0" value={form.actual[d.key]||''} placeholder="–" onChange={e=>setForm({...form,actual:{...form.actual,[d.key]:parseInt(e.target.value)||''}})} style={{width:48,textAlign:'right'}} /></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <div className="tr"><span>Total estimated</span><span style={{color:'#282828'}}>{fmtM(totalMins)}</span></div>
              </div>
              <label className="lbl" style={{marginTop:10}}>Notes</label>
              <textarea value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} />
            </div>
            <div className="mf">
              {editId!==null && <button className="btn-del" onClick={()=>deleteJob(editId)}>Delete</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn-green" onClick={saveJob}>Save Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
