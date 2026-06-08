import { createClient } from '@supabase/supabase-js'

// These come from Vercel environment variables (and .env.local for local dev).
// Vite exposes vars prefixed with VITE_ to the browser.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase env vars. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
export const COMPANY_DOMAIN = 'dmdesignfabrication.co.uk'
