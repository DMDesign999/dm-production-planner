import { Component } from 'react'

// Catches render errors in its children and shows them on screen
// instead of silently unmounting (which looks like the modal "disappearing").
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    // also log for good measure
    console.error('Modal render error:', error, info)
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:20}}>
          <div style={{background:'#fff',borderRadius:8,padding:24,maxWidth:520,width:'100%',fontFamily:'Open Sans,sans-serif'}}>
            <h2 style={{color:'#c0392b',fontSize:16,marginBottom:10}}>Something went wrong in the form</h2>
            <p style={{fontSize:13,color:'#444',marginBottom:10}}>This message is here to help diagnose the disappearing-form bug. Please screenshot it.</p>
            <pre style={{background:'#fff5f5',border:'1px solid #f0c0c0',borderRadius:6,padding:10,fontSize:11,color:'#7a1e1e',whiteSpace:'pre-wrap',overflow:'auto',maxHeight:240}}>{String(this.state.error?.stack || this.state.error)}</pre>
            <button onClick={()=>{ this.setState({error:null}); this.props.onClose && this.props.onClose() }} style={{marginTop:14,background:'#39BF5B',color:'#fff',border:'none',borderRadius:4,padding:'8px 16px',fontWeight:700,cursor:'pointer'}}>Close</button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
