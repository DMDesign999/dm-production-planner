import { useState, useEffect } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import App from './App'

export default function Root() {
  const [session, setSession] = useState(undefined) // undefined = loading

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div style={{padding:40,textAlign:'center',fontFamily:'Open Sans,sans-serif',color:'#888'}}>Loading…</div>
  }
  if (!session) return <Login />
  return <App session={session} />
}
