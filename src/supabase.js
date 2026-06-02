import { createClient } from '@supabase/supabase-js'

const URL = import.meta.env.VITE_SUPABASE_URL
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
export const supabase = createClient(URL, KEY)

// ─── FUNCIONÁRIOS ────────────────────────────────────────────────
export async function getFuncionarios() {
  const { data, error } = await supabase.from('funcionarios').select('*').order('nome')
  if (error) throw error
  return data.map(f => ({ id: f.id, nome: f.nome, ativo: f.ativo }))
}
export async function upsertFuncionario(f) {
  const { error } = await supabase.from('funcionarios')
    .upsert({ id: f.id, nome: f.nome, ativo: f.ativo }, { onConflict: 'id' })
  if (error) throw error
}
export async function deleteFuncionario(id) {
  const { error } = await supabase.from('funcionarios').delete().eq('id', id)
  if (error) throw error
}

// ─── EPIs ────────────────────────────────────────────────────────
export async function getEpis() {
  const { data, error } = await supabase.from('epis').select('*').order('descricao')
  if (error) throw error
  return data.map(e => ({
    id: e.id, descricao: e.descricao, fabricante: e.fabricante || '',
    ca: e.ca || '', validade: e.validade, quantidade: e.quantidade,
    minimo: e.minimo, pesoG: e.peso_g
  }))
}
export async function upsertEpi(e) {
  const { error } = await supabase.from('epis')
    .upsert({
      id: e.id, descricao: e.descricao, fabricante: e.fabricante,
      ca: e.ca, validade: e.validade || null, quantidade: Number(e.quantidade),
      minimo: Number(e.minimo), peso_g: Number(e.pesoG)
    }, { onConflict: 'id' })
  if (error) throw error
}
export async function updateQuantidadeEpi(id, quantidade, validade) {
  const upd = { quantidade }
  if (validade) upd.validade = validade
  const { error } = await supabase.from('epis').update(upd).eq('id', id)
  if (error) throw error
}
export async function deleteEpi(id) {
  const { error } = await supabase.from('epis').delete().eq('id', id)
  if (error) throw error
}

// ─── ENTREGAS ────────────────────────────────────────────────────
export async function getEntregas() {
  const { data, error } = await supabase.from('entregas').select('*')
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data.map(e => ({
    id: e.id, funcId: e.func_id, funcNome: e.func_nome,
    epiId: e.epi_id, epiDesc: e.epi_desc,
    data: e.data, quantidade: e.quantidade, motivo: e.motivo
  }))
}
export async function insertEntrega(e) {
  const { data, error } = await supabase.from('entregas').insert({
    func_id: e.funcId, func_nome: e.funcNome,
    epi_id: e.epiId, epi_desc: e.epiDesc,
    data: e.data, quantidade: e.quantidade, motivo: e.motivo
  }).select().single()
  if (error) throw error
  return { ...e, id: data.id }
}

// ─── DEVOLUÇÕES ──────────────────────────────────────────────────
export async function getDevolucoes() {
  const { data, error } = await supabase.from('devolucoes').select('*')
    .order('criado_em', { ascending: false })
  if (error) throw error
  return data.map(d => ({
    id: d.id, funcId: d.func_id, funcNome: d.func_nome,
    epiId: d.epi_id, epiDesc: d.epi_desc,
    data: d.data, quantidade: d.quantidade, motivo: d.motivo
  }))
}
export async function insertDevolucao(d) {
  const { data, error } = await supabase.from('devolucoes').insert({
    func_id: d.funcId, func_nome: d.funcNome,
    epi_id: d.epiId, epi_desc: d.epiDesc,
    data: d.data, quantidade: d.quantidade, motivo: d.motivo
  }).select().single()
  if (error) throw error
  return { ...d, id: data.id }
}
