import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
         PieChart, Pie, Cell, Legend, LineChart, Line } from 'recharts'
import {
  getFuncionarios, upsertFuncionario, deleteFuncionario,
  getEpis, upsertEpi, updateQuantidadeEpi, deleteEpi,
  getEntregas, insertEntrega, deleteEntrega,
  getDevolucoes, insertDevolucao, deleteDevolucao,
  login, logout, getSession, getPerfil,
  getUsuarios, atualizarPerfil, deletarUsuario
} from './supabase'

// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const MOTIVOS_ENTREGA   = ['Funcionário novo','Troca por dano','Troca por vencimento','Reposição','Perda']
const MOTIVOS_DEVOLUCAO = ['Desligamento de funcionário','Troca por dano','Troca por vencimento']
const RESIDUO_DEV = new Set(['Desligamento de funcionário','Troca por dano','Troca por vencimento'])
const RESIDUO_ENT = new Set(['Perda'])

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const hoje     = () => new Date().toISOString().split('T')[0]
const fmtDate  = (d) => { if(!d) return '—'; const [y,m,dia]=d.split('-'); return `${dia}/${m}/${y}` }
const diasVenc = (v) => Math.ceil((new Date(v)-new Date())/864e5)

function gerarAlertas(epis) {
  const a = []
  epis.forEach(e => {
    if (e.quantidade <= e.minimo)
      a.push({ tipo:'estoque', epi:e.descricao, msg:`Estoque baixo: ${e.quantidade} un. (mín: ${e.minimo})`, id:e.id+'_e' })
    const d = diasVenc(e.validade)
    if (d <= 30)
      a.push({ tipo:'validade', epi:e.descricao,
        msg: d<0 ? `VENCIDO há ${Math.abs(d)} dia(s)` : `Vence em ${d} dia(s) — ${fmtDate(e.validade)}`,
        id: e.id+'_v', vencido: d<0 })
  })
  return a
}

function calcResiduos(entregas, devolucoes, epis) {
  const pm = {}; epis.forEach(e => pm[e.id] = e.pesoG||0)
  return [
    ...devolucoes.filter(d=>RESIDUO_DEV.has(d.motivo)).map(d=>({...d,pesoG:pm[d.epiId]||0,origem:'Devolução'})),
    ...entregas.filter(e=>RESIDUO_ENT.has(e.motivo)).map(e=>({...e,pesoG:pm[e.epiId]||0,origem:'Perda'})),
  ]
}

function calcPosse(funcId, entregas, devolucoes) {
  const m = {}
  entregas.filter(e=>e.funcId===funcId).forEach(e=>{
    m[e.epiId] = m[e.epiId]||{epiId:e.epiId,epiDesc:e.epiDesc,qtd:0}
    m[e.epiId].qtd += e.quantidade
  })
  devolucoes.filter(d=>d.funcId===funcId).forEach(d=>{
    if(m[d.epiId]) m[d.epiId].qtd = Math.max(0, m[d.epiId].qtd - d.quantidade)
  })
  return Object.values(m).filter(p=>p.qtd>0)
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function useToast() {
  const [ts,setTs] = useState([])
  const add = useCallback((msg, type='success') => {
    const id = Date.now()+Math.random()
    setTs(p=>[...p,{id,msg,type}])
    setTimeout(()=>setTs(p=>p.filter(t=>t.id!==id)), 3500)
  },[])
  return { ts, add }
}
function Toasts({ ts }) {
  const c = { success:'#10b981', error:'#ef4444', info:'#3b82f6', warn:'#f59e0b' }
  return (
    <div style={{position:'fixed',bottom:80,right:24,zIndex:9999,display:'flex',flexDirection:'column',gap:8,pointerEvents:'none'}}>
      {ts.map(t=>(
        <div key={t.id} style={{background:'#1e3a5f',border:`1px solid ${c[t.type]||c.success}`,
          borderLeft:`4px solid ${c[t.type]||c.success}`,borderRadius:10,padding:'12px 18px',
          color:'#f1f5f9',fontSize:13,fontWeight:600,boxShadow:'0 8px 24px rgba(0,0,0,.6)',
          minWidth:240,animation:'fadeSlide .25s ease'}}>
          {t.type==='success'?'✅':t.type==='error'?'❌':t.type==='warn'?'⚠️':'ℹ️'} {t.msg}
        </div>
      ))}
    </div>
  )
}

// ─── UI ATOMS ─────────────────────────────────────────────────────────────────
const S = {
  card:  {background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'center',gap:16,flexWrap:'wrap',boxShadow:'0 1px 3px rgba(0,0,0,.06)'},
  title: {color:'#1e293b',fontSize:20,fontWeight:700,margin:'0 0 4px 0',fontFamily:"'Sora',sans-serif"},
  ax:    {fill:'#475569',fontSize:11},
  tt:    {background:'#1e293b',border:'1px solid #334155',borderRadius:8,color:'#f1f5f9',fontSize:13},
  clr:   ['#3b82f6','#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316'],
  grn:   ['#10b981','#34d399','#6ee7b7','#059669','#047857','#065f46'],
}

function Bdg({ children, color='gray' }) {
  const m = { green:'#d1fae5|#065f46',red:'#fee2e2|#991b1b',yellow:'#fef3c7|#92400e',gray:'#e2e8f0|#475569',blue:'#dbeafe|#1e40af' }
  const [bg,fg] = (m[color]||m.gray).split('|')
  return <span style={{background:bg,color:fg,padding:'2px 10px',borderRadius:999,fontSize:12,fontWeight:700}}>{children}</span>
}

function Inp({ label, ...p }) {
  return (
    <div style={{marginBottom:16}}>
      {label && <label style={{display:'block',color:'#94a3b8',fontSize:12,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:.8}}>{label}</label>}
      <input {...p} style={{width:'100%',background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,
        padding:'10px 14px',color:'#1e293b',fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit',...(p.style||{})}}/>
    </div>
  )
}

function Sel({ label, options, value, onChange }) {
  return (
    <div style={{marginBottom:16}}>
      {label && <label style={{display:'block',color:'#94a3b8',fontSize:12,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:.8}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)}
        style={{width:'100%',background:'#0f172a',border:'1px solid #334155',borderRadius:8,
          padding:'10px 14px',color:'#f1f5f9',fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}>
        <option value=''>Selecione...</option>
        {options.map(o=><option key={o.value??o} value={o.value??o}>{o.label??o}</option>)}
      </select>
    </div>
  )
}

function Btn({ children, onClick, variant='primary', small, disabled }) {
  const v = {
    primary: {background:'linear-gradient(135deg,#3b82f6,#6366f1)',color:'#fff',border:'none'},
    danger:  {background:'linear-gradient(135deg,#ef4444,#dc2626)',color:'#fff',border:'none'},
    success: {background:'linear-gradient(135deg,#10b981,#059669)',color:'#fff',border:'none'},
    ghost:   {background:'transparent',color:'#94a3b8',border:'1px solid #334155'},
    warn:    {background:'linear-gradient(135deg,#f59e0b,#d97706)',color:'#fff',border:'none'},
  }
  return (
    <button onClick={onClick} disabled={disabled}
      style={{...v[variant]||v.primary,borderRadius:8,padding:small?'6px 14px':'10px 20px',
        fontSize:small?12:14,fontWeight:600,cursor:disabled?'not-allowed':'pointer',
        opacity:disabled?.5:1,fontFamily:'inherit',whiteSpace:'nowrap'}}>
      {children}
    </button>
  )
}

function Kv({ k, v, hi }) {
  return (
    <div>
      <div style={{color:'#94a3b8',fontSize:11,textTransform:'uppercase',letterSpacing:.6}}>{k}</div>
      <div style={{color:hi?'#1d4ed8':'#334155',fontWeight:hi?700:400,fontSize:13}}>{v||'—'}</div>
    </div>
  )
}

function Empty({ msg }) { return <div style={{textAlign:'center',color:'#94a3b8',padding:'40px 0',fontSize:14}}>{msg}</div> }

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(15,23,42,.8)',zIndex:1000,
      display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(4px)'}}>
      <div style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:16,padding:32,
        width:'90%',maxWidth:wide?900:560,maxHeight:'92vh',overflowY:'auto',boxShadow:'0 25px 60px rgba(0,0,0,.15)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
          <h2 style={{margin:0,color:'#1e3a5f',fontSize:18,fontFamily:"'Sora',sans-serif"}}>{title}</h2>
          <button onClick={onClose} style={{background:'none',border:'none',color:'#94a3b8',fontSize:24,cursor:'pointer'}}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ─── PAGINAÇÃO ────────────────────────────────────────────────────────────────
function usePag(data, n=10) {
  const [pg,setPg] = useState(1)
  const prevLen = useRef(data.length)
  useEffect(()=>{ if(data.length!==prevLen.current){ setPg(1); prevLen.current=data.length } },[data.length])
  const total = Math.max(1,Math.ceil(data.length/n))
  const safe = Math.min(pg,total)
  return { paged:data.slice((safe-1)*n,safe*n), pg:safe, setPg, total }
}

function Pager({ pg, total, setPg }) {
  if(total<=1) return null
  const pages = [...Array(total)].map((_,i)=>i+1)
  const vis = pages.filter(p=>p===1||p===total||Math.abs(p-pg)<=1)
  return (
    <div style={{display:'flex',justifyContent:'center',alignItems:'center',gap:6,marginTop:16}}>
      <button onClick={()=>setPg(p=>Math.max(1,p-1))} disabled={pg===1}
        style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:6,padding:'5px 12px',color:pg===1?'#cbd5e1':'#64748b',cursor:pg===1?'not-allowed':'pointer',fontSize:13}}>‹</button>
      {vis.map((p,i)=>(
        <span key={p} style={{display:'contents'}}>
          {i>0&&vis[i-1]!==p-1&&<span style={{color:'#475569'}}>…</span>}
          <button onClick={()=>setPg(p)} style={{background:p===pg?'#1e3a5f':'#ffffff',border:`1px solid ${p===pg?'#1e3a5f':'#cbd5e1'}`,borderRadius:6,padding:'5px 10px',color:p===pg?'#fff':'#64748b',cursor:'pointer',fontSize:13,fontWeight:p===pg?700:400,minWidth:32}}>{p}</button>
        </span>
      ))}
      <button onClick={()=>setPg(p=>Math.min(total,p+1))} disabled={pg===total}
        style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:6,padding:'5px 12px',color:pg===total?'#cbd5e1':'#64748b',cursor:pg===total?'not-allowed':'pointer',fontSize:13}}>›</button>
      <span style={{color:'#64748b',fontSize:12,marginLeft:4}}>{pg}/{total}</span>
    </div>
  )
}

// ─── ALERTAS POPUP ────────────────────────────────────────────────────────────
function AlertasPopup({ alertas, onClose }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(15,23,42,.85)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',backdropFilter:'blur(6px)'}}>
      <div style={{background:'#1e293b',border:'1px solid #f59e0b',borderRadius:20,padding:32,maxWidth:500,width:'90%'}}>
        <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
          <span style={{fontSize:30}}>⚠️</span>
          <div>
            <h2 style={{margin:0,color:'#fbbf24',fontSize:18}}>Alertas Ativos</h2>
            <p style={{margin:0,color:'#94a3b8',fontSize:13}}>{alertas.length} item(s) requerem atenção</p>
          </div>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:10,maxHeight:340,overflowY:'auto'}}>
          {alertas.map(a=>(
            <div key={a.id} style={{background:a.vencido?'#450a0a':a.tipo==='estoque'?'#172554':'#422006',
              border:`1px solid ${a.vencido?'#991b1b':a.tipo==='estoque'?'#1d4ed8':'#92400e'}`,borderRadius:10,padding:'12px 16px'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span>{a.tipo==='estoque'?'📦':'📅'}</span>
                <div>
                  <div style={{color:'#f1f5f9',fontSize:13,fontWeight:700}}>{a.epi}</div>
                  <div style={{color:'#cbd5e1',fontSize:12}}>{a.msg}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div style={{marginTop:20,textAlign:'right'}}><Btn onClick={onClose}>Entendido</Btn></div>
      </div>
    </div>
  )
}

// ─── PDF MODAL ────────────────────────────────────────────────────────────────
function PDFModal({ funcionarios, epis, entregas, devolucoes, onClose }) {
  const now = new Date().toLocaleString('pt-BR')
  const res = calcResiduos(entregas,devolucoes,epis)
  const totalResKg = (res.reduce((s,r)=>s+(r.pesoG*r.quantidade),0)/1000).toFixed(2)
  const totalResUn = res.reduce((s,r)=>s+r.quantidade,0)
  const posse = {}
  funcionarios.forEach(f=>{ posse[f.id]={} })
  entregas.forEach(e=>{ if(!posse[e.funcId])posse[e.funcId]={}; posse[e.funcId][e.epiDesc]=(posse[e.funcId][e.epiDesc]||0)+e.quantidade })
  devolucoes.forEach(d=>{ if(!posse[d.funcId])posse[d.funcId]={}; posse[d.funcId][d.epiDesc]=Math.max(0,(posse[d.funcId][d.epiDesc]||0)-d.quantidade) })
  const th = {background:'#e2e8f0',padding:'7px 10px',textAlign:'left',fontSize:11,fontWeight:700,textTransform:'uppercase',color:'#475569',borderBottom:'2px solid #cbd5e1'}
  const td = {padding:'7px 10px',borderBottom:'1px solid #f1f5f9',fontSize:12,color:'#334155'}
  return (
    <Modal title="🖨️ Relatório para Impressão" onClose={onClose} wide>
      <div style={{marginBottom:12,display:'flex',gap:8,justifyContent:'flex-end'}}>
        <Btn onClick={()=>{
          const el=document.getElementById('print-zone');
          const w=window.open('','_blank','width=900,height=700');
          w.document.write('<html><head><title>EPI Control - Relatorio</title><style>*{box-sizing:border-box;margin:0;padding:0;font-family:Arial,sans-serif;}body{padding:20px;color:#1e293b;background:#fff;}</style></head><body>'+el.innerHTML+'</body></html>');
          w.document.close();
          w.focus();
          setTimeout(()=>{w.print();},500);
        }}>🖨️ Imprimir / Salvar PDF</Btn>
      </div>
      <div id="print-zone" style={{background:'#fff',color:'#1e293b',padding:32,borderRadius:8}}>
        <div style={{borderBottom:'3px solid #1e40af',paddingBottom:12,marginBottom:20}}>
          <h1 style={{margin:0,color:'#1e40af',fontSize:20}}>🦺 EPI Control — Relatório Geral</h1>
          <p style={{margin:'4px 0 0',color:'#64748b',fontSize:12}}>Gerado em {now}</p>
        </div>
        <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:20}}>
          {[
            {l:'Func. ativos',    v:funcionarios.filter(f=>f.ativo).length,    c:'#1e40af'},
            {l:'EPIs cadastrados',v:epis.length,                                c:'#6366f1'},
            {l:'Total entregue',  v:entregas.reduce((s,e)=>s+e.quantidade,0)+' un.',  c:'#059669'},
            {l:'Total devolvido', v:devolucoes.reduce((s,d)=>s+d.quantidade,0)+' un.',c:'#d97706'},
            {l:'Resíduos',        v:totalResKg+' kg',                           c:'#065f46'},
          ].map(k=>(
            <div key={k.l} style={{border:`2px solid ${k.c}`,borderRadius:8,padding:'10px 16px',minWidth:130}}>
              <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div>
              <div style={{fontSize:11,color:'#64748b'}}>{k.l}</div>
            </div>
          ))}
        </div>
        <h2 style={{fontSize:12,fontWeight:700,color:'#1e40af',textTransform:'uppercase',margin:'0 0 6px',borderBottom:'2px solid #dbeafe',paddingBottom:4}}>EPIs em Posse por Funcionário</h2>
        <table style={{width:'100%',borderCollapse:'collapse',marginBottom:20}}>
          <thead><tr><th style={th}>Funcionário</th><th style={th}>Status</th><th style={th}>EPI</th><th style={th}>Qtd</th></tr></thead>
          <tbody>
            {funcionarios.map(f=>{
              const itens = Object.entries(posse[f.id]||{}).filter(([,q])=>q>0)
              const badge = <span style={{background:f.ativo?'#d1fae5':'#f3f4f6',color:f.ativo?'#065f46':'#4b5563',padding:'1px 8px',borderRadius:99,fontSize:11,fontWeight:700}}>{f.ativo?'Ativo':'Inativo'}</span>
              if(!itens.length) return <tr key={f.id}><td style={td}><b>{f.nome}</b></td><td style={td}>{badge}</td><td style={td} colSpan={2}>—</td></tr>
              return itens.map(([epi,qtd],i)=>(
                <tr key={f.id+epi}><td style={td}>{i===0?<b>{f.nome}</b>:''}</td><td style={td}>{i===0?badge:''}</td><td style={td}>{epi}</td><td style={td}>{qtd} un.</td></tr>
              ))
            })}
          </tbody>
        </table>
        <h2 style={{fontSize:12,fontWeight:700,color:'#1e40af',textTransform:'uppercase',margin:'0 0 6px',borderBottom:'2px solid #dbeafe',paddingBottom:4}}>Estoque Atual</h2>
        <table style={{width:'100%',borderCollapse:'collapse',marginBottom:20}}>
          <thead><tr>{['EPI','Fabricante','CA','Validade','Estoque','Mínimo','Peso','Status'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {epis.map(e=>{
              const d=diasVenc(e.validade)
              const st=e.quantidade<=e.minimo&&d<=30?'Crítico':e.quantidade<=e.minimo?'Est. Baixo':d<=30?'Vence em breve':'OK'
              const sc={Crítico:'#fee2e2|#991b1b','Est. Baixo':'#dbeafe|#1e40af','Vence em breve':'#fef3c7|#92400e',OK:'#d1fae5|#065f46'}[st].split('|')
              return <tr key={e.id}><td style={{...td,fontWeight:600}}>{e.descricao}</td><td style={td}>{e.fabricante}</td><td style={td}>{e.ca}</td><td style={td}>{fmtDate(e.validade)}</td><td style={td}>{e.quantidade} un.</td><td style={td}>{e.minimo} un.</td><td style={td}>{e.pesoG?e.pesoG+'g':'—'}</td><td style={td}><span style={{background:sc[0],color:sc[1],padding:'1px 8px',borderRadius:99,fontSize:11,fontWeight:700}}>{st}</span></td></tr>
            })}
          </tbody>
        </table>
        <h2 style={{fontSize:12,fontWeight:700,color:'#1e40af',textTransform:'uppercase',margin:'0 0 6px',borderBottom:'2px solid #dbeafe',paddingBottom:4}}>Histórico de Entregas ({entregas.length})</h2>
        <table style={{width:'100%',borderCollapse:'collapse',marginBottom:20}}>
          <thead><tr>{['Data','Funcionário','EPI','Qtd','Motivo'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{entregas.length===0?<tr><td colSpan={5} style={{...td,textAlign:'center',color:'#94a3b8'}}>Sem registros</td></tr>:entregas.map(e=><tr key={e.id}><td style={td}>{fmtDate(e.data)}</td><td style={td}>{e.funcNome}</td><td style={td}>{e.epiDesc}</td><td style={td}>{e.quantidade} un.</td><td style={td}>{e.motivo}</td></tr>)}</tbody>
        </table>
        <h2 style={{fontSize:12,fontWeight:700,color:'#1e40af',textTransform:'uppercase',margin:'0 0 6px',borderBottom:'2px solid #dbeafe',paddingBottom:4}}>Histórico de Devoluções ({devolucoes.length})</h2>
        <table style={{width:'100%',borderCollapse:'collapse',marginBottom:20}}>
          <thead><tr>{['Data','Funcionário','EPI','Qtd','Motivo'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{devolucoes.length===0?<tr><td colSpan={5} style={{...td,textAlign:'center',color:'#94a3b8'}}>Sem registros</td></tr>:devolucoes.map(d=><tr key={d.id}><td style={td}>{fmtDate(d.data)}</td><td style={td}>{d.funcNome}</td><td style={td}>{d.epiDesc}</td><td style={td}>{d.quantidade} un.</td><td style={td}>{d.motivo}</td></tr>)}</tbody>
        </table>
        <h2 style={{fontSize:12,fontWeight:700,color:'#065f46',textTransform:'uppercase',margin:'0 0 6px',borderBottom:'2px solid #d1fae5',paddingBottom:4}}>♻️ Painel Ambiental</h2>
        <div style={{display:'flex',gap:12,marginBottom:12}}>
          <div style={{border:'2px solid #065f46',borderRadius:8,padding:'8px 14px'}}><div style={{fontSize:18,fontWeight:800,color:'#065f46'}}>{totalResUn} un.</div><div style={{fontSize:11,color:'#64748b'}}>EPIs descartados</div></div>
          <div style={{border:'2px solid #065f46',borderRadius:8,padding:'8px 14px'}}><div style={{fontSize:18,fontWeight:800,color:'#065f46'}}>{totalResKg} kg</div><div style={{fontSize:11,color:'#64748b'}}>Peso total</div></div>
        </div>
        <table style={{width:'100%',borderCollapse:'collapse'}}>
          <thead><tr>{['Data','EPI','Qtd','Peso unit.','Peso total','Origem'].map(h=><th key={h} style={th}>{h}</th>)}</tr></thead>
          <tbody>{res.length===0?<tr><td colSpan={6} style={{...td,textAlign:'center',color:'#94a3b8'}}>Sem resíduos</td></tr>:res.map((r,i)=><tr key={i}><td style={td}>{fmtDate(r.data)}</td><td style={td}>{r.epiDesc}</td><td style={td}>{r.quantidade} un.</td><td style={td}>{r.pesoG}g</td><td style={{...td,fontWeight:700,color:'#065f46'}}>{((r.pesoG*r.quantidade)/1000).toFixed(3)} kg</td><td style={td}>{r.origem}</td></tr>)}</tbody>
        </table>
        <div style={{marginTop:24,borderTop:'1px solid #e2e8f0',paddingTop:10,color:'#94a3b8',fontSize:11,textAlign:'center'}}>EPI Control — {now}</div>
      </div>
    </Modal>
  )
}

// ─── CHART HELPERS ────────────────────────────────────────────────────────────
function ChartCard({ title, children, span2 }) {
  return (
    <div style={{background:'#1e293b',border:'1px solid #334155',borderRadius:16,padding:'20px 20px 14px',gridColumn:span2?'span 2':undefined}}>
      <div style={{color:'#64748b',fontSize:12,fontWeight:700,textTransform:'uppercase',letterSpacing:.8,marginBottom:16}}>{title}</div>
      {children}
    </div>
  )
}
const FDate = ({label,value,onChange}) => (
  <div style={{display:'flex',flexDirection:'column',gap:4}}>
    <label style={{color:'#64748b',fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:.7}}>{label}</label>
    <input type="date" value={value} onChange={e=>onChange(e.target.value)}
      style={{background:'#0f172a',border:'1px solid #334155',borderRadius:8,padding:'7px 12px',color:'#f1f5f9',fontSize:13,outline:'none',fontFamily:'inherit'}}/>
  </div>
)
const FSel = ({label,value,onChange,options}) => (
  <div style={{display:'flex',flexDirection:'column',gap:4,minWidth:140}}>
    <label style={{color:'#64748b',fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:.7}}>{label}</label>
    <select value={value} onChange={e=>onChange(e.target.value)}
      style={{background:'#0f172a',border:'1px solid #334155',borderRadius:8,padding:'7px 12px',color:'#f1f5f9',fontSize:13,outline:'none',fontFamily:'inherit'}}>
      {options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  </div>
)

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ funcionarios, epis, entregas, devolucoes }) {
  const ano = new Date().getFullYear()
  const [dIni,setDIni] = useState(`${ano}-01-01`)
  const [dFim,setDFim] = useState(hoje())
  const [fF,setFF] = useState('todos')
  const [fE,setFE] = useState('todos')
  const [fM,setFM] = useState('todos')
  const motivos = useMemo(()=>[...new Set([...MOTIVOS_ENTREGA,...MOTIVOS_DEVOLUCAO])],[])
  const fil = useCallback(l=>l.filter(r=>r.data>=dIni&&r.data<=dFim&&(fF==='todos'||r.funcId===fF)&&(fE==='todos'||r.epiId===fE)&&(fM==='todos'||r.motivo===fM)),[dIni,dFim,fF,fE,fM])
  const ef = useMemo(()=>fil(entregas),[entregas,fil])
  const df = useMemo(()=>fil(devolucoes),[devolucoes,fil])
  const alertas = useMemo(()=>gerarAlertas(epis),[epis])
  const resKg = useMemo(()=>(calcResiduos(ef,df,epis).reduce((s,r)=>s+(r.pesoG*r.quantidade),0)/1000).toFixed(2),[ef,df,epis])
  const entMes = useMemo(()=>{const m={};ef.forEach(e=>{const k=e.data.slice(0,7);m[k]=(m[k]||0)+e.quantidade});return Object.entries(m).sort().map(([k,v])=>({mes:k.slice(5)+'/'+k.slice(2,4),total:v}))},[ef])
  const episTop = useMemo(()=>{const m={};ef.forEach(e=>{m[e.epiDesc]=(m[e.epiDesc]||0)+e.quantidade});return Object.entries(m).sort(([,a],[,b])=>b-a).slice(0,6).map(([e,t])=>({epi:e.length>18?e.slice(0,17)+'…':e,total:t}))},[ef])
  const movF = useMemo(()=>{const m={};ef.forEach(e=>{m[e.funcNome]=m[e.funcNome]||{nome:e.funcNome,ent:0,dev:0};m[e.funcNome].ent+=e.quantidade});df.forEach(d=>{m[d.funcNome]=m[d.funcNome]||{nome:d.funcNome,ent:0,dev:0};m[d.funcNome].dev+=d.quantidade});return Object.values(m).sort((a,b)=>(b.ent+b.dev)-(a.ent+a.dev)).slice(0,7).map(r=>({...r,nome:r.nome.split(' ')[0]+' '+r.nome.split(' ').slice(-1)[0]}))},[ef,df])
  const estoq = useMemo(()=>epis.map(e=>({epi:e.descricao.length>16?e.descricao.slice(0,15)+'…':e.descricao,atual:e.quantidade,minimo:e.minimo})),[epis])
  const devMot = useMemo(()=>{const m={};df.forEach(d=>{m[d.motivo]=(m[d.motivo]||0)+d.quantidade});return Object.entries(m).map(([motivo,value])=>({motivo,value}))},[df])

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:20,flexWrap:'wrap',gap:12}}>
        <h2 style={S.title}>📊 Dashboard</h2>
        <button onClick={()=>{setDIni(`${ano}-01-01`);setDFim(hoje());setFF('todos');setFE('todos');setFM('todos')}}
          style={{background:'transparent',border:'1px solid #334155',borderRadius:8,color:'#94a3b8',fontSize:12,padding:'6px 14px',cursor:'pointer',fontFamily:'inherit'}}>↺ Limpar filtros</button>
      </div>
      <div style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:14,padding:'16px 20px',marginBottom:24,display:'flex',flexWrap:'wrap',gap:16,alignItems:'flex-end',boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
        <FDate label="De"  value={dIni} onChange={setDIni}/>
        <FDate label="Até" value={dFim} onChange={setDFim}/>
        <FSel label="Funcionário" value={fF} onChange={setFF} options={[{value:'todos',label:'Todos'},...funcionarios.map(f=>({value:f.id,label:f.nome}))]}/>
        <FSel label="EPI"         value={fE} onChange={setFE} options={[{value:'todos',label:'Todos'},...epis.map(e=>({value:e.id,label:e.descricao}))]}/>
        <FSel label="Motivo"      value={fM} onChange={setFM} options={[{value:'todos',label:'Todos'},...motivos.map(m=>({value:m,label:m}))]}/>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(148px,1fr))',gap:12,marginBottom:24}}>
        {[
          {l:'Func. ativos',    v:funcionarios.filter(f=>f.ativo).length, i:'👷',c:'#3b82f6'},
          {l:'EPIs cadastrados',v:epis.length,                             i:'🦺',c:'#6366f1'},
          {l:'Entregas',        v:ef.reduce((s,e)=>s+e.quantidade,0),     i:'📤',c:'#10b981'},
          {l:'Devoluções',      v:df.reduce((s,d)=>s+d.quantidade,0),     i:'📥',c:'#f59e0b'},
          {l:'Alertas',         v:alertas.length,                          i:'⚠️',c:alertas.length?'#ef4444':'#10b981'},
          {l:'Resíduos',        v:resKg+' kg',                             i:'🌱',c:'#10b981'},
        ].map(k=>(
          <div key={k.l} style={{background:'#ffffff',borderRadius:12,padding:'16px 18px',border:'1px solid #cbd5e1',borderTop:`3px solid ${k.c}`,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
            <div style={{fontSize:20,marginBottom:6}}>{k.i}</div>
            <div style={{color:k.c,fontSize:22,fontWeight:800}}>{k.v}</div>
            <div style={{color:'#64748b',fontSize:11,marginTop:2}}>{k.l}</div>
          </div>
        ))}
      </div>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
        <ChartCard title="📈 Entregas por mês" span2>
          {entMes.length===0?<Empty msg="Sem dados no período."/>:
          <ResponsiveContainer width="100%" height={220}><LineChart data={entMes} margin={{top:4,right:16,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="mes" tick={S.ax}/><YAxis tick={S.ax} allowDecimals={false}/><Tooltip contentStyle={S.tt}/><Line type="monotone" dataKey="total" name="Qtd entregue" stroke="#3b82f6" strokeWidth={2.5} dot={{fill:'#3b82f6',r:4}}/></LineChart></ResponsiveContainer>}
        </ChartCard>
        <ChartCard title="🦺 EPIs mais entregues">
          {episTop.length===0?<Empty msg="Sem dados."/>:
          <ResponsiveContainer width="100%" height={220}><BarChart data={episTop} layout="vertical" margin={{top:0,right:16,left:8,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false}/><XAxis type="number" tick={S.ax} allowDecimals={false}/><YAxis dataKey="epi" type="category" tick={S.ax} width={90}/><Tooltip contentStyle={S.tt}/><Bar dataKey="total" name="Qtd" radius={[0,6,6,0]}>{episTop.map((_,i)=><Cell key={i} fill={S.clr[i%S.clr.length]}/>)}</Bar></BarChart></ResponsiveContainer>}
        </ChartCard>
        <ChartCard title="👷 Movimentações por funcionário">
          {movF.length===0?<Empty msg="Sem dados."/>:
          <ResponsiveContainer width="100%" height={220}><BarChart data={movF} margin={{top:0,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="nome" tick={S.ax}/><YAxis tick={S.ax} allowDecimals={false}/><Tooltip contentStyle={S.tt}/><Legend wrapperStyle={{fontSize:11,color:'#94a3b8'}}/><Bar dataKey="ent" name="Entregas" fill="#3b82f6" radius={[4,4,0,0]}/><Bar dataKey="dev" name="Devoluções" fill="#10b981" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>}
        </ChartCard>
        <ChartCard title="📦 Estoque atual vs mínimo">
          <ResponsiveContainer width="100%" height={220}><BarChart data={estoq} margin={{top:0,right:8,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="epi" tick={S.ax}/><YAxis tick={S.ax} allowDecimals={false}/><Tooltip contentStyle={S.tt}/><Legend wrapperStyle={{fontSize:11,color:'#94a3b8'}}/><Bar dataKey="atual" name="Em estoque" fill="#6366f1" radius={[4,4,0,0]}/><Bar dataKey="minimo" name="Mínimo" fill="#ef4444" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer>
        </ChartCard>
        <ChartCard title="📥 Devoluções por motivo" span2>
          {devMot.length===0?<Empty msg="Sem devoluções no período."/>:
          <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:32,flexWrap:'wrap'}}>
            <PieChart width={220} height={220}><Pie data={devMot} dataKey="value" nameKey="motivo" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>{devMot.map((_,i)=><Cell key={i} fill={S.clr[i%S.clr.length]}/>)}</Pie><Tooltip contentStyle={S.tt} formatter={(v,n)=>[v+' un.',n]}/></PieChart>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {devMot.map((d,i)=>(<div key={d.motivo} style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:12,height:12,borderRadius:3,background:S.clr[i%S.clr.length]}}/><div><div style={{color:'#f1f5f9',fontSize:13,fontWeight:600}}>{d.motivo}</div><div style={{color:'#64748b',fontSize:12}}>{d.value} un.</div></div></div>))}
            </div>
          </div>}
        </ChartCard>
      </div>
    </div>
  )
}

// ─── FUNCIONÁRIOS ─────────────────────────────────────────────────────────────
function Funcionarios({ funcionarios, setFuncionarios, entregas, devolucoes, toast }) {
  const [modal,setModal] = useState(false)
  const [form,setForm] = useState({id:'',nome:'',ativo:true})
  const [editId,setEditId] = useState(null)
  const [histF,setHistF] = useState(null)
  const [ordem,setOrdem] = useState('cadastro')
  const funcOrdenados = useMemo(()=>{
    const l=[...funcionarios]
    if(ordem==='alfa') l.sort((a,b)=>a.nome.localeCompare(b.nome))
    return l
  },[funcionarios,ordem])
  const [loading,setLoading] = useState(false)

  const abrir = (f=null) => { setForm(f?{...f}:{id:'',nome:'',ativo:true}); setEditId(f?f.id:null); setModal(true) }
  const salvar = async () => {
    if(!form.id.trim()||!form.nome.trim()) return alert('Preencha ID e Nome.')
    if(!editId && funcionarios.find(f=>f.id===form.id)) return alert('ID já existe.')
    setLoading(true)
    try {
      await upsertFuncionario(form)
      if(editId) setFuncionarios(p=>p.map(f=>f.id===editId?{...form}:f))
      else       setFuncionarios(p=>[...p,{...form}])
      toast(editId?'Funcionário atualizado!':'Funcionário cadastrado!')
      setModal(false)
    } catch(e) { toast('Erro ao salvar: '+e.message,'error') }
    finally { setLoading(false) }
  }
  const remover = async (id) => {
    if(!confirm('Remover funcionário?')) return
    try {
      await deleteFuncionario(id)
      setFuncionarios(p=>p.filter(f=>f.id!==id))
      toast('Removido.','info')
    } catch(e) { toast('Erro ao remover: '+e.message,'error') }
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <h2 style={S.title}>👷 Funcionários</h2>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <select value={ordem} onChange={e=>setOrdem(e.target.value)} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'7px 12px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="cadastro">Ordem de cadastro</option>
            <option value="alfa">Ordem alfabética</option>
          </select>
          {podeEditar&&<Btn onClick={()=>abrir()}>+ Novo Funcionário</Btn>}
        </div>
      </div>
      {!funcionarios.length?<Empty msg="Nenhum funcionário cadastrado."/>:(
        <div style={{display:'grid',gap:10}}>
          {funcOrdenados.map(f=>(
            <div key={f.id} style={S.card}>
              <div style={{display:'flex',alignItems:'center',gap:14,flex:1}}>
                <div style={{width:40,height:40,borderRadius:'50%',background:'linear-gradient(135deg,#3b82f6,#6366f1)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:16,flexShrink:0}}>{f.nome[0]}</div>
                <div><div style={{color:'#1e293b',fontWeight:700}}>{f.nome}</div><div style={{color:'#64748b',fontSize:12}}>ID: {f.id}</div></div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                <Bdg color={f.ativo?'green':'gray'}>{f.ativo?'Ativo':'Inativo'}</Bdg>
                <Btn small variant="ghost" onClick={()=>setHistF(f)}>📋 Histórico</Btn>
                {podeEditar&&<Btn small variant="ghost" onClick={()=>abrir(f)}>Editar</Btn>}
                {podeEditar&&<Btn small variant="danger" onClick={()=>remover(f.id)}>Remover</Btn>}
              </div>
            </div>
          ))}
        </div>
      )}
      {histF && <HistoricoModal func={histF} entregas={entregas} devolucoes={devolucoes} onClose={()=>setHistF(null)}/>}
      {modal && (
        <Modal title={editId?'Editar Funcionário':'Novo Funcionário'} onClose={()=>setModal(false)}>
          <Inp label="ID Funcionário"   value={form.id}   onChange={e=>setForm({...form,id:e.target.value})}   disabled={!!editId}/>
          <Inp label="Nome" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/>
          <Sel label="Status" value={form.ativo?'true':'false'} onChange={v=>setForm({...form,ativo:v==='true'})} options={[{value:'true',label:'Ativo'},{value:'false',label:'Inativo'}]}/>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={loading}>{loading?'Salvando...':editId?'Salvar':'Cadastrar'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

function HistoricoModal({ func, entregas, devolucoes, onClose }) {
  const [aba,setAba] = useState('posse')
  const hist = useMemo(()=>[...entregas.filter(e=>e.funcId===func.id).map(e=>({...e,tipo:'ent'})),...devolucoes.filter(d=>d.funcId===func.id).map(d=>({...d,tipo:'dev'}))].sort((a,b)=>b.id-a.id),[entregas,devolucoes,func])
  const posse = useMemo(()=>calcPosse(func.id,entregas,devolucoes),[entregas,devolucoes,func])
  return (
    <Modal title={`👷 ${func.nome}`} onClose={onClose}>
      <div style={{display:'flex',gap:8,marginBottom:20}}>
        {[{id:'posse',l:`Em posse (${posse.length})`},{id:'hist',l:`Histórico (${hist.length})`}].map(a=>(
          <button key={a.id} onClick={()=>setAba(a.id)} style={{flex:1,padding:'8px 0',borderRadius:8,border:'none',background:aba===a.id?'#1e3a5f':'#f1f5f9',color:aba===a.id?'#fff':'#64748b',fontWeight:600,fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>{a.l}</button>
        ))}
      </div>
      {aba==='posse'&&(posse.length===0?<Empty msg="Nenhum EPI em posse."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {posse.map(p=>(<div key={p.epiId} style={{background:'#f8fafc',borderRadius:8,padding:'10px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}><span style={{color:'#f1f5f9',fontSize:13,fontWeight:600}}>{p.epiDesc}</span><span style={{background:'#dbeafe',color:'#1e40af',borderRadius:999,padding:'2px 10px',fontSize:12,fontWeight:700}}>{p.qtd} un.</span></div>))}
        </div>
      )}
      {aba==='hist'&&(hist.length===0?<Empty msg="Nenhuma movimentação."/>:
        <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:340,overflowY:'auto'}}>
          {hist.map(h=>(<div key={h.id+h.tipo} style={{background:'#f8fafc',borderRadius:8,padding:'10px 14px',display:'flex',gap:12,alignItems:'flex-start'}}><span style={{fontSize:16}}>{h.tipo==='ent'?'📤':'📥'}</span><div style={{flex:1}}><div style={{color:'#f1f5f9',fontSize:13,fontWeight:600}}>{h.epiDesc} — {h.quantidade} un.</div><div style={{color:'#64748b',fontSize:11,marginTop:2}}>{fmtDate(h.data)} · {h.motivo}</div></div><span style={{background:h.tipo==='ent'?'#dbeafe':'#d1fae5',color:h.tipo==='ent'?'#1e40af':'#065f46',borderRadius:999,padding:'2px 8px',fontSize:11,fontWeight:700,whiteSpace:'nowrap'}}>{h.tipo==='ent'?'Entrega':'Devolução'}</span></div>))}
        </div>
      )}
    </Modal>
  )
}

// ─── ESTOQUE ──────────────────────────────────────────────────────────────────
function EstoqueEPIs({ epis, setEpis, toast }) {
  const [modal,setModal] = useState(false)
  const [repModal,setRepModal] = useState(false)
  const [form,setForm] = useState({id:'',descricao:'',fabricante:'',ca:'',validade:'',quantidade:0,minimo:1,pesoG:0})
  const [editId,setEditId] = useState(null)
  const [ordemEpi,setOrdemEpi] = useState('cadastro')
  const episOrdenados = useMemo(()=>{
    const l=[...epis]
    if(ordemEpi==='alfa') l.sort((a,b)=>a.descricao.localeCompare(b.descricao))
    if(ordemEpi==='qtd') l.sort((a,b)=>a.quantidade-b.quantidade)
    return l
  },[epis,ordemEpi])
  const [loading,setLoading] = useState(false)
  const sf = v => setForm(p=>({...p,...v}))

  const abrir = (e=null) => { setForm(e?{...e}:{id:'',descricao:'',fabricante:'',ca:'',validade:'',quantidade:0,minimo:1,pesoG:0}); setEditId(e?e.id:null); setModal(true) }
  const salvar = async () => {
    if(!form.id||!form.descricao) return alert('Preencha ID e Descrição.')
    if(!editId && epis.find(e=>e.id===form.id)) return alert('ID já existe.')
    setLoading(true)
    try {
      await upsertEpi(form)
      const item = {...form,quantidade:Number(form.quantidade),minimo:Number(form.minimo),pesoG:Number(form.pesoG)}
      if(editId) setEpis(p=>p.map(e=>e.id===editId?item:e))
      else       setEpis(p=>[...p,item])
      toast(editId?'EPI atualizado!':'EPI cadastrado!')
      setModal(false)
    } catch(e) { toast('Erro: '+e.message,'error') }
    finally { setLoading(false) }
  }
  const remover = async (id) => {
    if(!confirm('Remover EPI?')) return
    try { await deleteEpi(id); setEpis(p=>p.filter(e=>e.id!==id)); toast('Removido.','info') }
    catch(e) { toast('Erro ao remover: '+e.message,'error') }
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <h2 style={S.title}>🦺 Estoque de EPIs</h2>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select value={ordemEpi} onChange={e=>setOrdemEpi(e.target.value)} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'7px 12px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="cadastro">Ordem de cadastro</option>
            <option value="alfa">Ordem alfabética</option>
            <option value="qtd">Por quantidade</option>
          </select>
          <Btn variant="success" onClick={()=>setRepModal(true)}>📦 Repor Estoque</Btn>
          <Btn onClick={()=>abrir()}>+ Novo EPI</Btn>
        </div>
      </div>
      {!epis.length?<Empty msg="Nenhum EPI cadastrado."/>:(
        <div style={{display:'grid',gap:10}}>
          {episOrdenados.map(e=>{
            const baixo=e.quantidade<=e.minimo,d=diasVenc(e.validade),venc=d<0,em30=d<=30
            return (
              <div key={e.id} style={{...S.card,borderColor:venc?'#991b1b':baixo?'#1d4ed8':'#cbd5e1'}}>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,flexWrap:'wrap'}}>
                    <span style={{color:'#1e293b',fontWeight:700,fontSize:15}}>{e.descricao}</span>
                    {baixo&&<Bdg color="blue">Estoque baixo</Bdg>}
                    {venc&&<Bdg color="red">Vencido</Bdg>}
                    {!venc&&em30&&<Bdg color="yellow">Vence em breve</Bdg>}
                  </div>
                  <div style={{display:'flex',gap:20,flexWrap:'wrap'}}>
                    <Kv k="ID" v={e.id}/><Kv k="Fabricante" v={e.fabricante}/><Kv k="CA" v={e.ca}/>
                    <Kv k="Validade" v={fmtDate(e.validade)}/><Kv k="Estoque" v={`${e.quantidade} un.`} hi={baixo}/>
                    <Kv k="Mínimo" v={`${e.minimo} un.`}/><Kv k="Peso" v={e.pesoG?`${e.pesoG}g`:'—'}/>
                  </div>
                </div>
                {podeEditar&&<div style={{display:'flex',gap:8,flexShrink:0}}>
                  <Btn small variant="ghost" onClick={()=>abrir(e)}>Editar</Btn>
                  <Btn small variant="danger" onClick={()=>remover(e.id)}>Remover</Btn>
                </div>}
              </div>
            )
          })}
        </div>
      )}
      {repModal && <ReposicaoModal epis={epis} setEpis={setEpis} onClose={()=>setRepModal(false)} toast={toast}/>}
      {modal && (
        <Modal title={editId?'Editar EPI':'Novo EPI'} onClose={()=>setModal(false)}>
          <Inp label="ID EPI"         value={form.id}         onChange={e=>sf({id:e.target.value})}         disabled={!!editId}/>
          <Inp label="Descrição"  value={form.descricao}  onChange={e=>sf({descricao:e.target.value})}/>
          <Inp label="Fabricante" value={form.fabricante} onChange={e=>sf({fabricante:e.target.value})}/>
          <Inp label="CA"         value={form.ca}         onChange={e=>sf({ca:e.target.value})}/>
          <Inp label="Validade"   type="date" value={form.validade} onChange={e=>sf({validade:e.target.value})}/>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
            <Inp label="Estoque"  type="number" value={form.quantidade} onChange={e=>sf({quantidade:e.target.value})}/>
            <Inp label="Mínimo"   type="number" value={form.minimo}    onChange={e=>sf({minimo:e.target.value})}/>
            <Inp label="Peso (g)" type="number" value={form.pesoG}     onChange={e=>sf({pesoG:e.target.value})}/>
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
            <Btn onClick={salvar} disabled={loading}>{loading?'Salvando...':editId?'Salvar':'Cadastrar'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

function ReposicaoModal({ epis, setEpis, onClose, toast }) {
  const [epiId,setEpiId] = useState('')
  const [qtd,setQtd] = useState(1)
  const [val,setVal] = useState('')
  const [loading,setLoading] = useState(false)
  const epiSel = epis.find(e=>e.id===epiId)
  const salvar = async () => {
    if(!epiSel) return alert('Selecione um EPI.')
    if(Number(qtd)<=0) return alert('Quantidade inválida.')
    setLoading(true)
    try {
      const novaQtd = epiSel.quantidade + Number(qtd)
      const novaVal = val || epiSel.validade
      await updateQuantidadeEpi(epiId, novaQtd, val||null)
      setEpis(p=>p.map(e=>e.id===epiId?{...e,quantidade:novaQtd,validade:novaVal}:e))
      toast('Estoque reposto!'); onClose()
    } catch(e) { toast('Erro: '+e.message,'error') }
    finally { setLoading(false) }
  }
  return (
    <Modal title="📦 Repor Estoque" onClose={onClose}>
      <Sel label="EPI" value={epiId} onChange={setEpiId} options={epis.map(e=>({value:e.id,label:`${e.descricao} — ${e.quantidade} em estoque`}))}/>
      {epiSel && <div style={{background:'#f1f5f9',borderRadius:8,padding:'10px 14px',marginBottom:16,display:'flex',gap:16,flexWrap:'wrap',border:'1px solid #e2e8f0'}}><Kv k="Atual" v={`${epiSel.quantidade} un.`} hi={epiSel.quantidade<=epiSel.minimo}/><Kv k="Mínimo" v={`${epiSel.minimo} un.`}/><Kv k="Validade" v={fmtDate(epiSel.validade)}/></div>}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
        <Inp label="Qtd a repor" type="number" min="1" value={qtd} onChange={e=>setQtd(e.target.value)}/>
        <Inp label="Validade do lote (opcional)" type="date" value={val} onChange={e=>setVal(e.target.value)}/>
      </div>
      <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
        <Btn variant="ghost" onClick={onClose}>Cancelar</Btn>
        <Btn variant="success" onClick={salvar} disabled={loading}>{loading?'Salvando...':'Confirmar'}</Btn>
      </div>
    </Modal>
  )
}

// ─── ENTREGAS ─────────────────────────────────────────────────────────────────
function Entregas({ entregas, setEntregas, funcionarios, epis, setEpis, toast }) {
  const [modal,setModal] = useState(false)
  const [form,setForm] = useState({funcId:'',data:hoje(),epiId:'',quantidade:1,motivo:''})
  const [loading,setLoading] = useState(false)
  const [filtFuncEnt,setFiltFuncEnt] = useState('todos')
  const entregasFiltradas = useMemo(()=>filtFuncEnt==='todos'?entregas:entregas.filter(e=>e.funcId===filtFuncEnt),[entregas,filtFuncEnt])
  const {paged,pg,setPg,total} = usePag(entregasFiltradas)
  const ativos = funcionarios.filter(f=>f.ativo)

  const salvar = async () => {
    const func = funcionarios.find(f=>f.id===form.funcId)
    const epi  = epis.find(e=>e.id===form.epiId)
    if(!func||!epi) return alert('Selecione funcionário e EPI.')
    const qtd = Number(form.quantidade)
    if(qtd<=0) return alert('Quantidade inválida.')
    if(qtd>epi.quantidade) return alert(`Estoque insuficiente. Disponível: ${epi.quantidade}`)
    if(!form.motivo) return alert('Selecione o motivo.')
    setLoading(true)
    try {
      const novaEnt = await insertEntrega({funcId:func.id,funcNome:func.nome,epiId:epi.id,epiDesc:epi.descricao,data:form.data,quantidade:qtd,motivo:form.motivo})
      const novaQtd = epi.quantidade - qtd
      await updateQuantidadeEpi(epi.id, novaQtd)
      setEntregas(p=>[novaEnt,...p])
      setEpis(p=>p.map(e=>e.id===epi.id?{...e,quantidade:novaQtd}:e))
      toast('Entrega registrada!')
      setModal(false); setForm({funcId:'',data:hoje(),epiId:'',quantidade:1,motivo:''})
    } catch(e) { toast('Erro: '+e.message,'error') }
    finally { setLoading(false) }
  }

  const cancelarEntrega = async (e) => {
    if(!confirm(`Cancelar entrega de ${e.quantidade} un. de "${e.epiDesc}" para ${e.funcNome}?\nO estoque será restaurado.`)) return
    try {
      await deleteEntrega(e.id)
      await updateQuantidadeEpi(e.epiId, epis.find(ep=>ep.id===e.epiId)?.quantidade + e.quantidade)
      setEntregas(p=>p.filter(en=>en.id!==e.id))
      setEpis(p=>p.map(ep=>ep.id===e.epiId?{...ep,quantidade:ep.quantidade+e.quantidade}:ep))
      toast('Entrega cancelada e estoque restaurado!','info')
    } catch(err) { toast('Erro: '+err.message,'error') }
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={S.title}>📤 Entregas</h2>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select value={filtFuncEnt} onChange={e=>setFiltFuncEnt(e.target.value)} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'7px 12px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="todos">Todos funcionários</option>
            {funcionarios.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          {podeEditar&&<Btn onClick={()=>setModal(true)}>+ Registrar Entrega</Btn>}
        </div>
      </div>
      {!entregas.length?<Empty msg="Nenhuma entrega registrada."/>:(
        <>
          <div style={{color:'#64748b',fontSize:12,marginBottom:8}}>{entregas.length} registro(s)</div>
          <div style={{display:'grid',gap:10}}>
            {paged.map(e=>(<div key={e.id} style={S.card}><div style={{flex:1}}><div style={{display:'flex',gap:20,flexWrap:'wrap'}}><Kv k="Funcionário" v={`${e.funcNome} (${e.funcId})`}/><Kv k="Data" v={fmtDate(e.data)}/><Kv k="EPI" v={e.epiDesc}/><Kv k="Qtd" v={`${e.quantidade} un.`}/><Kv k="Motivo" v={e.motivo}/></div></div><div style={{display:'flex',gap:8,alignItems:'center'}}><Bdg color="blue">Entrega</Bdg>{podeEditar&&<button onClick={()=>cancelarEntrega(e)} style={{background:'#450a0a',border:'1px solid #991b1b',borderRadius:6,color:'#fca5a5',fontSize:11,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>✕ Cancelar</button>}</div></div>))}
          </div>
          <Pager pg={pg} total={total} setPg={setPg}/>
        </>
      )}
      {modal && (
        <Modal title="Registrar Entrega" onClose={()=>setModal(false)}>
          <Sel label="Funcionário" value={form.funcId} onChange={v=>setForm(p=>({...p,funcId:v}))} options={ativos.map(f=>({value:f.id,label:`${f.nome} (${f.id})`}))}/>
          <Inp label="Data" type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))}/>
          <Sel label="EPI" value={form.epiId} onChange={v=>setForm(p=>({...p,epiId:v}))} options={epis.map(e=>({value:e.id,label:`${e.descricao} — ${e.quantidade} em estoque`}))}/>
          <Inp label="Quantidade" type="number" min="1" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))}/>
          <Sel label="Motivo" value={form.motivo} onChange={v=>setForm(p=>({...p,motivo:v}))} options={MOTIVOS_ENTREGA.map(m=>({value:m,label:m}))}/>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
            <Btn variant="success" onClick={salvar} disabled={loading}>{loading?'Salvando...':'Confirmar Entrega'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── DEVOLUÇÕES ───────────────────────────────────────────────────────────────
function Devolucoes({ devolucoes, setDevolucoes, funcionarios, epis, setEpis, toast }) {
  const [modal,setModal] = useState(false)
  const [form,setForm] = useState({funcId:'',data:hoje(),epiId:'',quantidade:1,motivo:''})
  const [loading,setLoading] = useState(false)
  const [filtFuncDev,setFiltFuncDev] = useState('todos')
  const devolucoesFiltradas = useMemo(()=>filtFuncDev==='todos'?devolucoes:devolucoes.filter(d=>d.funcId===filtFuncDev),[devolucoes,filtFuncDev])
  const {paged,pg,setPg,total} = usePag(devolucoesFiltradas)

  const salvar = async () => {
    const func = funcionarios.find(f=>f.id===form.funcId)
    const epi  = epis.find(e=>e.id===form.epiId)
    if(!func||!epi) return alert('Selecione funcionário e EPI.')
    const qtd = Number(form.quantidade)
    if(qtd<=0) return alert('Quantidade inválida.')
    if(!form.motivo) return alert('Selecione o motivo.')
    setLoading(true)
    try {
      const novaDev = await insertDevolucao({funcId:func.id,funcNome:func.nome,epiId:epi.id,epiDesc:epi.descricao,data:form.data,quantidade:qtd,motivo:form.motivo})
      const novaQtd = epi.quantidade + qtd
      await updateQuantidadeEpi(epi.id, novaQtd)
      setDevolucoes(p=>[novaDev,...p])
      setEpis(p=>p.map(e=>e.id===epi.id?{...e,quantidade:novaQtd}:e))
      toast('Devolução registrada!')
      setModal(false); setForm({funcId:'',data:hoje(),epiId:'',quantidade:1,motivo:''})
    } catch(e) { toast('Erro: '+e.message,'error') }
    finally { setLoading(false) }
  }

  const cancelarDevolucao = async (d) => {
    if(!confirm(`Cancelar devolução de ${d.quantidade} un. de "${d.epiDesc}" de ${d.funcNome}?\nO estoque será ajustado.`)) return
    try {
      await deleteDevolucao(d.id)
      const epiAtual = epis.find(ep=>ep.id===d.epiId)
      await updateQuantidadeEpi(d.epiId, Math.max(0, (epiAtual?.quantidade||0) - d.quantidade))
      setDevolucoes(p=>p.filter(dv=>dv.id!==d.id))
      setEpis(p=>p.map(ep=>ep.id===d.epiId?{...ep,quantidade:Math.max(0,ep.quantidade-d.quantidade)}:ep))
      toast('Devolução cancelada!','info')
    } catch(err) { toast('Erro: '+err.message,'error') }
  }

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={S.title}>📥 Devoluções</h2>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select value={filtFuncDev} onChange={e=>setFiltFuncDev(e.target.value)} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'7px 12px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="todos">Todos funcionários</option>
            {funcionarios.map(f=><option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
          {podeEditar&&<Btn onClick={()=>setModal(true)}>+ Registrar Devolução</Btn>}
        </div>
      </div>
      {!devolucoes.length?<Empty msg="Nenhuma devolução registrada."/>:(
        <>
          <div style={{color:'#64748b',fontSize:12,marginBottom:8}}>{devolucoes.length} registro(s)</div>
          <div style={{display:'grid',gap:10}}>
            {paged.map(d=>(<div key={d.id} style={S.card}><div style={{flex:1}}><div style={{display:'flex',gap:20,flexWrap:'wrap'}}><Kv k="Funcionário" v={`${d.funcNome} (${d.funcId})`}/><Kv k="Data" v={fmtDate(d.data)}/><Kv k="EPI" v={d.epiDesc}/><Kv k="Qtd" v={`${d.quantidade} un.`}/><Kv k="Motivo" v={d.motivo}/></div></div><div style={{display:'flex',gap:8,alignItems:'center'}}><Bdg color="green">Devolução</Bdg>{podeEditar&&<button onClick={()=>cancelarDevolucao(d)} style={{background:'#450a0a',border:'1px solid #991b1b',borderRadius:6,color:'#fca5a5',fontSize:11,padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>✕ Cancelar</button>}</div></div>))}
          </div>
          <Pager pg={pg} total={total} setPg={setPg}/>
        </>
      )}
      {modal && (
        <Modal title="Registrar Devolução" onClose={()=>setModal(false)}>
          <Sel label="Funcionário" value={form.funcId} onChange={v=>setForm(p=>({...p,funcId:v}))} options={funcionarios.map(f=>({value:f.id,label:`${f.nome} (${f.id})`}))}/>
          <Inp label="Data" type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))}/>
          <Sel label="EPI" value={form.epiId} onChange={v=>setForm(p=>({...p,epiId:v}))} options={epis.map(e=>({value:e.id,label:e.descricao}))}/>
          <Inp label="Quantidade" type="number" min="1" value={form.quantidade} onChange={e=>setForm(p=>({...p,quantidade:e.target.value}))}/>
          <Sel label="Motivo" value={form.motivo} onChange={v=>setForm(p=>({...p,motivo:v}))} options={MOTIVOS_DEVOLUCAO.map(m=>({value:m,label:m}))}/>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end',marginTop:8}}>
            <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
            <Btn variant="success" onClick={salvar} disabled={loading}>{loading?'Salvando...':'Confirmar Devolução'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── ALERTAS ──────────────────────────────────────────────────────────────────
function PainelAlertas({ epis }) {
  const [filtroAlerta,setFiltroAlerta] = useState('todos')
  const todosAlertas = gerarAlertas(epis)
  const alertas = filtroAlerta==='todos' ? todosAlertas : todosAlertas.filter(a=>a.tipo===filtroAlerta)
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20,flexWrap:'wrap',gap:10}}>
        <h2 style={S.title}>🚨 Painel de Alertas</h2>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <select value={filtroAlerta} onChange={e=>setFiltroAlerta(e.target.value)} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'7px 12px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="todos">Todos ({todosAlertas.length})</option>
            <option value="estoque">Estoque ({todosAlertas.filter(a=>a.tipo==='estoque').length})</option>
            <option value="validade">Validade ({todosAlertas.filter(a=>a.tipo==='validade').length})</option>
          </select>
        </div>
      </div>
      {!alertas.length ? (
        <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:14,padding:24,textAlign:'center'}}>
          <div style={{fontSize:32,marginBottom:8}}>✅</div>
          <div style={{color:'#166534',fontWeight:600}}>Tudo certo! Sem alertas ativos.</div>
        </div>
      ) : (
        <div style={{display:'grid',gap:12}}>
          {alertas.map(a=>(
            <div key={a.id} style={{background:a.vencido?'#450a0a':a.tipo==='estoque'?'#172554':'#422006',border:`1px solid ${a.vencido?'#b91c1c':a.tipo==='estoque'?'#2563eb':'#b45309'}`,borderRadius:12,padding:'16px 20px',display:'flex',alignItems:'center',gap:14}}>
              <span style={{fontSize:26}}>{a.tipo==='estoque'?'📦':'📅'}</span>
              <div style={{flex:1}}><div style={{color:'#f1f5f9',fontWeight:700,fontSize:15}}>{a.epi}</div><div style={{color:'#cbd5e1',fontSize:13,marginTop:2}}>{a.msg}</div></div>
              <Bdg color={a.vencido?'red':a.tipo==='estoque'?'blue':'yellow'}>{a.tipo==='estoque'?'Estoque':'Validade'}</Bdg>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── AMBIENTAL ────────────────────────────────────────────────────────────────
function PainelAmbiental({ entregas, devolucoes, epis }) {
  const ano = new Date().getFullYear()
  const [dIni,setDIni] = useState(`${ano}-01-01`)
  const [dFim,setDFim] = useState(hoje())
  const G = S.grn
  const res = useMemo(()=>calcResiduos(entregas,devolucoes,epis).filter(r=>r.data>=dIni&&r.data<=dFim),[entregas,devolucoes,epis,dIni,dFim])
  const totalUn = res.reduce((s,r)=>s+r.quantidade,0)
  const totalKg = (res.reduce((s,r)=>s+(r.pesoG*r.quantidade),0)/1000).toFixed(2)
  const porEpi = useMemo(()=>{const m={};res.forEach(r=>{m[r.epiDesc]=m[r.epiDesc]||{epi:r.epiDesc,un:0,kg:0};m[r.epiDesc].un+=r.quantidade;m[r.epiDesc].kg+=(r.pesoG*r.quantidade)/1000});return Object.values(m).sort((a,b)=>b.kg-a.kg).map(r=>({...r,kg:parseFloat(r.kg.toFixed(3)),epiS:r.epi.length>18?r.epi.slice(0,17)+'…':r.epi}))},[res])
  const porMes = useMemo(()=>{const m={};res.forEach(r=>{const k=r.data.slice(0,7);m[k]=m[k]||{mes:k.slice(5)+'/'+k.slice(2,4),kg:0};m[k].kg+=(r.pesoG*r.quantidade)/1000});return Object.values(m).sort((a,b)=>a.mes.localeCompare(b.mes)).map(r=>({...r,kg:parseFloat(r.kg.toFixed(3))}))},[res])
  const porOrigem = useMemo(()=>{const m={};res.forEach(r=>{m[r.origem]=(m[r.origem]||0)+r.quantidade});return Object.entries(m).map(([origem,value])=>({origem,value}))},[res])
  return (
    <div>
      <div style={{marginBottom:8}}><h2 style={S.title}>🌱 Painel Ambiental</h2><p style={{color:'#64748b',fontSize:13,marginTop:4}}>Rastreamento de resíduos gerados por descarte de EPIs</p></div>
      <div style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:14,padding:'14px 20px',marginBottom:24,display:'flex',flexWrap:'wrap',gap:16,alignItems:'flex-end',boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
        <FDate label="De" value={dIni} onChange={setDIni}/><FDate label="Até" value={dFim} onChange={setDFim}/>
        <button onClick={()=>{setDIni(`${ano}-01-01`);setDFim(hoje())}} style={{background:'transparent',border:'1px solid #334155',borderRadius:8,color:'#94a3b8',fontSize:12,padding:'7px 14px',cursor:'pointer',fontFamily:'inherit',alignSelf:'flex-end'}}>↺ Limpar</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:14,marginBottom:24}}>
        {[{l:'EPIs descartados',v:totalUn+' un.',i:'🗑️',c:'#f59e0b',s:'no período'},{l:'Peso total',v:totalKg+' kg',i:'⚖️',c:'#10b981',s:`${(Number(totalKg)*1000).toLocaleString('pt-BR')} g`},{l:'Tipos de EPI',v:porEpi.length,i:'🦺',c:'#6366f1',s:'com descarte'}].map(k=>(
          <div key={k.l} style={{background:'#ffffff',borderRadius:14,padding:'18px 20px',border:'1px solid #cbd5e1',borderTop:`3px solid ${k.c}`,boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
            <div style={{fontSize:24,marginBottom:6}}>{k.i}</div><div style={{color:k.c,fontSize:26,fontWeight:800}}>{k.v}</div>
            <div style={{color:'#f1f5f9',fontSize:13,fontWeight:600,marginTop:2}}>{k.l}</div><div style={{color:'#64748b',fontSize:11,marginTop:2}}>{k.s}</div>
          </div>
        ))}
      </div>
      {totalUn===0?(
        <div style={{background:'#f0fdf4',border:'1px solid #86efac',borderRadius:14,padding:32,textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:10}}>🌿</div>
          <div style={{color:'#166534',fontWeight:700,fontSize:16}}>Nenhum resíduo no período</div>
          <div style={{color:'#16a34a',fontSize:13,marginTop:6}}>Resíduos surgem de devoluções por dano/vencimento/desligamento e entregas com motivo Perda.</div>
        </div>
      ):(
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
          <ChartCard title="⚖️ Peso por EPI (kg)" span2>
            <ResponsiveContainer width="100%" height={220}><BarChart data={porEpi} layout="vertical" margin={{top:0,right:24,left:8,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false}/><XAxis type="number" tick={S.ax} unit=" kg"/><YAxis dataKey="epiS" type="category" tick={S.ax} width={100}/><Tooltip contentStyle={S.tt} formatter={v=>[v+' kg','Peso']}/><Bar dataKey="kg" name="Peso (kg)" radius={[0,6,6,0]}>{porEpi.map((_,i)=><Cell key={i} fill={G[i%G.length]}/>)}</Bar></BarChart></ResponsiveContainer>
          </ChartCard>
          <ChartCard title="📈 Evolução mensal (kg)">
            {porMes.length===0?<Empty msg="Sem dados."/>:<ResponsiveContainer width="100%" height={220}><LineChart data={porMes} margin={{top:4,right:16,left:-10,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0"/><XAxis dataKey="mes" tick={S.ax}/><YAxis tick={S.ax}/><Tooltip contentStyle={S.tt} formatter={v=>[v+' kg','Peso']}/><Line type="monotone" dataKey="kg" stroke="#10b981" strokeWidth={2.5} dot={{fill:'#10b981',r:4}}/></LineChart></ResponsiveContainer>}
          </ChartCard>
          <ChartCard title="🗑️ Origem dos descartes">
            {porOrigem.length===0?<Empty msg="Sem dados."/>:<div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:28,flexWrap:'wrap'}}><PieChart width={200} height={200}><Pie data={porOrigem} dataKey="value" nameKey="origem" cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={3}>{porOrigem.map((_,i)=><Cell key={i} fill={G[i%G.length]}/>)}</Pie><Tooltip contentStyle={S.tt} formatter={(v,n)=>[v+' un.',n]}/></PieChart><div style={{display:'flex',flexDirection:'column',gap:10}}>{porOrigem.map((d,i)=>(<div key={d.origem} style={{display:'flex',alignItems:'center',gap:10}}><div style={{width:12,height:12,borderRadius:3,background:G[i%G.length]}}/><div><div style={{color:'#f1f5f9',fontSize:13,fontWeight:600}}>{d.origem}</div><div style={{color:'#64748b',fontSize:12}}>{d.value} un.</div></div></div>))}</div></div>}
          </ChartCard>
          <ChartCard title="📋 Detalhamento">
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
              <thead><tr>{['EPI','Un.','Peso un.','Total'].map(h=><th key={h} style={{color:'#64748b',fontWeight:600,textAlign:'left',padding:'6px 10px',borderBottom:'1px solid #334155',fontSize:11,textTransform:'uppercase'}}>{h}</th>)}</tr></thead>
              <tbody>{porEpi.map((r,i)=>(<tr key={r.epi} style={{borderBottom:'1px solid #0f172a'}}><td style={{color:'#1e293b',padding:'8px 10px',fontWeight:500}}>{r.epi}</td><td style={{color:'#475569',padding:'8px 10px'}}>{r.un} un.</td><td style={{color:'#64748b',padding:'8px 10px'}}>{epis.find(e=>e.descricao===r.epi)?.pesoG??0}g</td><td style={{padding:'8px 10px'}}><span style={{color:G[i%G.length],fontWeight:700}}>{r.kg} kg</span></td></tr>))}</tbody>
              <tfoot><tr style={{borderTop:'1px solid #334155'}}><td style={{color:'#64748b',padding:'8px 10px',fontWeight:700}} colSpan={2}>Total — {totalUn} un.</td><td/><td style={{color:'#10b981',padding:'8px 10px',fontWeight:800}}>{totalKg} kg</td></tr></tfoot>
            </table>
          </ChartCard>
        </div>
      )}
    </div>
  )
}

// ─── RODAPÉ ───────────────────────────────────────────────────────────────────
function Rodape({ dados, onPDF }) {
  const exportJSON = () => {
    const json = JSON.stringify({...dados,exportadoEm:new Date().toISOString()},null,2)
    const uri = 'data:application/json;charset=utf-8,'+encodeURIComponent(json)
    const a = document.createElement('a'); a.href=uri; a.download=`epi-control-${hoje()}.json`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
  }
  return (
    <div style={{background:'#1e3a5f',borderTop:'1px solid #1a3352',padding:'8px 24px',flexShrink:0}}>
      <div style={{maxWidth:1100,margin:'0 auto',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:8}}>
        <div style={{display:'flex',alignItems:'center',gap:6}}>
          <span style={{width:8,height:8,borderRadius:'50%',background:'#10b981',display:'inline-block'}}/>
          <span style={{color:'rgba(255,255,255,.6)',fontSize:12}}>Conectado ao Supabase · dados salvos em tempo real</span>
        </div>
        <div style={{display:'flex',gap:8}}>
          <Btn small variant="ghost" onClick={exportJSON}>⬇️ Exportar JSON</Btn>
          <Btn small variant="warn"  onClick={onPDF}>🖨️ Gerar PDF</Btn>
        </div>
      </div>
    </div>
  )
}


// ─── LOGIN ────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email,setEmail] = useState('')
  const [senha,setSenha] = useState('')
  const [loading,setLoading] = useState(false)
  const [erro,setErro] = useState('')

  const handleLogin = async () => {
    if(!email||!senha) return setErro('Preencha email e senha.')
    setLoading(true); setErro('')
    try { await onLogin(email, senha) }
    catch(e) { setErro('Email ou senha incorretos.') }
    finally { setLoading(false) }
  }

  return (
    <div style={{minHeight:'100vh',background:'#f0f4f8',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'DM Sans',sans-serif"}}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
      <div style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:20,padding:40,width:'90%',maxWidth:400,boxShadow:'0 8px 32px rgba(0,0,0,.1)'}}>
        <div style={{textAlign:'center',marginBottom:32}}>
          <img src="https://static.wixstatic.com/media/7ee4fb_ea01331caac7470bb01de1c91f704451~mv2.png/v1/crop/x_37,y_184,w_934,h_511/fill/w_511,h_278,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Logo%20GR%20-%20Fundo%20tranparente.png"
            alt="Guindastes Ribas" style={{height:60,marginBottom:12,filter:'brightness(0) saturate(100%) invert(14%) sepia(57%) saturate(600%) hue-rotate(190deg)'}}/>
          <div style={{fontSize:22,fontWeight:800,fontFamily:"'Sora',sans-serif",color:'#1e3a5f'}}>EPI Control</div>
          <div style={{color:'#64748b',fontSize:13,marginTop:4}}>Guindastes Ribas — Acesso restrito</div>
        </div>
        <div style={{marginBottom:16}}>
          <label style={{display:'block',color:'#64748b',fontSize:12,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:.8}}>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleLogin()}
            placeholder="seu@email.com"
            style={{width:'100%',background:'#f8fafc',border:'1px solid #cbd5e1',borderRadius:8,padding:'11px 14px',color:'#1e293b',fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
        </div>
        <div style={{marginBottom:24}}>
          <label style={{display:'block',color:'#64748b',fontSize:12,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:.8}}>Senha</label>
          <input type="password" value={senha} onChange={e=>setSenha(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&handleLogin()}
            placeholder="••••••••"
            style={{width:'100%',background:'#f8fafc',border:'1px solid #cbd5e1',borderRadius:8,padding:'11px 14px',color:'#1e293b',fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}/>
        </div>
        {erro&&<div style={{background:'#fee2e2',border:'1px solid #fca5a5',borderRadius:8,padding:'10px 14px',color:'#991b1b',fontSize:13,marginBottom:16}}>{erro}</div>}
        <button onClick={handleLogin} disabled={loading}
          style={{width:'100%',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',border:'none',borderRadius:8,padding:'12px',color:'#fff',fontSize:15,fontWeight:700,cursor:loading?'not-allowed':'pointer',fontFamily:'inherit',opacity:loading?.7:1}}>
          {loading?'Entrando...':'Entrar'}
        </button>
      </div>
    </div>
  )
}

// ─── GESTÃO DE USUÁRIOS ───────────────────────────────────────────────────────
function GestaoUsuarios({ toast }) {
  const [usuarios,setUsuarios] = useState([])
  const [loading,setLoading] = useState(true)
  const [modal,setModal] = useState(false)
  const [form,setForm] = useState({email:'',senha:'',nome:'',perfil:'editor'})
  const [salvando,setSalvando] = useState(false)

  useEffect(()=>{
    getUsuarios().then(setUsuarios).catch(()=>{}).finally(()=>setLoading(false))
  },[])

  const criarViaInvite = async () => {
    if(!form.email||!form.nome||!form.perfil) return alert('Preencha todos os campos.')
    setSalvando(true)
    try {
      // Use signUp for new users (they receive a confirmation email)
      const { supabase: sb } = await import('./supabase')
      // We'll create via admin invite approach using supabase directly
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ email: form.email, password: form.senha||'Temp@1234', email_confirm: true })
      })
      const userData = await response.json()
      if(userData.error) throw new Error(userData.error.message||userData.msg||'Erro ao criar usuário')
      
      // Insert profile
      const { createClient } = await import('@supabase/supabase-js')
      const client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY)
      await client.from('perfis').insert({ id: userData.id, nome: form.nome, email: form.email, perfil: form.perfil })
      
      toast('Usuário criado! Senha temporária: Temp@1234 (oriente a trocar)','info')
      setUsuarios(p=>[...p,{id:userData.id,nome:form.nome,email:form.email,perfil:form.perfil}])
      setModal(false)
      setForm({email:'',senha:'',nome:'',perfil:'editor'})
    } catch(e) {
      toast('Erro: '+e.message,'error')
    }
    setSalvando(false)
  }

  const alterarPerfil = async (id, novoPerfil) => {
    try {
      await atualizarPerfil(id, usuarios.find(u=>u.id===id)?.nome, novoPerfil)
      setUsuarios(p=>p.map(u=>u.id===id?{...u,perfil:novoPerfil}:u))
      toast('Perfil atualizado!')
    } catch(e) { toast('Erro: '+e.message,'error') }
  }

  const remover = async (id) => {
    if(!confirm('Remover usuário?')) return
    try {
      await deletarUsuario(id)
      setUsuarios(p=>p.filter(u=>u.id!==id))
      toast('Usuário removido.','info')
    } catch(e) { toast('Erro: '+e.message,'error') }
  }

  const perfilBadge = (p) => ({
    admin:  {bg:'#fef3c7',color:'#92400e',label:'Admin'},
    editor: {bg:'#dbeafe',color:'#1e40af',label:'Editor'},
    leitor: {bg:'#f3f4f6',color:'#4b5563',label:'Leitor'},
  }[p]||{bg:'#f3f4f6',color:'#4b5563',label:p}

  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:20}}>
        <h2 style={{color:'#1e293b',fontSize:20,fontWeight:700,fontFamily:"'Sora',sans-serif"}}>👥 Gestão de Usuários</h2>
        <Btn onClick={()=>setModal(true)}>+ Novo Usuário</Btn>
      </div>
      <div style={{background:'#fef3c7',border:'1px solid #fcd34d',borderRadius:10,padding:'10px 16px',marginBottom:16,fontSize:13,color:'#92400e'}}>
        ⚠️ Somente administradores têm acesso a esta aba.
      </div>
      {loading?<Empty msg="Carregando..."/>:!usuarios.length?<Empty msg="Nenhum usuário cadastrado."/>:(
        <div style={{display:'grid',gap:10}}>
          {usuarios.map(u=>{
            const b=perfilBadge(u.perfil)
            return(
              <div key={u.id} style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:12,padding:'14px 18px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap',boxShadow:'0 1px 3px rgba(0,0,0,.06)'}}>
                <div style={{width:40,height:40,borderRadius:'50%',background:'linear-gradient(135deg,#1e3a5f,#2563eb)',display:'flex',alignItems:'center',justifyContent:'center',color:'#fff',fontWeight:700,fontSize:16,flexShrink:0}}>{u.nome[0]}</div>
                <div style={{flex:1}}>
                  <div style={{color:'#1e293b',fontWeight:700}}>{u.nome}</div>
                  <div style={{color:'#64748b',fontSize:12}}>{u.email}</div>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  <span style={{background:b.bg,color:b.color,padding:'2px 10px',borderRadius:999,fontSize:12,fontWeight:700}}>{b.label}</span>
                  <select value={u.perfil} onChange={e=>alterarPerfil(u.id,e.target.value)}
                    style={{background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'5px 10px',color:'#475569',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                    <option value="admin">Admin</option>
                    <option value="editor">Editor</option>
                    <option value="leitor">Leitor</option>
                  </select>
                  <Btn small variant="danger" onClick={()=>remover(u.id)}>Remover</Btn>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {modal&&(
        <Modal title="Novo Usuário" onClose={()=>setModal(false)}>
          <Inp label="Nome" value={form.nome} onChange={e=>setForm({...form,nome:e.target.value})}/>
          <Inp label="Email" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
          <div style={{marginBottom:16}}>
            <label style={{display:'block',color:'#94a3b8',fontSize:12,fontWeight:600,marginBottom:6,textTransform:'uppercase',letterSpacing:.8}}>Perfil</label>
            <select value={form.perfil} onChange={e=>setForm({...form,perfil:e.target.value})}
              style={{width:'100%',background:'#ffffff',border:'1px solid #cbd5e1',borderRadius:8,padding:'10px 14px',color:'#1e293b',fontSize:14,outline:'none',boxSizing:'border-box',fontFamily:'inherit'}}>
              <option value="editor">Editor — acesso total de edição</option>
              <option value="leitor">Leitor — somente visualização</option>
              <option value="admin">Admin — acesso total + gerenciar usuários</option>
            </select>
          </div>
          <div style={{background:'#f8fafc',border:'1px solid #e2e8f0',borderRadius:8,padding:'10px 14px',marginBottom:16,fontSize:13,color:'#64748b'}}>
            💡 O usuário será criado com senha temporária <strong>Temp@1234</strong>. Oriente-o a trocar após o primeiro acesso.
          </div>
          <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
            <Btn variant="ghost" onClick={()=>setModal(false)}>Cancelar</Btn>
            <Btn onClick={criarViaInvite} disabled={salvando}>{salvando?'Criando...':'Criar Usuário'}</Btn>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  {id:'dashboard',   label:'Dashboard',    icon:'📊'},
  {id:'funcionarios',label:'Funcionários', icon:'👷'},
  {id:'epis',        label:'Estoque EPIs', icon:'🦺'},
  {id:'entregas',    label:'Entregas',     icon:'📤'},
  {id:'devolucoes',  label:'Devoluções',   icon:'📥'},
  {id:'alertas',     label:'Alertas',      icon:'⚠️'},
  {id:'ambiental',   label:'Ambiental',    icon:'🌱'},
  {id:'usuarios',    label:'Usuários',     icon:'👥', adminOnly:true},
]

// ─── APP ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]               = useState('dashboard')
  const [funcionarios,setFunc]     = useState([])
  const [epis,setEpis]             = useState([])
  const [entregas,setEntregas]     = useState([])
  const [devolucoes,setDevolucoes] = useState([])
  const [loading,setLoading]       = useState(true)
  const [erro,setErro]             = useState(null)
  const [alertasPopup,setAlertasPopup] = useState(false)
  const [showPDF,setShowPDF]       = useState(false)
  const [sessao,setSessao]         = useState(null)
  const [perfil,setPerfil]         = useState(null)
  const [authLoading,setAuthLoading] = useState(true)
  const { ts, add:toast }          = useToast()

  // Verificar sessão ao carregar
  useEffect(()=>{
    getSession().then(async s=>{
      if(s){
        setSessao(s)
        const p = await getPerfil(s.user.id)
        setPerfil(p)
      }
      setAuthLoading(false)
    })
  },[])

  // Carregar dados quando autenticado
  useEffect(()=>{
    if(!sessao) return
    Promise.all([getFuncionarios(), getEpis(), getEntregas(), getDevolucoes()])
      .then(([f,e,en,d])=>{
        setFunc(f); setEpis(e); setEntregas(en); setDevolucoes(d)
        if(gerarAlertas(e).length>0) setAlertasPopup(true)
        setLoading(false)
      })
      .catch(err=>{ setErro(err.message); setLoading(false) })
  },[sessao])

  const handleLogin = async (email, senha) => {
    const data = await login(email, senha)
    setSessao(data.session)
    const p = await getPerfil(data.user.id)
    setPerfil(p)
    toast(`Bem-vindo, ${p?.nome||data.user.email}!`)
  }

  const handleLogout = async () => {
    await logout()
    setSessao(null)
    setPerfil(null)
    setFunc([]); setEpis([]); setEntregas([]); setDevolucoes([])
    setLoading(true)
    toast('Sessão encerrada.','info')
  }

  const podeEditar = perfil?.perfil === 'admin' || perfil?.perfil === 'editor'
  const isAdmin    = perfil?.perfil === 'admin'

  const alertas = useMemo(()=>gerarAlertas(epis),[epis])

  // Auth loading
  if(authLoading) return (
    <div style={{minHeight:'100vh',background:'#f0f4f8',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <div style={{fontSize:40}}>🦺</div>
      <div style={{color:'#1e3a5f',fontSize:18,fontWeight:700,fontFamily:"'Sora',sans-serif"}}>EPI Control</div>
      <div style={{color:'#64748b',fontSize:14}}>Verificando sessão...</div>
    </div>
  )

  // Not logged in
  if(!sessao) return <LoginScreen onLogin={handleLogin}/>

  if(loading) return (
    <div style={{minHeight:'100vh',background:'#f0f4f8',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
      <div style={{fontSize:40}}>🦺</div>
      <div style={{color:'#1e3a5f',fontSize:18,fontWeight:700,fontFamily:"'Sora',sans-serif"}}>EPI Control</div>
      <div style={{color:'#64748b',fontSize:14}}>Conectando ao banco de dados...</div>
    </div>
  )

  if(erro) return (
    <div style={{minHeight:'100vh',background:'#0f172a',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16,padding:32}}>
      <div style={{fontSize:40}}>❌</div>
      <div style={{color:'#ef4444',fontSize:18,fontWeight:700}}>Erro de conexão</div>
      <div style={{color:'#94a3b8',fontSize:14,textAlign:'center',maxWidth:400}}>Verifique se as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY estão corretas no arquivo .env</div>
      <div style={{background:'#1e293b',border:'1px solid #334155',borderRadius:8,padding:'12px 20px',color:'#f87171',fontSize:13,fontFamily:'monospace'}}>{erro}</div>
    </div>
  )

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet"/>
      <style>{`@media print{body *{visibility:hidden;}#print-zone,#print-zone *{visibility:visible;}#print-zone{position:absolute;left:0;top:0;width:100%;background:#fff;}}`}</style>
      <Toasts ts={ts}/>
      {alertasPopup&&alertas.length>0&&<AlertasPopup alertas={alertas} onClose={()=>setAlertasPopup(false)}/>}
      {showPDF&&<PDFModal funcionarios={funcionarios} epis={epis} entregas={entregas} devolucoes={devolucoes} onClose={()=>setShowPDF(false)}/>}

      <div style={{minHeight:'100vh',background:'#f0f4f8',fontFamily:"'DM Sans',sans-serif",color:'#1e293b',display:'flex',flexDirection:'column'}}>
        <div style={{background:'#1e3a5f',borderBottom:'1px solid #1a3352',padding:'0 24px',position:'sticky',top:0,zIndex:100,boxShadow:'0 2px 8px rgba(0,0,0,.15)'}}>
          <div style={{maxWidth:1100,margin:'0 auto',display:'flex',alignItems:'center',gap:16}}>
            <div style={{padding:'10px 0',marginRight:12,flexShrink:0,borderRight:'1px solid rgba(255,255,255,.15)',paddingRight:16,display:'flex',alignItems:'center',gap:10}}>
              <img src="https://static.wixstatic.com/media/7ee4fb_ea01331caac7470bb01de1c91f704451~mv2.png/v1/crop/x_37,y_184,w_934,h_511/fill/w_511,h_278,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/Logo%20GR%20-%20Fundo%20tranparente.png" alt="Guindastes Ribas" style={{height:38,width:'auto',objectFit:'contain',filter:'brightness(0) invert(1)'}}/>
              <div>
                <div style={{fontSize:15,fontWeight:800,fontFamily:"'Sora',sans-serif",color:'#ffffff',lineHeight:1.1}}>EPI Control</div>
                <div style={{color:'rgba(255,255,255,.55)',fontSize:9,marginTop:1,letterSpacing:.5}}>Gestão de Equipamentos</div>
              </div>
            </div>
            <nav style={{display:'flex',gap:2,flex:1,overflowX:'auto'}}>
              {TABS.filter(t=>!t.adminOnly||isAdmin).map(t=>(
                <button key={t.id} onClick={()=>setTab(t.id)}
                  style={{background:tab===t.id?'rgba(255,255,255,.12)':'transparent',border:'none',color:tab===t.id?'#ffffff':'rgba(255,255,255,.6)',padding:'16px 12px',fontSize:12,fontWeight:600,cursor:'pointer',borderBottom:tab===t.id?'2px solid #60a5fa':'2px solid transparent',whiteSpace:'nowrap',fontFamily:'inherit',display:'flex',alignItems:'center',gap:4}}>
                  {t.icon} {t.label}
                  {t.id==='alertas'&&alertas.length>0&&<span style={{background:'#ef4444',color:'#fff',borderRadius:999,fontSize:10,fontWeight:800,padding:'1px 5px'}}>{alertas.length}</span>}
                </button>
              ))}
            </nav>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0,paddingLeft:8,borderLeft:'1px solid rgba(255,255,255,.15)'}}>
              <div style={{textAlign:'right'}}>
                <div style={{color:'#fff',fontSize:12,fontWeight:600}}>{perfil?.nome||'Usuário'}</div>
                <div style={{color:'rgba(255,255,255,.5)',fontSize:10,textTransform:'uppercase',letterSpacing:.5}}>{perfil?.perfil||''}</div>
              </div>
              <button onClick={handleLogout} title="Sair"
                style={{background:'rgba(255,255,255,.1)',border:'1px solid rgba(255,255,255,.2)',borderRadius:8,padding:'6px 10px',color:'rgba(255,255,255,.8)',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                Sair
              </button>
            </div>
          </div>
        </div>

        <div style={{flex:1,maxWidth:1100,margin:'0 auto',padding:'28px 24px',width:'100%',color:'#1e293b'}}>
          {tab==='dashboard'    && <Dashboard    funcionarios={funcionarios} epis={epis} entregas={entregas} devolucoes={devolucoes}/>}
          {tab==='funcionarios' && <Funcionarios funcionarios={funcionarios} setFuncionarios={setFunc} entregas={entregas} devolucoes={devolucoes} toast={toast} podeEditar={podeEditar}/>}
          {tab==='epis'         && <EstoqueEPIs  epis={epis} setEpis={setEpis} toast={toast} podeEditar={podeEditar}/>}
          {tab==='entregas'     && <Entregas     entregas={entregas} setEntregas={setEntregas} funcionarios={funcionarios} epis={epis} setEpis={setEpis} toast={toast} podeEditar={podeEditar}/>}
          {tab==='devolucoes'   && <Devolucoes   devolucoes={devolucoes} setDevolucoes={setDevolucoes} funcionarios={funcionarios} epis={epis} setEpis={setEpis} toast={toast} podeEditar={podeEditar}/>}
          {tab==='alertas'      && <PainelAlertas epis={epis}/>}
          {tab==='ambiental'    && <PainelAmbiental entregas={entregas} devolucoes={devolucoes} epis={epis}/>}
          {tab==='usuarios'     && isAdmin && <GestaoUsuarios toast={toast}/>}
        </div>

        <Rodape dados={{funcionarios,epis,entregas,devolucoes}} onPDF={()=>setShowPDF(true)}/>
      </div>
    </>
  )
}
