import { supabase } from './supabaseClient'

// ─── Convert DB row (snake_case) → app job (camelCase) ───
export function rowToJob(r) {
  return {
    id: r.id,
    title: r.title || '',
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
  }
}

// ─── Convert app job (camelCase) → DB row (snake_case) ───
export function jobToRow(j) {
  const row = {
    title: j.title || '',
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
    updated_at: new Date().toISOString(),
  }
  // Only include id if it's a real DB id (number from DB). New jobs omit it.
  if (typeof j.id === 'number') row.id = j.id
  return row
}

// ─── Load everything ───
export async function loadAll() {
  const [jobsRes, capRes, resRes] = await Promise.all([
    supabase.from('jobs').select('*').order('id'),
    supabase.from('capacity').select('*'),
    supabase.from('dept_resources').select('*'),
  ])
  if (jobsRes.error) throw jobsRes.error
  if (capRes.error) throw capRes.error
  if (resRes.error) throw resRes.error

  const jobs = (jobsRes.data || []).map(rowToJob)

  // capacity rows {dept, day, minutes} → { dept: { day: minutes } }
  const capacity = {}
  for (const c of capRes.data || []) {
    if (!capacity[c.dept]) capacity[c.dept] = {}
    capacity[c.dept][c.day] = c.minutes
  }

  // dept_resources rows {dept, count} → { dept: count }
  const deptRes = {}
  for (const r of resRes.data || []) deptRes[r.dept] = r.count

  return { jobs, capacity, deptRes }
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
