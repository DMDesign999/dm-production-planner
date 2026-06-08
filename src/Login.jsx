import { useState } from 'react'
import { supabase, COMPANY_DOMAIN } from './supabaseClient'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  async function submit(e) {
    e.preventDefault()
    setErr(null); setMsg(null)
    const cleanEmail = email.trim().toLowerCase()
    if (mode === 'signup' && !cleanEmail.endsWith('@' + COMPANY_DOMAIN)) {
      setErr(`Sign-up is restricted to @${COMPANY_DOMAIN} email addresses.`)
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password })
        if (error) throw error
      } else {
        const { error } = await supabase.auth.signUp({ email: cleanEmail, password })
        if (error) throw error
        setMsg('Account created — you can now sign in.')
        setMode('login')
      }
    } catch (e2) {
      setErr(e2.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">
          <img src="/dm-logo.png" alt="D&M Design & Fabrication" />
          <div>
            <div className="login-co">D&M Design &amp; Fabrication</div>
            <div className="login-sub">Production Planner</div>
          </div>
        </div>

        <h1 className="login-title">{mode === 'login' ? 'Sign in' : 'Create account'}</h1>

        <form onSubmit={submit}>
          <label className="lbl">Email</label>
          <input type="email" value={email} placeholder={`you@${COMPANY_DOMAIN}`} onChange={e=>setEmail(e.target.value)} required />
          <label className="lbl">Password</label>
          <input type="password" value={password} placeholder="••••••••" onChange={e=>setPassword(e.target.value)} required minLength={6} />

          {err && <div className="login-err">{err}</div>}
          {msg && <div className="login-msg">{msg}</div>}

          <button className="btn-green" type="submit" disabled={busy} style={{width:'100%',marginTop:14,padding:'10px'}}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' ? (
            <>No account yet? <button onClick={()=>{setMode('signup');setErr(null);setMsg(null)}}>Create one</button></>
          ) : (
            <>Already have an account? <button onClick={()=>{setMode('login');setErr(null);setMsg(null)}}>Sign in</button></>
          )}
        </div>
        <div className="login-note">Accounts are restricted to @{COMPANY_DOMAIN} email addresses.</div>
      </div>
    </div>
  )
}
