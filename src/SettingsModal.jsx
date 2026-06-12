import { useState } from 'react'

const PALETTE = ['#185FA5','#0F6E56','#854F0B','#533AB7','#993556','#3B6D11','#A32D2D','#BA7517','#5F5E5A','#1D7A8C','#7A1D6B','#2C7A1D']
const pad = n => String(n).padStart(2,'0')
const m2t = m => `${pad(Math.floor(m/60))}:${pad(m%60)}`
const t2m = t => { const [h,mn]=t.split(':').map(Number); return h*60+(mn||0) }
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const shiftMins = blocks => (blocks||[]).reduce((s,[a,b])=>s+Math.max(0,b-a),0)

export default function SettingsModal(props) {
  const {
    initialDepts, initialShifts, staff, holidays, onClose,
    onSaveDepts, onSaveShifts, onAddStaff, onUpdateStaff, onDeleteStaff, onToggleHoliday,
  } = props

  const [tab, setTab] = useState('depts')
  const [draft, setDraft] = useState(initialDepts.map(d=>({...d})))
  const [shiftDraft, setShiftDraft] = useState(() => { const s={}; for(let i=0;i<7;i++) s[i]=(initialShifts[i]||[]).map(b=>[...b]); return s })

  const move = (i,dir) => { const j=i+dir; if(j<0||j>=draft.length) return; const n=[...draft]; [n[i],n[j]]=[n[j],n[i]]; setDraft(n) }
  const upd = (i,patch) => { const n=[...draft]; n[i]={...n[i],...patch}; setDraft(n) }
  const add = () => setDraft([...draft, { key:'dept_'+Date.now().toString(36), label:'New Department', color:PALETTE[draft.length%PALETTE.length], bg:'#f2f2f2', text:'#333', res:1, enabled:true, deptType:'people', machineHours:8 }])
  const saveDepts = () => onSaveDepts(draft.map(d=>({ ...d, bg:d.bg||'#f2f2f2', text:d.text||'#333', res:Math.max(1,parseInt(d.res)||1), label:(d.label||'').trim()||'Department' })))

  const addBlock = dow => { const n={...shiftDraft}; const last=(n[dow]||[]).slice(-1)[0]; const start=last?last[1]+30:480; n[dow]=[...(n[dow]||[]),[start,Math.min(start+120,1440)]]; setShiftDraft(n) }
  const updBlock = (dow,bi,which,val) => { const n={...shiftDraft}; const blocks=n[dow].map(b=>[...b]); blocks[bi][which]=t2m(val); n[dow]=blocks; setShiftDraft(n) }
  const delBlock = (dow,bi) => { const n={...shiftDraft}; n[dow]=n[dow].filter((_,i)=>i!==bi); setShiftDraft(n) }
  const saveShifts = () => onSaveShifts(shiftDraft)

  const [newName, setNewName] = useState('')
  const [newHome, setNewHome] = useState('')
  const [holStaff, setHolStaff] = useState(null)
  const [holMonth, setHolMonth] = useState(() => { const d=new Date(); return {y:d.getFullYear(),m:d.getMonth()} })
  const enabledDepts = draft.filter(d=>d.enabled!==false)
  const addStaff = () => { if(!newName.trim()) return; onAddStaff({ name:newName.trim(), homeDept:newHome||enabledDepts[0]?.key||'', alsoDepts:[] }); setNewName(''); setNewHome('') }
  const fmt = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
  const monthGrid = () => { const {y,m}=holMonth, off=new Date(y,m,1).getDay(), days=[]; for(let i=0;i<off;i++) days.push(null); for(let i=1;i<=new Date(y,m+1,0).getDate();i++) days.push(fmt(new Date(y,m,i))); return days }

  return (
    <div className="mwrap" onClick={e=>{ if(e.target===e.currentTarget) onClose() }}>
      <div className="mbox mbox-settings" onClick={e=>e.stopPropagation()}>
        <div className="mh"><h2>Settings</h2><button className="x" onClick={onClose}>×</button></div>

        <div className="settings-tabs">
          <button className={tab==='depts'?'on':''} onClick={()=>setTab('depts')}>Departments</button>
          <button className={tab==='shifts'?'on':''} onClick={()=>setTab('shifts')}>Shift Pattern</button>
          <button className={tab==='staff'?'on':''} onClick={()=>setTab('staff')}>Staff &amp; Holidays</button>
        </div>

        <div className="mb">
          {tab==='depts' && (
            <>
              <p className="settings-help">Reorder the production flow with the arrows, set each department as people- or machine-based, and set resources. Machine departments run a fixed number of hours; people departments use the company shift pattern (Shift Pattern tab). Order here is the order jobs flow through.</p>
              {draft.map((d,i)=>(
                <div key={d.key} className={`drow${d.enabled===false?' off':''}`}>
                  <div className="drow-move">
                    <button type="button" onClick={()=>move(i,-1)} disabled={i===0}>&#9650;</button>
                    <button type="button" onClick={()=>move(i,1)} disabled={i===draft.length-1}>&#9660;</button>
                  </div>
                  <input type="color" value={d.color} onChange={e=>upd(i,{color:e.target.value})} className="drow-color" title="Colour" />
                  <div className="drow-fields">
                    <label className="fld fld-name"><span>Department name</span><input type="text" value={d.label} onChange={e=>upd(i,{label:e.target.value})} placeholder="Department name" /></label>
                    <label className="fld"><span>Type</span>
                      <select value={d.deptType||'people'} onChange={e=>upd(i,{deptType:e.target.value})}>
                        <option value="people">People</option>
                        <option value="machine">Machine</option>
                      </select>
                    </label>
                    {(d.deptType||'people')==='machine' ? (
                      <>
                        <label className="fld fld-num"><span>Machines</span><input type="number" min="1" value={d.res} onChange={e=>upd(i,{res:parseInt(e.target.value)||1})} /></label>
                        <label className="fld fld-num"><span>Hours/day</span><input type="number" min="1" max="24" step="0.5" value={d.machineHours??8} onChange={e=>upd(i,{machineHours:parseFloat(e.target.value)||8})} /></label>
                      </>
                    ) : (
                      <label className="fld fld-num"><span>Resources</span><input type="number" min="1" value={d.res} onChange={e=>upd(i,{res:parseInt(e.target.value)||1})} /></label>
                    )}
                    <label className="fld fld-on"><span>On</span><input type="checkbox" checked={d.enabled!==false} onChange={e=>upd(i,{enabled:e.target.checked})} /></label>
                  </div>
                </div>
              ))}
              <button type="button" className="add-dept-btn" onClick={add}>+ Add department</button>
              <div className="settings-warn">&#9888; Disabling a department hides it everywhere, including on existing jobs that used it &mdash; those reschedule as if that step isn't there. The time data isn't deleted, so re-enabling brings it back.</div>
            </>
          )}

          {tab==='shifts' && (
            <>
              <p className="settings-help">Your standard working week. Each row is a working block; the gaps between blocks are breaks. Working minutes are calculated automatically. Saturday &amp; Sunday are left empty (overtime-only) &mdash; add overtime on the calendar for weekend work.</p>
              {[1,2,3,4,5,6,0].map(dow=>(
                <div key={dow} className={`shift-day${(shiftDraft[dow]||[]).length===0?' empty':''}`}>
                  <div className="shift-day-head">
                    <strong>{DOW[dow]}</strong>
                    <span className="shift-total">{shiftMins(shiftDraft[dow])>0?`${(shiftMins(shiftDraft[dow])/60).toFixed(2).replace(/\.00$/,'').replace(/0$/,'')}h working`:'Overtime only'}</span>
                    <button type="button" className="shift-add" onClick={()=>addBlock(dow)}>+ block</button>
                  </div>
                  {(shiftDraft[dow]||[]).map((b,bi)=>(
                    <div key={bi} className="shift-block">
                      <input type="time" value={m2t(b[0])} onChange={e=>updBlock(dow,bi,0,e.target.value)} />
                      <span>to</span>
                      <input type="time" value={m2t(b[1])} onChange={e=>updBlock(dow,bi,1,e.target.value)} />
                      <span className="shift-block-mins">{Math.max(0,b[1]-b[0])} min</span>
                      <button type="button" className="shift-del" onClick={()=>delBlock(dow,bi)}>&times;</button>
                    </div>
                  ))}
                  {(shiftDraft[dow]||[]).length===0 && <div className="shift-empty-note">No working blocks &mdash; overtime only.</div>}
                </div>
              ))}
            </>
          )}

          {tab==='staff' && (
            <>
              <p className="settings-help">Add your team, set each person's home department, and tick any others they can also work in. Click Holidays to mark days off &mdash; those automatically reduce that department's capacity, and the names show on the calendar.</p>
              <div className="staff-add">
                <input type="text" value={newName} placeholder="Name" onChange={e=>setNewName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')addStaff()}} />
                <select value={newHome} onChange={e=>setNewHome(e.target.value)}>
                  <option value="">Home department&hellip;</option>
                  {enabledDepts.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                <button type="button" className="btn-green" onClick={addStaff}>Add</button>
              </div>
              <div className="staff-list">
                {staff.length===0 && <div style={{padding:20,color:'#999',fontSize:13}}>No staff yet. Add your team above.</div>}
                {staff.map(s=>(
                  <div key={s.id} className="staff-row">
                    <div className="staff-main">
                      <input type="text" value={s.name} onChange={e=>onUpdateStaff({...s,name:e.target.value})} className="staff-name" placeholder="Name" />
                      <label className="fld"><span>Home dept</span>
                        <select value={s.homeDept||''} onChange={e=>onUpdateStaff({...s,homeDept:e.target.value})}>
                          <option value="">&mdash;</option>
                          {enabledDepts.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
                        </select>
                      </label>
                      <button type="button" className="staff-hol-btn" onClick={()=>setHolStaff(holStaff===s.id?null:s.id)}>&#128197; Holidays{(holidays[s.id]||[]).length>0?` (${(holidays[s.id]||[]).length})`:''}</button>
                      <button type="button" className="staff-del" onClick={()=>onDeleteStaff(s.id)} title="Remove">&times;</button>
                    </div>
                    <div className="staff-also">
                      <span className="also-lbl">Can also work in:</span>
                      {enabledDepts.filter(d=>d.key!==s.homeDept).map(d=>(
                        <label key={d.key} className="also-chip">
                          <input type="checkbox" checked={(s.alsoDepts||[]).includes(d.key)} onChange={e=>{ const set=new Set(s.alsoDepts||[]); e.target.checked?set.add(d.key):set.delete(d.key); onUpdateStaff({...s, alsoDepts:[...set]}) }} />
                          {d.label}
                        </label>
                      ))}
                    </div>
                    {holStaff===s.id && (
                      <div className="hol-cal">
                        <div className="hol-cal-head">
                          <button type="button" onClick={()=>setHolMonth(p=>{let m=p.m-1,y=p.y;if(m<0){m=11;y--}return{y,m}})}>&lsaquo;</button>
                          <span>{new Date(holMonth.y,holMonth.m,1).toLocaleString('default',{month:'long',year:'numeric'})}</span>
                          <button type="button" onClick={()=>setHolMonth(p=>{let m=p.m+1,y=p.y;if(m>11){m=0;y++}return{y,m}})}>&rsaquo;</button>
                        </div>
                        <div className="hol-grid">
                          {['S','M','T','W','T','F','S'].map((d,idx)=><span key={idx} className="hol-dow">{d}</span>)}
                          {monthGrid().map((date,idx)=> date===null ? <span key={idx} /> : (
                            <button key={idx} type="button" className={`hol-day${(holidays[s.id]||[]).includes(date)?' off':''}`} onClick={()=>onToggleHoliday(s.id,date,!(holidays[s.id]||[]).includes(date))}>{parseInt(date.split('-')[2],10)}</button>
                          ))}
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
          {tab==='shifts' && <button className="btn-green" onClick={saveShifts}>Save shift pattern</button>}
        </div>
      </div>
    </div>
  )
}
