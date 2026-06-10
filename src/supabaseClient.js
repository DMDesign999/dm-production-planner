import { createClient } from '@supabase/supabase-js'
 
// These come from Vercel environment variables (and .env.local for local dev).
// Vite exposes vars prefixed with VITE_ to the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
 
if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}
 
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    // We keep auto-refresh on (so sessions don't expire mid-use); Root.jsx
    // ignores token-refresh events that don't change the logged-in user,
    // which prevents open forms from being disrupted.
  },
})
export const COMPANY_DOMAIN = 'dmdesignfabrication.co.uk'
 
