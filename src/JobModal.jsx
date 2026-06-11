import { useState } from 'react'

// ... (props documented below)
export default function JobModal(props) {
  const { depts, dkeys, priority, today, isEditing, initial, resOf, fmtM, isComplete, onSave, onDelete, onReopen, onClose } = props
  const [form, setForm] = useState(initial)

  const activeSteps = form.steps || []
  const orderedUsed = depts.filter(d => activeSteps.includes(d.key))
  const unusedDepts = depts.filter(d => !activeSteps.includes(d.key))
  const totalMins = dkeys.reduce((s,k)=>s+(Number(form.deptMins[k])||0),0)

  const addStep = key => setForm(f => ({
    ...f,
    steps:[...(f.steps||[]), key],
    deptMins:{...f.deptMins, [key]: f.deptMins[key]||0},
    waits:{...f.waits, [key]: f.waits?.[key] || {amount:0,unit:'mins'}},
    resources:{...f.resources, [key]: f.resources?.[key]||0},
    pins:{...f.pins, [key]: f.pins?.[key]||''},
    done:{...f.done, [key]: f.done?.[key]||false},
    actual:{...f.actual, [key]: f.actual?.[key]||''},
    overlaps:{...f.overlaps, [key]: f.overlaps?.[key] || {mode:'standard',amount:0,unit:'mins'}},
  }))
  const removeStep = key => setForm(f => ({
    ...f,
    steps:(f.steps||[]).filter(k=>k!==key),
    deptMins:{...f.deptMins,[key]:0},
    waits:{...f.waits,[key]:{amount:0,unit:'mins'}},
    resources:{...f.resources,[key]:0},
    pins:{...f.pins,[key]:''},
    done:{...f.done,[key]:false},
    actual:{...f.actual,[key]:''},
    overlaps:{...f.overlaps,[key]:{mode:'standard',amount:0,unit:'mins'}},
  }))

  const upd = patch => setForm(f => ({ ...f, ...patch }))

  return (
    <div className="mwrap" onClick={e=>{ if(e.target===e.currentTarget) onClose() }}>
      <div className="mbox mbox-wide" onClick={e=>e.stopPropagation()}>
        <div className="mh"><h2>{isEditing?'Edit Job':'New Job'}</h2><button className="x" onClick={onClose}>×</button></div>
        <div className="mb">

          {/* ── Job details ── */}
          <div className="form-section">
            <div className="section-head">Job details</div>
            <div className="field-grid">
              <div className="field"><label className="lbl">DM Number</label><input type="text" value={form.title} placeholder="e.g. DM12345" onChange={e=>upd({title:e.target.value})} /></div>
              <div className="field"><label className="lbl">Customer</label><input type="text" value={form.customer} placeholder="e.g. Acme Ltd" onChange={e=>upd({customer:e.target.value})} /></div>
              <div className="field"><label className="lbl">Sub-title <span className="opt">(optional)</span></label><input type="text" value={form.subtitle} placeholder="e.g. Balustrade" onChange={e=>upd({subtitle:e.target.value})} /></div>
              <div className="field"><label className="lbl">Priority</label><select value={form.priority} onChange={e=>upd({priority:e.target.value})}>{Object.entries(priority).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div>
              <div className="field"><label className="lbl">Start date</label><input type="date" value={form.startDate} onChange={e=>upd({startDate:e.target.value})} /></div>
              <div className="field"><label className="lbl">Delivery / Due date</label><input type="date" value={form.dueDate} onChange={e=>upd({dueDate:e.target.value})} /></div>
              <div className="field"><label className="lbl">Material due <span className="tag">LASER</span></label><input type="date" value={form.materialDate} onChange={e=>upd({materialDate:e.target.value})} /></div>
            </div>
          </div>

          {/* ── Production steps ── */}
          <div className="form-section">
            <div className="section-head">
              Production steps
              <span className="section-total">Total: {fmtM(totalMins)}</span>
            </div>

            {orderedUsed.length===0 && <div className="no-steps">No steps yet. Add the departments this job passes through →</div>}

            <div className="step-cards">
              {orderedUsed.map(d=>{
                const w=(form.waits && form.waits[d.key]) || {amount:0,unit:'mins'}
                const mx=resOf(d.key)
                const minsVal = (form.deptMins && form.deptMins[d.key]) || ''
                const resVal = (form.resources && form.resources[d.key]) || ''
                const pinVal = (form.pins && form.pins[d.key]) || ''
                const doneVal = !!(form.done && form.done[d.key])
                const actualVal = (form.actual && form.actual[d.key]) || ''
                const stepIndex = orderedUsed.findIndex(x=>x.key===d.key)
                const prevStep = stepIndex>0 ? orderedUsed[stepIndex-1] : null
                const ov = (form.overlaps && form.overlaps[d.key]) || {mode:'standard',amount:0,unit:'mins'}
                const setOv = patch => setForm(f=>({...f, overlaps:{...(f.overlaps||{}), [d.key]:{...((f.overlaps&&f.overlaps[d.key])||{mode:'standard',amount:0,unit:'mins'}), ...patch}}}))
                const notes = (form.stepNotes && form.stepNotes[d.key]) || []
                const addNote = type => setForm(f=>({...f, stepNotes:{...(f.stepNotes||{}), [d.key]:[...((f.stepNotes&&f.stepNotes[d.key])||[]), {type, text:''}]}}))
                const updNote = (idx,text) => setForm(f=>{ const arr=[...((f.stepNotes&&f.stepNotes[d.key])||[])]; arr[idx]={...arr[idx],text}; return {...f, stepNotes:{...(f.stepNotes||{}), [d.key]:arr}} })
                const delNote = idx => setForm(f=>{ const arr=[...((f.stepNotes&&f.stepNotes[d.key])||[])]; arr.splice(idx,1); return {...f, stepNotes:{...(f.stepNotes||{}), [d.key]:arr}} })
                return (
                  <div key={d.key} className="step-card">
                    <div className="step-card-head">
                      <span className="step-dot" style={{background:d.color}} />
                      <strong>{d.label}</strong>
                      {d.key==='laser' && <span className="tag">material date applies</span>}
                      <span className="step-note-icons">
                        <button type="button" className="step-note-add warn" title="Add a warning" onClick={()=>addNote('warning')}>⚠</button>
                        <button type="button" className="step-note-add note" title="Add a note" onClick={()=>addNote('note')}>🗒</button>
                      </span>
                      <button type="button" className="step-remove" title="Remove this step" onClick={()=>removeStep(d.key)}>Remove</button>
                    </div>

                    {notes.length>0 && (
                      <div className="step-notes-list">
                        {notes.map((n,idx)=>(
                          <div key={idx} className={`step-note-item ${n.type}`}>
                            <span className="step-note-ic">{n.type==='warning'?'⚠':'🗒'}</span>
                            <input type="text" value={n.text} placeholder={n.type==='warning'?'Warning message…':'Note…'} onChange={e=>updNote(idx,e.target.value)} />
                            <button type="button" title="Remove" onClick={()=>delNote(idx)}>×</button>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="step-inputs">
                      <div className="step-field">
                        <label>Time needed (minutes)</label>
                        <input type="number" min="0" value={minsVal} placeholder="0" onChange={e=>setForm(f=>({...f,deptMins:{...f.deptMins,[d.key]:parseInt(e.target.value)||0}}))} />
                      </div>
                      <div className="step-field">
                        <label>People / machines on it</label>
                        <input type="number" min="1" max={mx} value={resVal} placeholder="1" onChange={e=>setForm(f=>({...f,resources:{...f.resources,[d.key]:parseInt(e.target.value)||0}}))} />
                        <span className="step-hint">of {mx} available</span>
                      </div>
                      <div className="step-field">
                        <label>Wait before next step</label>
                        <div style={{display:'flex',gap:4}}>
                          <input type="number" min="0" value={w.amount||''} placeholder="0" onChange={e=>setForm(f=>({...f,waits:{...f.waits,[d.key]:{...((f.waits&&f.waits[d.key])||{unit:'mins'}),amount:parseInt(e.target.value)||0}}}))} />
                          <select value={w.unit||'mins'} onChange={e=>setForm(f=>({...f,waits:{...f.waits,[d.key]:{...((f.waits&&f.waits[d.key])||{amount:0}),unit:e.target.value}}}))}><option value="mins">mins</option><option value="hours">hours</option><option value="days">days</option></select>
                        </div>
                      </div>
                      <div className="step-field">
                        <label>Pin earliest start 📌 <span className="opt">(optional)</span></label>
                        <div style={{display:'flex',gap:4,alignItems:'center'}}>
                          <input type="date" value={pinVal} onChange={e=>setForm(f=>({...f,pins:{...f.pins,[d.key]:e.target.value}}))} />
                          {pinVal && <button type="button" title="Clear pin" className="pin-clear" onClick={()=>setForm(f=>({...f,pins:{...f.pins,[d.key]:''}}))}>×</button>}
                        </div>
                      </div>
                    </div>

                    {prevStep && (
                      <div className="overlap-row">
                        <span className="overlap-lbl">Start this step:</span>
                        <select value={ov.mode||'standard'} onChange={e=>setOv({mode:e.target.value})}>
                          <option value="standard">After {prevStep.label} finishes (standard)</option>
                          <option value="time">Once {prevStep.label} has run for…</option>
                          <option value="pct">Once {prevStep.label} is % done…</option>
                        </select>
                        {ov.mode==='time' && (
                          <span className="overlap-inputs">
                            <input type="number" min="0" value={ov.amount||''} placeholder="0" onChange={e=>setOv({amount:parseInt(e.target.value)||0})} />
                            <select value={ov.unit||'mins'} onChange={e=>setOv({unit:e.target.value})}><option value="mins">mins</option><option value="hours">hours</option></select>
                          </span>
                        )}
                        {ov.mode==='pct' && (
                          <span className="overlap-inputs">
                            <input type="number" min="0" max="100" value={ov.amount||''} placeholder="0" onChange={e=>setOv({amount:parseInt(e.target.value)||0})} />
                            <span style={{fontSize:11,color:'#666'}}>% done</span>
                          </span>
                        )}
                      </div>
                    )}
                    {isEditing && (
                      <div className="step-progress">
                        <span className="progress-lbl">Shop-floor progress:</span>
                        <label className="done-toggle">
                          <input type="checkbox" checked={doneVal} onChange={e=>setForm(f=>({...f,done:{...f.done,[d.key]:e.target.checked}}))} />
                          Done
                        </label>
                        <span className="step-field-inline">
                          <label>Actual mins taken</label>
                          <input type="number" min="0" value={actualVal} placeholder="–" onChange={e=>setForm(f=>({...f,actual:{...f.actual,[d.key]:parseInt(e.target.value)||''}}))} />
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {unusedDepts.length>0 && (
              <div className="add-step-row">
                <select value="" onChange={e=>{ if(e.target.value) addStep(e.target.value) }}>
                  <option value="">+ Add a department step…</option>
                  {unusedDepts.map(d=><option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
              </div>
            )}
          </div>

          {/* ── Notes ── */}
          <div className="form-section">
            <div className="section-head">Notes</div>
            <textarea value={form.notes} placeholder="Any extra detail…" onChange={e=>upd({notes:e.target.value})} />
          </div>

        </div>
        <div className="mf">
          {isEditing && <button className="btn-del" onClick={onDelete}>Delete</button>}
          {isEditing && isComplete && <button className="btn" style={{borderColor:'#BA7517',color:'#BA7517'}} onClick={onReopen}>Reopen job</button>}
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn-green" onClick={()=>onSave(form)}>Save Job</button>
        </div>
      </div>
    </div>
  )
}
