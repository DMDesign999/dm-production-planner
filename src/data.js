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
    reopened: !!j.reopened,
    updated_at: new Date().toISOString(),
  }
  // Only include id if it's a real DB id (number from DB). New jobs omit it.
  if (typeof j.id === 'number') row.id = j.id
  return row
}

// ─── Load everything ───
export async function loadAll() {
  const [jobsRes, capRes, resRes, seqRes] = await Promise.all([
    supabase.from('jobs').select('*').order('id'),
    supabase.from('capacity').select('*'),
    supabase.from('dept_resources').select('*'),
    supabase.from('day_sequence').select('*'),
  ])
  if (jobsRes.error) throw jobsRes.error
  if (capRes.error) throw capRes.error
  if (resRes.error) throw resRes.error
  if (seqRes.error) throw seqRes.error

  const jobs = (jobsRes.data || []).map(rowToJob)

  const capacity = {}
  for (const c of capRes.data || []) {
    if (!capacity[c.dept]) capacity[c.dept] = {}
    capacity[c.dept][c.day] = c.minutes
  }

  const deptRes = {}
  for (const r of resRes.data || []) deptRes[r.dept] = r.count

  // day_sequence rows {dept, day, job_ids[]} → { "dept|day": [ids] }
  const daySeq = {}
  for (const s of seqRes.data || []) daySeq[`${s.dept}|${s.day}`] = s.job_ids || []

  return { jobs, capacity, deptRes, daySeq }
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
