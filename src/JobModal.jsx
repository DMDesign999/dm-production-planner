import { useState } from 'react'

// Self-contained job add/edit modal.
// Holds its own form state so typing never re-renders the parent App
// (which is what was tearing the modal down mid-entry).
//
// Props:
//   depts       - array of department defs
//   dkeys       - array of department keys in process order
//   priority    - PRIORITY map
//   today       - today's date string
//   isEditing   - bool
//   initial     - initial form object (already shaped by the parent)
//   resOf       - (deptKey) => resource count
//   fmtM        - minutes formatter
//   isComplete  - whether the (existing) job is complete
//   onSave      - (formData) => void
//   onDelete    - () => void
//   onReopen    - () => void
//   onClose     - () => void
export default function JobModal({ depts, dkeys, priority, today, isEditing, initial, resOf, fmtM, isComplete, onSave, onDelete, onReopen, onClose }) {
  const [form, setForm] = useState(initial)

  const activeSteps = form.steps || []
  const orderedUsed = depts.filter(d => activeSteps.includes(d.key))
  const unusedDepts = depts.filter(d => !activeSteps.includes(d.key))
  const totalMins = dkeys.reduce((s,k)=>s+(Number(form.deptMins[k])||0),0)

  const addStep = key => setForm(f => ({ ...f, steps:[...(f.steps||[]), key], deptMins:{...f.deptMins, [key]: f.deptMins[key]||0} }))
  const removeStep = key => setForm(f => ({
    ...f,
    steps:(f.steps||[]).filter(k=>k!==key),
    deptMins:{...f.deptMins,[key]:0},
    waits:{...f.waits,[key]:{amount:0,unit:'mins'}},
    resources:{...f.resources,[key]:0},
    pins:{...f.pins,[key]:''},
    done:{...f.done,[key]:false},
    actual:{...f.actual,[key]:''},
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
                const w=form.waits[d.key]||{amount:0,unit:'mins'}, mx=resOf(d.key)
                return (
                  <div key={d.key} className="step-card">
                    <div className="step-card-head">
                      <span className="step-dot" style={{background:d.color}} />
                      <strong>{d.label}</strong>
                      {d.key==='laser' && <span className="tag">material date applies</span>}
                      <button type="button" className="step-remove" title="Remove this step" onClick={()=>removeStep(d.key)}>Remove</button>
                    </div>
                    <div className="step-inputs">
                      <div className="step-field">
                        <label>Time needed (minutes)</label>
                        <input type="number" min="0" value={form.deptMins[d.key]||''} placeholder="0" onChange={e=>setForm(f=>({...f,deptMins:{...f.deptMins,[d.key]:parseInt(e.target.value)||0}}))} />
                      </div>
                      <div className="step-field">
                        <label>People / machines on it</label>
                        <input type="number" min="1" max={mx} value={form.resources[d.key]||''} placeholder="1" onChange={e=>setForm(f=>({...f,resources:{...f.resources,[d.key]:parseInt(e.target.value)||0}}))} />
                        <span className="step-hint">of {mx} available</span>
                      </div>
                      <div className="step-field">
                        <label>Wait before next step</label>
                        <div style={{display:'flex',gap:4}}>
                          <input type="number" min="0" value={w.amount||''} placeholder="0" onChange={e=>setForm(f=>({...f,waits:{...f.waits,[d.key]:{...(f.waits[d.key]||{unit:'mins'}),amount:parseInt(e.target.value)||0}}}))} />
                          <select value={w.unit} onChange={e=>setForm(f=>({...f,waits:{...f.waits,[d.key]:{...(f.waits[d.key]||{amount:0}),unit:e.target.value}}}))}><option value="mins">mins</option><option value="hours">hours</option><option value="days">days</option></select>
                        </div>
                      </div>
                      <div className="step-field">
                        <label>Pin earliest start 📌 <span className="opt">(optional)</span></label>
                        <div style={{display:'flex',gap:4,alignItems:'center'}}>
                          <input type="date" value={form.pins[d.key]||''} onChange={e=>setForm(f=>({...f,pins:{...f.pins,[d.key]:e.target.value}}))} />
                          {form.pins[d.key] && <button type="button" title="Clear pin" className="pin-clear" onClick={()=>setForm(f=>({...f,pins:{...f.pins,[d.key]:''}}))}>×</button>}
                        </div>
                      </div>
                    </div>

                    {isEditing && (
                      <div className="step-progress">
                        <span className="progress-lbl">Shop-floor progress:</span>
                        <label className="done-toggle">
                          <input type="checkbox" checked={!!form.done[d.key]} onChange={e=>setForm(f=>({...f,done:{...f.done,[d.key]:e.target.checked}}))} />
                          Done
                        </label>
                        <span className="step-field-inline">
                          <label>Actual mins taken</label>
                          <input type="number" min="0" value={form.actual[d.key]||''} placeholder="–" onChange={e=>setForm(f=>({...f,actual:{...f.actual,[d.key]:parseInt(e.target.value)||''}}))} />
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
