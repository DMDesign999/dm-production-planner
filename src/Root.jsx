import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabaseClient'
import Login from './Login'
import App from './App'

export default function Root() {
  const [session, setSession] = useState(undefined) // undefined = loading
  const currentUserId = useRef(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      currentUserId.current = data.session?.user?.id || null
      setSession(data.session)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const newUserId = s?.user?.id || null
      // Only react to a genuine change of logged-in user (sign in / sign out).
      // Ignore TOKEN_REFRESHED / focus events that keep the same user signed in,
      // because re-setting session would re-render and disrupt open forms.
      if (newUserId !== currentUserId.current) {
        currentUserId.current = newUserId
        setSession(s)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) {
    return <div style={{padding:40,textAlign:'center',fontFamily:'Open Sans,sans-serif',color:'#888'}}>Loading…</div>
  }
  if (!session) return <Login />
  return <App session={session} />
}
