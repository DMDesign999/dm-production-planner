import { useState } from 'react'

const PALETTE = ['#185FA5','#0F6E56','#854F0B','#533AB7','#993556','#3B6D11','#A32D2D','#BA7517','#5F5E5A','#1D7A8C','#7A1D6B','#2C7A1D']
const fmtClock = m => `${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`

// Self-contained Settings modal: Departments (incl. type + working pattern) and Staff (incl. holidays).
export default function SettingsModal(props) {
  const {
    initialDepts, staff, holidays, onClose, onSaveDepts,
    onAddStaff, onUpdateStaff, onDeleteStaff, onToggleHoliday,
  } = props

  const [tab, setTab] = useState('depts')
  const [draft, setDraft] = useState(initialDepts.map(d=>({...d})))
  // staff editing is immediate (writes straight through) since it's its own table

  // ── Departments tab ──
  const move = (i,dir) => { const j=i+dir; if(j<0||j>=draft.length) return; const n=[...draft]; [n[i],n[j]]=[n[j],n[i]]; setDraft(n) }
  const upd = (i,patch) => { const n=[...draft]; n[i]={...n[i],...patch}; setDraft(n) }
  const add = () => setDraft([...draft, { key:'dept_'+Date.now().toString(36), label:'New Department', color:PALETTE[draft.length%PALETTE.length], bg:'#f2f2f2', text:'#333', res:1, enabled:true, deptType:'people', dayStart:480, dayEnd:990, breakMins:30, machineHours:8 }])
  const saveDepts = () => {
    const cleaned = draft.map(d=>({ ...d, bg:d.bg||'#f2f2f2', text:d.text||'#333', res:Math.max(1,parseInt(d.res)||1), label:(d.label||'').trim()||'Department' }))
    onSaveDepts(cleaned)
  }

  // ── Staff tab local form ──
  const [newName, setNewName] = useState('')
  const [newHome, setNewHome] = useState('')
  const [holStaff, setHolStaff] = useState(null) // staff id whose holiday calendar is open
  const [holMonth, setHolMonth] = useState(() => { const d=new Date(); return {y:d.getFullYear(),m:d.getMonth()} })

  const deptLabel = k => (draft.find(d=>d.key===k)||{}).label || k
  const enabledDepts = draft.filter(d=>d.enabled!==false)

  const addStaff = () => {
    if(!newName.trim()) return
    onAddStaff({ name:newName.trim(), homeDept:newHome||enabledDepts[0]?.key||'', alsoDepts:[] })
    setNewName(''); setNewHome('')
  }

  // holiday calendar helpers
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  const monthGrid = () => {
    const {y,m}=holMonth, first=new Date(y,m,1), off=first.getDay(), days=[]
    for(let i=0;i<off;i++) days.push(null)
    for(let i=1;i<=new Date(y,m+1,0).getDate();i++) days.push(fmt(new Date(y,m,i)))
    return days
  }

  return (
    <div className="mwrap" onClick={e=>{ if(e.target===e.currentTarget) onClose() }}>
      <div className="mbox mbox-wide" onClick={e=>e.stopPropagation()}>
        <div className="mh"><h2>Settings</h2><button className="x" onClick={onClose}>×</button></div>

        <div className="settings-tabs">
          <button className={tab==='depts'?'on':''} onClick={()=>setTab('depts')}>Departments &amp; Patterns</button>
          <button className={tab==='staff'?'on':''} onClick={()=>setTab('staff')}>Staff &amp; Holidays</button>
        </div>

        <div className="mb">
          {tab==='depts' && (
            <>
              <p className="settings-help">Reorder the production flow, set each department as people- or machine-based, define working hours/breaks (or machine running hours), and set resources. Order here is the order jobs flow through.</p>
              <div className="dept-settings">
                {draft.map((d,i)=>(
                  <div key={d.key} className={`dept-row2${d.enabled===false?' off':''}`}>
                    <div className="dept-row-top">
                      <div className="dept-move">
                        <button type="button" onClick={()=>move(i,-1)} disabled={i===0}>▲</button>
                        <button type="button" onClick={()=>move(i,1)} disabled={i===draft.length-1}>▼</button>
                      </div>
                      <input type="color" value={d.color} onChange={e=>upd(i,{color:e.target.value})} className="dept-color" title="Colour" />
                      <input type="text" value={d.label} onChange={e=>upd(i,{label:e.target.value})} className="dept-label" placeholder="Department name" />
                      <select value={d.deptType||'people'} onChange={e=>upd(i,{deptType:e.target.value})} className="dept-type">
                        <option value="people">People</option>
                        <option value="machine">Machine</option>
                      </select>
                      <label className="dept-enable">
                        <input type="checkbox" checked={d.enabled!==false} onChange={e=>upd(i,{enabled:e.target.checked})} />
                        {d.enabled!==false?'On':'Off'}
                      </label>
                    </div>
                    <div className="dept-row-pattern">
                      {(d.deptType||'people')==='people' ? (
                        <>
                          <label>Start<input type="time" value={fmtClock(d.dayStart??480)} onChange={e=>{const[h,mn]=e.target.value.split(':').map(Number);upd(i,{dayStart:h*60+mn})}} /></label>
                          <label>End<input type="time" value={fmtClock(d.dayEnd??990)} onChange={e=>{const[h,mn]=e.target.value.split(':').map(Number);upd(i,{dayEnd:h*60+mn})}} /></label>
                          <label>Break (mins)<input type="number" min="0" value={d.breakMins??30} onChange={e=>upd(i,{breakMins:parseInt(e.target.value)||0})} /></label>
                          <span className="pattern-note">Manual resource count is used only until you assign staff in the Staff tab.</span>
                          <label>Resources<input type="number" min="1" value={d.res} onChange={e=>upd(i,{res:parseInt(e.target.value)||1})} /></label>
                        </>
                      ) : (
                        <>
                          <label>Machines<input type="number" min="1" value={d.res} onChange={e=>upd(i,{res:parseInt(e.target.value)||1})} /></label>
                          <label>Running hours/day<input type="number" min="1" max="24" step="0.5" value={d.machineHours??8} onChange={e=>upd(i,{machineHours:parseFloat(e.target.value)||8})} /></label>
                          <span className="pattern-note">Machines can run extended hours (overlapping staff shifts). Holidays don't reduce machine hours.</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" className="add-dept-btn" onClick={add}>+ Add department</button>
              <div className="settings-warn">⚠ Disabling a department hides it everywhere, including on existing jobs that used it — those reschedule as if that step isn't there. The time data isn't deleted, so re-enabling brings it back.</div>
            </>
          )}

          {tab==='staff' && (
            <>
              <p className="settings-help">Add your team, set each person's home department, and tick any others they can also work in. Click a name to mark holidays — those days automatically reduce that department's capacity.</p>

              <div className="staff-add">
                <input type="text" value={newName} placeholder="Name" onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addStaff()}} />
                <select value={newHome} onChange={e=>setNewHome(e.target.value)}>
                  <option value="">Home department…</option>
                  {enabledDepts.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <button type="button" className="btn-green" onClick={addStaff}>Add</button>
              </div>

              <div className="staff-list">
                {staff.length===0 && <div className="empty-note" style={{padding:20}}>No staff yet. Add your team above.</div>}
                {staff.map(s=>(
                  <div key={s.id} className="staff-row">
                    <div className="staff-main">
                      <input type="text" value={s.name} onChange={e=>onUpdateStaff({...s,name:e.target.value})} className="staff-name" />
                      <label className="staff-home">Home
                        <select value={s.homeDept||''} onChange={e=>onUpdateStaff({...s,homeDept:e.target.value})}>
                          <option value="">—</option>
                          {enabledDepts.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                      </label>
                      <button type="button" className="staff-hol-btn" onClick={()=>setHolStaff(holStaff===s.id?null:s.id)}>
                        🗓 Holidays{(holidays[s.id]||[]).length>0?` (${(holidays[s.id]||[]).length})`:''}
                      </button>
                      <button type="button" className="staff-del" onClick={()=>onDeleteStaff(s.id)} title="Remove">×</button>
                    </div>
                    <div className="staff-also">
                      <span className="also-lbl">Can also work in:</span>
                      {enabledDepts.filter(d=>d.key!==s.homeDept).map(d=>(
                        <label key={d.key} className="also-chip">
                          <input type="checkbox" checked={(s.alsoDepts||[]).includes(d.key)} onChange={e=>{
                            const set=new Set(s.alsoDepts||[]); e.target.checked?set.add(d.key):set.delete(d.key)
                            onUpdateStaff({...s, alsoDepts:[...set]})
                          }} />
                          {d.label}
                        </label>
                      ))}
                    </div>
                    {holStaff===s.id && (
                      <div className="hol-cal">
                        <div className="hol-cal-head">
                          <button type="button" onClick={()=>setHolMonth(p=>{let m=p.m-1,y=p.y;if(m<0){m=11;y--}return{y,m}})}>‹</button>
                          <span>{new Date(holMonth.y,holMonth.m,1).toLocaleString('default',{month:'long',year:'numeric'})}</span>
                          <button type="button" onClick={()=>setHolMonth(p=>{let m=p.m+1,y=p.y;if(m>11){m=0;y++}return{y,m}})}>›</button>
                        </div>
                        <div className="hol-grid">
                          {['S','M','T','W','T','F','S'].map((d,idx)=><span key={idx} className="hol-dow">{d}</span>)}
                          {monthGrid().map((date,idx)=> date===null
                            ? <span key={idx} />
                            : <button key={idx} type="button" className={`hol-day${(holidays[s.id]||[]).includes(date)?' off':''}`}
                                onClick={()=>onToggleHoliday(s.id,date,!(holidays[s.id]||[]).includes(date))}>
                                {parseInt(date.split('-')[2],10)}
                              </button>
                          )}
                        </div>
                        <div className="hol-hint">Tap a day to toggle it as a holiday/absence.</div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="mf">
          <button className="btn" onClick={onClose}>Close</button>
          {tab==='depts' && <button className="btn-green" onClick={saveDepts}>Save departments</button>}
        </div>
      </div>
    </div>
  )
}
