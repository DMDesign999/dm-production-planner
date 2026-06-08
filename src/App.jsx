import { useState, useEffect, useMemo } from 'react'
import { supabase } from './supabaseClient'
import { loadAll, insertJob, updateJob, deleteJobDb, setCapacityDb, clearCapacityDb, setDeptResDb, seedIfEmpty, setDaySequenceDb } from './data'

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
    priority:'normal', dueDate:'', customer:'', subtitle:'', reopened:false,
    ...job,
    deptMins:remap(job.deptMins),
    waits:remap(job.waits),
    resources:remap(job.resources),
    done:remap(job.done||{}),
    actual:remap(job.actual||{}),
    pins:remap(job.pins||{}),
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
  const [page, setPage] = useState('planner') // 'planner' | 'late' | 'completed'
  const [search, setSearch] = useState('')
  const [daySeq, setDaySeq] = useState({}) // "dept|day" -> [jobId,...]
  const [anchor, setAnchor] = useState(() => todayStr())
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { y:d.getFullYear(), m:d.getMonth() } })
  const [tab, setTab] = useState('all')
  const [modal, setModal] = useState(null)
  const [editId, setEditId] = useState(null)
  const [capEdit, setCapEdit] = useState(null)
  const [capVal, setCapVal] = useState('')
  const [form, setForm] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [dragJob, setDragJob] = useState(null) // {jobId, dept}

  async function refresh() {
    try {
      const { jobs:j, capacity:c, deptRes:r, daySeq:s } = await loadAll()
      setJobsRaw(j.map(migrateJob))
      setCapacity(c)
      if (Object.keys(r).length) setDeptRes(r)
      setDaySeq(s || {})
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
      try { await seedIfEmpty(Object.fromEntries(DEPTS.map(d=>[d.key,d.res]))) } catch {}
      if (active) await refresh()
    })()
    const channel = supabase
      .channel('planner-changes')
      .on('postgres_changes', { event:'*', schema:'public', table:'jobs' }, () => refresh())
      .on('postgres_changes', { event:'*', schema:'public', table:'capacity' }, () => refresh())
      .on('postgres_changes', { event:'*', schema:'public', table:'dept_resources' }, () => refresh())
      .on('postgres_changes', { event:'*', schema:'public', table:'day_sequence' }, () => refresh())
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

  // ── Scheduling engine (manual day-seq → priority → due → start; forward; locked done steps) ──
  const { entries, jobFinish } = useMemo(() => {
    // Build a manual-priority boost map: any job appearing in a day_sequence list
    // gets ordered by its position there (earlier = scheduled first). We collapse
    // all sequence lists into a single ranking hint keyed by jobId.
    const manualRank = {}
    Object.values(daySeq || {}).forEach(list => {
      (list || []).forEach((jid, idx) => {
        // smaller = earlier; keep the strongest (smallest) hint seen
        if (manualRank[jid] === undefined || idx < manualRank[jid]) manualRank[jid] = idx
      })
    })
    const hasManual = Object.keys(manualRank).length > 0

    const ordered = [...jobs].sort((a,b)=>{
      // Manual sequence wins when both jobs are manually ordered
      if(hasManual){
        const ma=manualRank[a.id], mb=manualRank[b.id]
        if(ma!==undefined && mb!==undefined && ma!==mb) return ma-mb
        if(ma!==undefined && mb===undefined) return -1
        if(ma===undefined && mb!==undefined) return 1
      }
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
        const pin = (job.pins||{})[dk]
        if(pin && pin>cur.date){
          cur = { date:pin, min:WD }
          while(isWknd(cur.date)) cur = { date:addDays(cur.date,1), min:WD }
        }
        const jr = (job.resources||{})[dk]||0
        const actualRes = jr>0 ? Math.min(jr, resOf(dk)) : 1
        let remMM = ((job.actual||{})[dk] && isDone) ? job.actual[dk] : job.deptMins[dk]
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
  }, [jobs, capacity, deptRes, daySeq])

  // step ready = all prior steps done
  const stepReady = (job, dept) => {
    const phases = DKEYS.filter(k => (job.deptMins[k]||0)>0)
    const idx = phases.indexOf(dept)
    if(idx<=0) return true
    for(let i=0;i<idx;i++){ if(!(job.done||{})[phases[i]]) return false }
    return true
  }

  // whole-job completion + lateness helpers
  const jobPhases = job => DKEYS.filter(k => (job.deptMins[k]||0)>0)
  const isComplete = job => { const p=jobPhases(job); return p.length>0 && p.every(k=>(job.done||{})[k]) }
  const lateness = job => {
    if(!job.dueDate) return { state:'none' }
    const fin = jobFinish[job.id]
    if(!fin) return { state:'none' }
    if(fin > job.dueDate){
      const days = Math.round((parseD(fin)-parseD(job.dueDate))/(1000*60*60*24))
      return { state:'late', days, finish:fin }
    }
    // at risk = finishes within 1 day of due
    const daysToSpare = Math.round((parseD(job.dueDate)-parseD(fin))/(1000*60*60*24))
    if(daysToSpare <= 1) return { state:'risk', days:daysToSpare, finish:fin }
    return { state:'ok', finish:fin }
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
    const complete = isComplete(job)
    // Distinct states:
    //  complete (whole job)   → green hatch, "✓" tag, faded but clearly "finished"
    //  step done              → green tint, ✓, strikethrough
    //  waiting on prev step   → grey, dashed border
    //  ready/in-progress      → normal dept colour
    let bg=dp.bg, txt=dp.text, bl=dp.color, dash=false, hatch=false
    if(complete){ bg='#dff0e3'; txt='#2c6e3c'; bl='#2ecc71'; hatch=true }
    else if(done){ bg='#EAF7EE'; txt='#1a5c2e'; bl='#2ecc71' }
    else if(!ready){ bg='#f4f4f4'; txt='#999'; bl='#ccc'; dash=true }
    const prio = PRIORITY[job.priority||'normal']
    const pinned = !!(job.pins||{})[e.dept]
    const label = [job.title, job.customer, job.subtitle].filter(Boolean)
    return (
      <div key={i} className={`pill${hatch?' pill-complete':''}`} draggable={!done&&!complete}
           style={{background:bg,color:txt,borderLeft:`${dash?'2px dashed':'2px solid'} ${bl}`}}
           title={`${label.join(' · ')} | ${fmtT(e.s)}–${fmtT(e.e)} | ${fmtM(e.mins)} | ×${e.resources}${pinned?` | 📌 ${(job.pins||{})[e.dept]}`:''}${complete?' | ✓ COMPLETE':done?' | step done':ready?'':' | waiting on previous step'}`}
           onClick={ev=>{ev.stopPropagation();openEdit(job.id)}}
           onDragStart={()=>!done&&!complete&&setDragJob({jobId:job.id,dept:e.dept})}
           onDragEnd={()=>setDragJob(null)}>
        {!complete && (
          <span className="tick" onClick={ev=>{ev.stopPropagation();toggleDone(job.id,e.dept)}}
                title={ready?'Mark this step done':'Complete the previous step first'}
                style={{color: done?'#2ecc71':ready?'#999':'#ccc', cursor: ready||done?'pointer':'not-allowed'}}>
            {done?'✓':'○'}
          </span>
        )}
        {complete && <span style={{fontSize:8,flexShrink:0,fontWeight:700,color:'#2c6e3c'}}>✓</span>}
        {pinned && <span style={{fontSize:8,flexShrink:0}} title="Pinned start">📌</span>}
        {job.priority==='high' && !complete && <span className="prio-dot" style={{background:prio.color}} title="High priority" />}
        <span style={{overflow:'hidden',textOverflow:'ellipsis',flex:1,fontWeight:600,textDecoration:(done||complete)?'line-through':'none',opacity:complete?0.7:1}}>
          <span style={{fontWeight:700}}>{job.title}</span>
          {job.customer && <span style={{opacity:.85}}> · {job.customer}</span>}
          {job.subtitle && <span style={{opacity:.6}}> · {job.subtitle}</span>}
        </span>
        {e.resources>1 && <span style={{background:bl,color:'#fff',borderRadius:2,padding:'0 3px',fontSize:8,fontWeight:700,flexShrink:0}}>×{e.resources}</span>}
        {withTime && <span style={{opacity:.6,fontSize:8,flexShrink:0}}>{fmtT(e.s)}</span>}
      </div>
    )
  }

  // Drop a dragged step onto a date → pin THAT step's earliest-start there.
  // Allowed to move earlier or later, as long as it's not before the previous step can finish.
  const onDropDate = (date) => {
    if(!dragJob) return
    const job = jobs.find(j=>j.id===dragJob.jobId); if(!job){ setDragJob(null); return }
    const phases = DKEYS.filter(k => (job.deptMins[k]||0)>0)
    const idx = phases.indexOf(dragJob.dept)
    // Earliest this step may start = the day the previous step finishes (or job start for first step)
    let earliest = job.startDate
    if(idx>0){
      const prevDept = phases[idx-1]
      const prevEnts = entries.filter(e=>e.jobId===job.id && e.dept===prevDept)
      if(prevEnts.length){ earliest = prevEnts.map(e=>e.date).sort().slice(-1)[0] }
    }
    if(date < earliest){
      // can't go before the previous step finishes — clamp to earliest
      date = earliest
    }
    const pins = {...(job.pins||{})}
    pins[dragJob.dept] = date
    const updated = {...job, pins}
    setJobs(jobs.map(j=>j.id===job.id?updated:j))
    updateJob(updated).catch(e=>setLoadErr(e.message))
    setDirty(true)
    setDragJob(null)
  }

  const toggleDone = (jobId, dept) => {
    const job = jobs.find(j=>j.id===jobId); if(!job) return
    const isDoneNow = !!(job.done||{})[dept]
    // Strict order: can't mark done unless all prior steps are done. (Un-ticking is always allowed.)
    if(!isDoneNow && !stepReady(job, dept)){
      setLoadErr('Complete the previous step first.')
      setTimeout(()=>setLoadErr(null), 2500)
      return
    }
    const done={...(job.done||{})}; done[dept]=!done[dept]
    const updated = {...job, done}
    setJobs(jobs.map(j=>j.id===jobId?updated:j))
    updateJob(updated).catch(e=>setLoadErr(e.message))
    setDirty(true)
  }

  const reopenJob = (jobId) => {
    const job = jobs.find(j=>j.id===jobId); if(!job) return
    // Reopen = un-tick the last completed step so it's no longer "complete"
    const phases = jobPhases(job)
    const done = {...(job.done||{})}
    for(let i=phases.length-1;i>=0;i--){ if(done[phases[i]]){ done[phases[i]]=false; break } }
    const updated = {...job, done, reopened:true}
    setJobs(jobs.map(j=>j.id===jobId?updated:j))
    updateJob(updated).catch(e=>setLoadErr(e.message))
    setDirty(true)
  }

  // Intra-day reorder: drop dragged job before target job within same dept+day.
  const reorderWithinDay = (dept, day, draggedJobId, targetJobId) => {
    if(draggedJobId===targetJobId) return
    const dayJobs = entries.filter(e=>e.dept===dept&&e.date===day).sort((a,b)=>a.s-b.s).map(e=>e.jobId)
    const uniq = [...new Set(dayJobs)]
    const existing = daySeq[`${dept}|${day}`] || uniq
    let order = [...new Set([...(existing||[]), ...uniq])].filter(id=>id!==draggedJobId)
    const ti = order.indexOf(targetJobId)
    if(ti<0) order.push(draggedJobId); else order.splice(ti,0,draggedJobId)
    const key = `${dept}|${day}`
    setDaySeq({...daySeq, [key]:order})
    setDaySequenceDb(dept, day, order).catch(e=>setLoadErr(e.message))
    setDirty(true)
  }

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

  const emptyForm = () => ({ title:'', customer:'', subtitle:'', startDate:TODAY, dueDate:'', materialDate:'', status:'scheduled', priority:'normal', notes:'',
    deptMins:Object.fromEntries(DKEYS.map(k=>[k,0])),
    waits:Object.fromEntries(DKEYS.map(k=>[k,{amount:0,unit:'mins'}])),
    resources:Object.fromEntries(DKEYS.map(k=>[k,0])),
    done:Object.fromEntries(DKEYS.map(k=>[k,false])),
    actual:Object.fromEntries(DKEYS.map(k=>[k,''])),
    pins:Object.fromEntries(DKEYS.map(k=>[k,''])) })

  function openAdd(date){ setForm({...emptyForm(), startDate:date||TODAY}); setEditId(null); setModal('job') }
  function openEdit(id){
    const job = jobs.find(j=>j.id===id); if(!job) return
    setForm({ title:job.title, customer:job.customer||'', subtitle:job.subtitle||'', startDate:job.startDate, dueDate:job.dueDate||'', materialDate:job.materialDate||'', status:job.status, priority:job.priority||'normal', notes:job.notes||'',
      deptMins:{...Object.fromEntries(DKEYS.map(k=>[k,0])),...job.deptMins},
      waits:{...Object.fromEntries(DKEYS.map(k=>[k,{amount:0,unit:'mins'}])),...(job.waits||{})},
      resources:{...Object.fromEntries(DKEYS.map(k=>[k,0])),...(job.resources||{})},
      done:{...Object.fromEntries(DKEYS.map(k=>[k,false])),...(job.done||{})},
      actual:{...Object.fromEntries(DKEYS.map(k=>[k,''])),...(job.actual||{})},
      pins:{...Object.fromEntries(DKEYS.map(k=>[k,''])),...(job.pins||{})} })
    setEditId(id); setModal('job')
  }
  async function saveJob(){
    if(!form.title.trim()) return
    const cleanPins = {}; for(const k of DKEYS){ if(form.pins[k]) cleanPins[k]=form.pins[k] }
    const data = { title:form.title.trim(), customer:(form.customer||'').trim(), subtitle:(form.subtitle||'').trim(), startDate:form.startDate, dueDate:form.dueDate, materialDate:form.materialDate, status:form.status, priority:form.priority, notes:form.notes, deptMins:form.deptMins, waits:form.waits, resources:form.resources, done:form.done, actual:form.actual, pins:cleanPins }
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

  // ── Derived lists for pages ──
  const completedJobs = jobs.filter(isComplete)
  const lateJobs = jobs
    .filter(j => !isComplete(j))
    .map(j => ({ job:j, late:lateness(j) }))
    .filter(x => x.late.state==='late' || x.late.state==='risk')
    .sort((a,b)=>{
      if(a.late.state!==b.late.state) return a.late.state==='late'?-1:1
      return (b.late.days||0)-(a.late.days||0)
    })
  const searchMatches = search.trim()
    ? jobs.filter(j => {
        const q = search.trim().toLowerCase()
        return (j.title||'').toLowerCase().includes(q) || (j.customer||'').toLowerCase().includes(q)
      })
    : []

  // current step a job is sitting at (first not-done phase)
  const currentStep = job => { const p=jobPhases(job); for(const k of p){ if(!(job.done||{})[k]) return k } return null }

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
        {/* Page navigation */}
        <div className="page-nav">
          <button className={`page-tab ${page==='planner'?'on':''}`} onClick={()=>setPage('planner')}>Planner</button>
          <button className={`page-tab ${page==='late'?'on':''}`} onClick={()=>setPage('late')}>
            Late Jobs {lateJobs.length>0 && <span className="page-badge" style={{background:'#e74c3c'}}>{lateJobs.length}</span>}
          </button>
          <button className={`page-tab ${page==='completed'?'on':''}`} onClick={()=>setPage('completed')}>
            Completed {completedJobs.length>0 && <span className="page-badge" style={{background:'#2ecc71'}}>{completedJobs.length}</span>}
          </button>
          <div style={{flex:1}} />
          <div className="search-box">
            <input type="text" value={search} placeholder="Search DM number or customer…" onChange={e=>setSearch(e.target.value)} />
            {search && <button className="search-clear" onClick={()=>setSearch('')}>×</button>}
            {search && searchMatches.length>0 && (
              <div className="search-drop">
                {searchMatches.slice(0,8).map(j=>(
                  <div key={j.id} className="search-item" onClick={()=>{openEdit(j.id);setSearch('')}}>
                    <strong>{j.title}</strong>{j.customer&&<span style={{color:'#666'}}> · {j.customer}</span>}{j.subtitle&&<span style={{color:'#aaa'}}> · {j.subtitle}</span>}
                  </div>
                ))}
              </div>
            )}
            {search && searchMatches.length===0 && <div className="search-drop"><div className="search-item" style={{color:'#aaa'}}>No matches</div></div>}
          </div>
        </div>

        {page==='planner' && (<>
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
                                   title={`${[job.title,job.customer,job.subtitle].filter(Boolean).join(' · ')} | ${fmtT(e.s)}–${fmtT(e.e)} | ${fmtM(e.mins)} | ×${e.resources}\n(drag onto another job in this column to reorder)`}
                                   onClick={ev=>{ev.stopPropagation();openEdit(job.id)}}
                                   onDragStart={ev=>{if(!done){ev.stopPropagation();setDragJob({jobId:job.id,dept:e.dept,mode:'reorder'})}}}
                                   onDragEnd={()=>setDragJob(null)}
                                   onDragOver={ev=>{ if(dragJob&&dragJob.mode==='reorder'&&dragJob.dept===dp.key&&dragJob.jobId!==job.id){ev.preventDefault();ev.currentTarget.classList.add('reorder-target')} }}
                                   onDragLeave={ev=>ev.currentTarget.classList.remove('reorder-target')}
                                   onDrop={ev=>{ ev.currentTarget.classList.remove('reorder-target'); if(dragJob&&dragJob.mode==='reorder'&&dragJob.dept===dp.key&&dragJob.jobId!==job.id){ev.stopPropagation();reorderWithinDay(dp.key,date,dragJob.jobId,job.id);setDragJob(null)} }}>
                                <div style={{display:'flex',alignItems:'center',gap:3}}>
                                  <span className="tick" style={{position:'static',cursor:ready||done?'pointer':'not-allowed'}} onClick={ev=>{ev.stopPropagation();toggleDone(job.id,e.dept)}}>{done?'✓':'○'}</span>
                                  <strong style={{fontSize:10,overflow:'hidden',textOverflow:'ellipsis'}}>{job.title}</strong>
                                  {job.customer && <span style={{fontSize:9,opacity:.8,overflow:'hidden',textOverflow:'ellipsis'}}>· {job.customer}</span>}
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
        </>)}

        {/* ───── LATE JOBS PAGE ───── */}
        {page==='late' && (
          <div className="page-body">
            {(() => {
              const list = search.trim() ? lateJobs.filter(x=>searchMatches.some(m=>m.id===x.job.id)) : lateJobs
              if(list.length===0) return <div className="empty-note">🎉 No late or at-risk jobs. Everything's on track.</div>
              return (
                <table className="list-tbl">
                  <thead><tr><th>Status</th><th>DM Number</th><th>Customer</th><th>Sub-title</th><th>Priority</th><th>Due</th><th>Projected finish</th><th>Currently at</th></tr></thead>
                  <tbody>
                    {list.map(({job,late})=>{
                      const cs = currentStep(job)
                      const csDept = cs ? deptOf(cs) : null
                      return (
                        <tr key={job.id} onClick={()=>openEdit(job.id)} style={{cursor:'pointer'}}>
                          <td><span className="state-pill" style={{background:late.state==='late'?'#FCEBEB':'#FFF3DC',color:late.state==='late'?'#7a1e1e':'#633806'}}>{late.state==='late'?`⚠ ${late.days}d late`:'At risk'}</span></td>
                          <td><strong>{job.title}</strong></td>
                          <td>{job.customer||'—'}</td>
                          <td style={{color:'#888'}}>{job.subtitle||'—'}</td>
                          <td><span style={{color:PRIORITY[job.priority||'normal'].color,fontWeight:600,fontSize:11}}>{PRIORITY[job.priority||'normal'].label}</span></td>
                          <td>{job.dueDate?parseD(job.dueDate).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'}</td>
                          <td>{late.finish?parseD(late.finish).toLocaleDateString('en-GB',{day:'numeric',month:'short'}):'—'}</td>
                          <td>{csDept?<span style={{color:csDept.color,fontWeight:600,fontSize:11}}>{csDept.label}</span>:'—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
        )}

        {/* ───── COMPLETED PAGE ───── */}
        {page==='completed' && (
          <div className="page-body">
            {(() => {
              const list = search.trim() ? completedJobs.filter(j=>searchMatches.some(m=>m.id===j.id)) : completedJobs
              if(list.length===0) return <div className="empty-note">No completed jobs yet. Tick every step of a job to complete it.</div>
              return (
                <table className="list-tbl">
                  <thead><tr><th>DM Number</th><th>Customer</th><th>Sub-title</th><th>Est. total</th><th>Actual total</th><th>Variance</th><th></th></tr></thead>
                  <tbody>
                    {list.map(job=>{
                      const phases = jobPhases(job)
                      const est = phases.reduce((s,k)=>s+(Number(job.deptMins[k])||0),0)
                      const act = phases.reduce((s,k)=>s+(Number((job.actual||{})[k])|| Number(job.deptMins[k])||0),0)
                      const variance = act-est
                      const hasActuals = phases.some(k=>(job.actual||{})[k])
                      return (
                        <tr key={job.id} onClick={()=>openEdit(job.id)} style={{cursor:'pointer'}}>
                          <td><strong>{job.title}</strong></td>
                          <td>{job.customer||'—'}</td>
                          <td style={{color:'#888'}}>{job.subtitle||'—'}</td>
                          <td>{fmtM(est)}</td>
                          <td>{hasActuals?fmtM(act):<span style={{color:'#aaa'}}>not logged</span>}</td>
                          <td>{hasActuals?<span style={{color:variance>0?'#c0392b':'#1a5c2e',fontWeight:600}}>{variance>0?'+':''}{fmtM(Math.abs(variance))} {variance>0?'over':variance<0?'under':'on est.'}</span>:'—'}</td>
                          <td><button className="btn" style={{padding:'3px 10px',fontSize:11,borderColor:'#BA7517',color:'#BA7517'}} onClick={ev=>{ev.stopPropagation();reopenJob(job.id)}}>Reopen</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )
            })()}
          </div>
        )}
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
                <div><label className="lbl">DM Number</label><input type="text" value={form.title} placeholder="e.g. DM12345" onChange={e=>setForm({...form,title:e.target.value})} /></div>
                <div><label className="lbl">Priority</label><select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>{Object.entries(PRIORITY).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
              </div>
              <div className="fr2" style={{marginTop:8}}>
                <div><label className="lbl">Customer</label><input type="text" value={form.customer} placeholder="e.g. Acme Ltd" onChange={e=>setForm({...form,customer:e.target.value})} /></div>
                <div><label className="lbl">Sub-title <span style={{textTransform:'none',fontWeight:400,color:'#aaa'}}>(optional)</span></label><input type="text" value={form.subtitle} placeholder="e.g. Balustrade" onChange={e=>setForm({...form,subtitle:e.target.value})} /></div>
              </div>
              <div className="fr3" style={{marginTop:8}}>
                <div><label className="lbl">Start date</label><input type="date" value={form.startDate} onChange={e=>setForm({...form,startDate:e.target.value})} /></div>
                <div><label className="lbl">Delivery / Due</label><input type="date" value={form.dueDate} onChange={e=>setForm({...form,dueDate:e.target.value})} /></div>
                <div><label className="lbl">Material due <span className="tag">LASER</span></label><input type="date" value={form.materialDate} onChange={e=>setForm({...form,materialDate:e.target.value})} /></div>
              </div>
              <div className="stitle">Departments — time, wait, resources &amp; completion</div>
              <div className="sbox">
                <table className="dtbl" style={{minWidth:600}}>
                  <thead><tr><th>Dept</th><th style={{width:54}}>Est. min</th><th style={{width:96}}>Wait after</th><th style={{width:48}}>Res</th><th style={{width:40}}>Done</th><th style={{width:54}}>Actual</th><th style={{width:130}}>Pin start 📌</th></tr></thead>
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
                          <td><div style={{display:'flex',gap:2,alignItems:'center'}}>
                            <input type="date" value={form.pins[d.key]||''} onChange={e=>setForm({...form,pins:{...form.pins,[d.key]:e.target.value}})} style={{width:108,fontSize:10}} />
                            {form.pins[d.key] && <button type="button" title="Clear pin" onClick={()=>setForm({...form,pins:{...form.pins,[d.key]:''}})} style={{border:'none',background:'none',color:'#c0392b',cursor:'pointer',fontWeight:700,fontSize:13,padding:0}}>×</button>}
                          </div></td>
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
              {editId!==null && isComplete(jobs.find(j=>j.id===editId)||{deptMins:{}}) && <button className="btn" style={{borderColor:'#BA7517',color:'#BA7517'}} onClick={()=>{reopenJob(editId);setModal(null)}}>Reopen job</button>}
              <button className="btn" onClick={()=>setModal(null)}>Cancel</button>
              <button className="btn-green" onClick={saveJob}>Save Job</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
