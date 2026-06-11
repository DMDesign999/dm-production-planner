import { supabase } from './supabaseClient'

// ─── Convert DB row (snake_case) → app job (camelCase) ───
export function rowToJob(r) {
  return {
    id: r.id,
    title: r.title || '',
    customer: r.customer || '',
    subtitle: r.subtitle || '',
    status: r.status || 'scheduled',
    priority: r.priority || 'normal',
    startDate: r.start_date || '',
    dueDate: r.due_date || '',
    materialDate: r.material_date || '',
    notes: r.notes || '',
    deptMins: r.dept_mins || {},
    waits: r.waits || {},
    resources: r.resources || {},
    done: r.done || {},
    actual: r.actual || {},
    pins: r.pins || {},
    overlaps: r.overlaps || {},
    stepNotes: r.step_notes || {},
    reopened: r.reopened || false,
  }
}

// ─── Convert app job (camelCase) → DB row (snake_case) ───
export function jobToRow(j) {
  const row = {
    title: j.title || '',
    customer: j.customer || '',
    subtitle: j.subtitle || '',
    status: j.status || 'scheduled',
    priority: j.priority || 'normal',
    start_date: j.startDate || null,
    due_date: j.dueDate || null,
    material_date: j.materialDate || null,
    notes: j.notes || '',
    dept_mins: j.deptMins || {},
    waits: j.waits || {},
    resources: j.resources || {},
    done: j.done || {},
    actual: j.actual || {},
    pins: j.pins || {},
    overlaps: j.overlaps || {},
    step_notes: j.stepNotes || {},
    reopened: !!j.reopened,
    updated_at: new Date().toISOString(),
  }
  // Only include id if it's a real DB id (number from DB). New jobs omit it.
  if (typeof j.id === 'number') row.id = j.id
  return row
}

// ─── Load everything ───
export async function loadAll() {
  const [jobsRes, capRes, resRes, seqRes, deptRes2, staffRes, holsRes, otRes] = await Promise.all([
    supabase.from('jobs').select('*').order('id'),
    supabase.from('capacity').select('*'),
    supabase.from('dept_resources').select('*'),
    supabase.from('day_sequence').select('*'),
    supabase.from('departments').select('*').order('sort_order'),
    supabase.from('staff').select('*').order('id'),
    supabase.from('staff_holidays').select('*'),
    supabase.from('overtime').select('*'),
  ])
  if (jobsRes.error) throw jobsRes.error
  if (capRes.error) throw capRes.error
  if (resRes.error) throw resRes.error
  if (seqRes.error) throw seqRes.error
  if (deptRes2.error) throw deptRes2.error
  if (staffRes.error) throw staffRes.error
  if (holsRes.error) throw holsRes.error
  if (otRes.error) throw otRes.error

  const jobs = (jobsRes.data || []).map(rowToJob)

  const capacity = {}
  for (const c of capRes.data || []) {
    if (!capacity[c.dept]) capacity[c.dept] = {}
    capacity[c.dept][c.day] = c.minutes
  }

  const deptRes = {}
  for (const r of resRes.data || []) deptRes[r.dept] = r.count

  const daySeq = {}
  for (const s of seqRes.data || []) daySeq[`${s.dept}|${s.day}`] = s.job_ids || []

  // departments: full editable config incl. type + working pattern
  const departments = (deptRes2.data || []).map(d => ({
    key: d.key, label: d.label, color: d.color, bg: d.bg, text: d.text,
    res: d.res, enabled: d.enabled !== false, sortOrder: d.sort_order ?? 0,
    deptType: d.dept_type || 'people',
    dayStart: d.day_start ?? 480, dayEnd: d.day_end ?? 990,
    breakMins: d.break_mins ?? 30, machineHours: d.machine_hours ?? 8,
  }))

  // staff
  const staff = (staffRes.data || []).map(s => ({
    id: s.id, name: s.name || '', homeDept: s.home_dept || '', alsoDepts: s.also_depts || [],
  }))

  // holidays: { staffId: Set-like array of 'YYYY-MM-DD' }
  const holidays = {}
  for (const h of holsRes.data || []) {
    if (!holidays[h.staff_id]) holidays[h.staff_id] = []
    holidays[h.staff_id].push(h.day)
  }

  // overtime: { "dept|day": {extraHours, staffCount} }
  const overtime = {}
  for (const o of otRes.data || []) overtime[`${o.dept}|${o.day}`] = { extraHours: Number(o.extra_hours)||0, staffCount: o.staff_count||1 }

  return { jobs, capacity, deptRes, daySeq, departments, staff, holidays, overtime }
}

// ─── Staff CRUD ───
export async function insertStaffDb(s) {
  const { data, error } = await supabase.from('staff').insert({ name:s.name, home_dept:s.homeDept||null, also_depts:s.alsoDepts||[] }).select().single()
  if (error) throw error
  return { id:data.id, name:data.name, homeDept:data.home_dept||'', alsoDepts:data.also_depts||[] }
}
export async function updateStaffDb(s) {
  const { error } = await supabase.from('staff').update({ name:s.name, home_dept:s.homeDept||null, also_depts:s.alsoDepts||[] }).eq('id', s.id)
  if (error) throw error
}
export async function deleteStaffDb(id) {
  const { error } = await supabase.from('staff').delete().eq('id', id)
  if (error) throw error
}
export async function setHolidayDb(staffId, day, isOff) {
  if (isOff) {
    const { error } = await supabase.from('staff_holidays').upsert({ staff_id:staffId, day })
    if (error) throw error
  } else {
    const { error } = await supabase.from('staff_holidays').delete().eq('staff_id',staffId).eq('day',day)
    if (error) throw error
  }
}
export async function setOvertimeDb(dept, day, extraHours, staffCount) {
  if ((extraHours||0) <= 0) {
    const { error } = await supabase.from('overtime').delete().eq('dept',dept).eq('day',day)
    if (error) throw error
  } else {
    const { error } = await supabase.from('overtime').upsert({ dept, day, extra_hours:extraHours, staff_count:staffCount||1 })
    if (error) throw error
  }
}

// ─── Departments CRUD ───
export async function saveDepartmentsDb(depts) {
  const rows = depts.map((d,i) => ({
    key: d.key, label: d.label, color: d.color, bg: d.bg, text: d.text,
    res: d.res, enabled: d.enabled !== false, sort_order: i,
    dept_type: d.deptType || 'people',
    day_start: d.dayStart ?? 480, day_end: d.dayEnd ?? 990,
    break_mins: d.breakMins ?? 30, machine_hours: d.machineHours ?? 8,
  }))
  const { error } = await supabase.from('departments').upsert(rows)
  if (error) throw error
}

export async function seedDepartmentsIfEmpty(defaultDepts) {
  const { data, error } = await supabase.from('departments').select('key')
  if (error) throw error
  if ((data || []).length === 0) {
    const rows = defaultDepts.map((d,i) => ({
      key: d.key, label: d.label, color: d.color, bg: d.bg, text: d.text,
      res: d.res, enabled: true, sort_order: i,
      dept_type:'people', day_start:480, day_end:990, break_mins:30, machine_hours:8,
    }))
    const { error: e2 } = await supabase.from('departments').upsert(rows)
    if (e2) throw e2
  }
}

export async function setDaySequenceDb(dept, day, jobIds) {
  const { error } = await supabase.from('day_sequence').upsert({ dept, day, job_ids: jobIds })
  if (error) throw error
}

// ─── Job CRUD ───
export async function insertJob(job) {
  const { data, error } = await supabase.from('jobs').insert(jobToRow(job)).select().single()
  if (error) throw error
  return rowToJob(data)
}
export async function updateJob(job) {
  const { error } = await supabase.from('jobs').update(jobToRow(job)).eq('id', job.id)
  if (error) throw error
}
export async function deleteJobDb(id) {
  const { error } = await supabase.from('jobs').delete().eq('id', id)
  if (error) throw error
}

// ─── Capacity ───
export async function setCapacityDb(dept, day, minutes) {
  const { error } = await supabase.from('capacity').upsert({ dept, day, minutes })
  if (error) throw error
}
export async function clearCapacityDb(dept, day) {
  const { error } = await supabase.from('capacity').delete().eq('dept', dept).eq('day', day)
  if (error) throw error
}

// ─── Dept resources ───
export async function setDeptResDb(dept, count) {
  const { error } = await supabase.from('dept_resources').upsert({ dept, count })
  if (error) throw error
}

// ─── Seed defaults on first run (only if DB empty) ───
export async function seedIfEmpty(defaultDeptRes) {
  const { data, error } = await supabase.from('dept_resources').select('dept')
  if (error) throw error
  if ((data || []).length === 0) {
    const rows = Object.entries(defaultDeptRes).map(([dept, count]) => ({ dept, count }))
    await supabase.from('dept_resources').upsert(rows)
  }
}
