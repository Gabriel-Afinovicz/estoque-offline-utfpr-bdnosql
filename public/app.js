/* Estoque Offline — laboratório de offline-first com PouchDB + CouchDB
 *
 * Ideia central:
 *   - Cada "celular" tem o SEU banco local (PouchDB, guardado no navegador via IndexedDB).
 *   - O app lê e grava SEMPRE no banco local. Nunca espera o servidor.
 *   - Em segundo plano, PouchDB.sync() replica nos dois sentidos com o CouchDB.
 *   - Sem sinal, as gravações ficam no celular e sobem quando a conexão volta.
 *   - Se os dois celulares alterarem o mesmo documento sem sinal, o CouchDB guarda as
 *     duas versões (conflito) e escolhe uma vencedora provisória. Quem resolve somos nós.
 */

// ---------------------------------------------------------------- configuração
const URL_SERVIDOR = location.origin + '/couch/estoque'; // o server.js repassa para o CouchDB
const PRODUTOS_INICIAIS = [
  { nome: 'Arroz 5 kg', quantidade: 10 },
  { nome: 'Feijão 1 kg', quantidade: 8 },
  { nome: 'Café 500 g', quantidade: 12 },
];

let servidor = new PouchDB(URL_SERVIDOR);

const dispositivos = {
  A: { id: 'A', rotulo: 'Celular A', pessoa: 'Ana', papel: 'no depósito' },
  B: { id: 'B', rotulo: 'Celular B', pessoa: 'Bruno', papel: 'na loja' },
};
for (const d of Object.values(dispositivos)) {
  d.local = new PouchDB('estoque_celular_' + d.id);
  d.online = lerPreferencia('online_' + d.id, true);
  d.sync = null;
  d.estado = 'parado';
  d.pendentes = new Set();
  d.ouvinte = null;
}

let modo = lerPreferencia('modo', 'campo'); // 'campo' | 'mov'

// ---------------------------------------------------------------- utilitários
function lerPreferencia(chave, padrao) {
  try { const v = localStorage.getItem('lab_' + chave); return v === null ? padrao : JSON.parse(v); }
  catch { return padrao; }
}
function salvarPreferencia(chave, valor) {
  try { localStorage.setItem('lab_' + chave, JSON.stringify(valor)); } catch { /* ignora */ }
}
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const revCurta = (rev) => (rev ? rev.split('-')[0] + '-' + rev.split('-')[1].slice(0, 4) : '');
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('pt-BR') : '—');
const agora = () => new Date().toISOString();
function slug(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function log(tipo, texto) {
  const li = document.createElement('li');
  li.className = tipo;
  li.innerHTML = `<time>${new Date().toLocaleTimeString('pt-BR')}</time><span>${texto}</span>`;
  const lista = document.getElementById('log-lista');
  lista.prepend(li);
  while (lista.children.length > 200) lista.lastChild.remove();
}

// ---------------------------------------------------------------- leitura dos dados
async function lerEstoque(db) {
  const r = await db.allDocs({ include_docs: true, conflicts: true });
  const produtos = [];
  const saldos = {};
  let movimentacoes = 0;
  for (const linha of r.rows) {
    const doc = linha.doc;
    if (!doc || linha.id.startsWith('_design')) continue;
    if (doc.tipo === 'produto') produtos.push(doc);
    if (doc.tipo === 'movimentacao') {
      movimentacoes++;
      saldos[doc.produtoId] = (saldos[doc.produtoId] || 0) + doc.delta;
    }
  }
  produtos.sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  return { produtos, saldos, movimentacoes, total: r.rows.length };
}

// ---------------------------------------------------------------- escrita (sempre no banco local)
async function gravar(d, docs) {
  docs.forEach((doc) => d.pendentes.add(doc._id));
  const res = await d.local.bulkDocs(docs);
  const erro = res.find((x) => x.error);
  if (erro) throw new Error(erro.message || erro.error);
  return res;
}

async function alterarQuantidade(d, produtoId, delta) {
  const p = await d.local.get(produtoId);
  if (modo === 'campo') {
    const antes = p.quantidade;
    p.quantidade = antes + delta;
    p.atualizadoEm = agora();
    p.atualizadoPor = `${d.rotulo} (${d.pessoa})`;
    await gravar(d, [p]);
    log('local', `<b>${d.rotulo}</b>${d.online ? '' : ' <i>(sem sinal)</i>'}: ${esc(p.nome)} ${antes} → ${p.quantidade}, gravado no próprio celular.`);
  } else {
    const mov = {
      _id: `mov:${Date.now()}:${d.id}:${Math.random().toString(36).slice(2, 6)}`,
      tipo: 'movimentacao',
      produtoId,
      delta,
      dispositivo: d.rotulo,
      criadoEm: agora(),
    };
    await gravar(d, [mov]);
    log('local', `<b>${d.rotulo}</b>${d.online ? '' : ' <i>(sem sinal)</i>'}: nova movimentação ${delta > 0 ? '+' : ''}${delta} em ${esc(p.nome)} (documento novo, nada foi sobrescrito).`);
  }
}

async function criarProduto(d, nome, quantidade) {
  const id = 'produto:' + slug(nome);
  const existente = await d.local.get(id).catch(() => null);
  if (existente) { alert('Já existe um produto com esse nome neste celular.'); return; }
  await gravar(d, documentosDoProduto(nome, quantidade, `${d.rotulo} (${d.pessoa})`, d.rotulo));
  log('local', `<b>${d.rotulo}</b>${d.online ? '' : ' <i>(sem sinal)</i>'}: cadastrou ${esc(nome)} com ${quantidade} unidade(s).`);
}

function documentosDoProduto(nome, quantidade, autor, dispositivo) {
  const id = 'produto:' + slug(nome);
  return [
    { _id: id, tipo: 'produto', nome, quantidade, atualizadoEm: agora(), atualizadoPor: autor },
    {
      _id: `mov:${Date.now()}:${slug(dispositivo)}:${slug(nome)}`,
      tipo: 'movimentacao', produtoId: id, delta: quantidade, dispositivo, criadoEm: agora(), obs: 'estoque inicial',
    },
  ];
}

// ---------------------------------------------------------------- sincronização
function ligarSync(d) {
  if (d.sync) return;
  d.estado = 'sincronizando';
  d.sync = d.local
    .sync(servidor, { live: true, retry: true, back_off_function: (atraso) => (atraso === 0 ? 1000 : Math.min(atraso * 2, 8000)) })
    .on('change', (info) => {
      const docs = info.change.docs;
      const nomes = resumoDocs(docs);
      if (info.direction === 'push') {
        docs.forEach((doc) => d.pendentes.delete(doc._id));
        log('envio', `<b>${d.rotulo} → servidor</b>: ${docs.length} documento(s) enviado(s) ${nomes}`);
      } else {
        log('recebe', `<b>servidor → ${d.rotulo}</b>: ${docs.length} documento(s) recebido(s) ${nomes}`);
        docs.forEach((doc) => piscar(d.id, doc._id));
      }
      renderizarCelular(d);
    })
    .on('paused', (erro) => { d.estado = erro ? 'sem-servidor' : 'sincronizado'; renderizarCelular(d); })
    .on('active', () => { d.estado = 'sincronizando'; renderizarCelular(d); })
    .on('denied', (erro) => log('conflito', `${d.rotulo}: servidor recusou um documento (${esc(erro && erro.message)})`))
    .on('error', (erro) => { d.estado = 'sem-servidor'; renderizarCelular(d); console.error(erro); });
}

function desligarSync(d) {
  if (d.sync) { d.sync.cancel(); d.sync = null; }
  d.estado = 'offline';
}

function resumoDocs(docs) {
  const nomes = docs.map((doc) => (doc._deleted ? 'versão perdedora apagada' : doc.tipo === 'produto' ? doc.nome : doc.tipo === 'movimentacao' ? 'movimentação' : doc._id));
  const unicos = [...new Set(nomes)].slice(0, 3);
  return unicos.length ? `(${esc(unicos.join(', '))})` : '';
}

function alternarConexao(d) {
  d.online = !d.online;
  salvarPreferencia('online_' + d.id, d.online);
  if (d.online) {
    log('info', `<b>${d.rotulo}</b> voltou a ter sinal. A sincronização recomeça sozinha${d.pendentes.size ? ` e envia ${d.pendentes.size} documento(s) guardado(s)` : ''}.`);
    ligarSync(d);
  } else {
    log('info', `<b>${d.rotulo}</b> ficou sem sinal (ex.: subsolo). O app continua funcionando com o banco do próprio celular.`);
    desligarSync(d);
  }
  renderizarCelular(d);
  renderizarSetas();
}

// ---------------------------------------------------------------- conflitos
async function versoesDoDocumento(db, id) {
  const atual = await db.get(id, { conflicts: true });
  const revs = [atual._rev, ...(atual._conflicts || [])];
  const docs = await Promise.all(revs.map((rev) => db.get(id, { rev, revs: true })));
  return docs; // docs[0] é a vencedora provisória escolhida pelo CouchDB/PouchDB
}

function historico(doc) {
  const { start, ids } = doc._revisions;
  return ids.map((hash, i) => `${start - i}-${hash}`);
}

async function baseComum(db, versoes) {
  const listas = versoes.map(historico);
  const comuns = listas[0].filter((rev) => listas.every((l) => l.includes(rev)));
  if (!comuns.length) return null;
  try { return await db.get(versoes[0]._id, { rev: comuns[0] }); } catch { return null; }
}

function mesclar(base, versoes) {
  const limpo = (doc) => Object.fromEntries(Object.entries(doc).filter(([k]) => !k.startsWith('_')));
  const b = limpo(base);
  const resultado = { ...b };
  const campos = new Set(versoes.flatMap((v) => Object.keys(limpo(v))));
  for (const campo of campos) {
    if (campo === 'atualizadoEm' || campo === 'atualizadoPor') continue;
    if (campo === 'quantidade') {
      // soma as diferenças de cada aparelho em relação à base comum
      resultado.quantidade = versoes.reduce((total, v) => total + (v.quantidade - b.quantidade), b.quantidade);
    } else {
      const alterada = versoes.find((v) => v[campo] !== b[campo]);
      resultado[campo] = alterada ? alterada[campo] : b[campo];
    }
  }
  resultado.atualizadoEm = agora();
  resultado.atualizadoPor = 'mescla automática';
  return resultado;
}

async function aplicarResolucao(d, versoes, conteudo, estrategia) {
  const vencedora = versoes[0];
  const limpo = Object.fromEntries(Object.entries(conteudo).filter(([k]) => !k.startsWith('_')));
  const docs = [
    { ...limpo, _id: vencedora._id, _rev: vencedora._rev },
    ...versoes.slice(1).map((v) => ({ _id: v._id, _rev: v._rev, _deleted: true })),
  ];
  await gravar(d, docs);
  log('conflito', `<b>${d.rotulo}</b> resolveu o conflito de ${esc(limpo.nome)} com "${estrategia}": quantidade final ${limpo.quantidade}. As versões perdedoras foram apagadas e a decisão vai para o servidor.`);
  fecharModal();
}

async function abrirConflito(d, id) {
  const versoes = await versoesDoDocumento(d.local, id);
  const base = await baseComum(d.local, versoes);
  const maisRecente = [...versoes].sort((a, b) => b.atualizadoEm.localeCompare(a.atualizadoEm))[0];
  const mescla = base ? mesclar(base, versoes) : null;

  const cartoes = versoes.map((v, i) => `
    <div class="versao ${i === 0 ? 'vencedora' : ''}">
      <h4>Versão ${i + 1} ${i === 0 ? '<span class="selo">vencedora provisória</span>' : ''}</h4>
      <dl>
        <dt>quantidade</dt><dd>${v.quantidade}</dd>
        <dt>alterado por</dt><dd>${esc(v.atualizadoPor)}</dd>
        <dt>às</dt><dd>${hora(v.atualizadoEm)}</dd>
        <dt>_rev</dt><dd><code>${esc(v._rev)}</code></dd>
      </dl>
      <button data-escolher="${i}">Ficar com esta versão</button>
    </div>`).join('');

  abrirModal(`
    <h3>⚠ Conflito em ${esc(versoes[0].nome)}</h3>
    <p class="explica">Os dois celulares alteraram este documento sem sinal. O CouchDB guardou <b>todas</b> as versões e
    escolheu uma vencedora provisória pela mesma regra em todos os aparelhos (maior número de revisão; empate, maior código).
    Nada foi perdido, mas alguém precisa decidir.${base ? ` Base comum (antes dos dois mexerem): <b>${base.quantidade}</b> (<code>${revCurta(base._rev)}</code>).` : ''}</p>
    <div class="versoes">${cartoes}</div>
    <div class="estrategias">
      <div class="estrategia">
        <h4>⏱ A última escrita vence</h4>
        <p>Fica a versão com o horário mais recente (${esc(maisRecente.atualizadoPor)}, ${hora(maisRecente.atualizadoEm)}). A outra alteração se perde.</p>
        <button id="r-lww">Aplicar: fica ${maisRecente.quantidade}</button>
      </div>
      <div class="estrategia">
        <h4>🔀 Mesclar</h4>
        <p>${mescla ? `Soma o que cada celular mudou em relação à base: ${versoes.map((v) => `${v.quantidade - base.quantidade >= 0 ? '+' : ''}${v.quantidade - base.quantidade}`).join(' e ')}.` : 'Não foi possível achar a base comum neste celular.'}</p>
        <button id="r-mesclar" ${mescla ? '' : 'disabled'}>${mescla ? `Aplicar: fica ${mescla.quantidade}` : 'Indisponível'}</button>
      </div>
      <div class="estrategia">
        <h4>🙋 Perguntar ao usuário</h4>
        <p>É esta tela: a pessoa vê as versões e escolhe uma clicando em "Ficar com esta versão".</p>
      </div>
    </div>`);

  document.getElementById('r-lww').onclick = () => aplicarResolucao(d, versoes, maisRecente, 'a última escrita vence');
  const botaoMescla = document.getElementById('r-mesclar');
  if (mescla) botaoMescla.onclick = () => aplicarResolucao(d, versoes, mescla, 'mesclar');
  document.querySelectorAll('[data-escolher]').forEach((b) => {
    b.onclick = () => aplicarResolucao(d, versoes, versoes[Number(b.dataset.escolher)], 'perguntar ao usuário');
  });
}

// ---------------------------------------------------------------- visualizar JSON
function jsonColorido(obj) {
  const texto = JSON.stringify(obj, null, 2);
  return esc(texto)
    .replace(/&quot;(_rev|_id|_conflicts|_revisions)&quot;:/g, '<span class="esp">&quot;$1&quot;</span>:')
    .replace(/&quot;([^&]+?)&quot;:/g, '<span class="k">&quot;$1&quot;</span>:')
    .replace(/: &quot;(.*?)&quot;/g, ': <span class="s">&quot;$1&quot;</span>')
    .replace(/: (-?\d+(\.\d+)?)/g, ': <span class="n">$1</span>');
}

async function abrirJson(db, id, onde) {
  const bruto = await db.get(id, { conflicts: true });
  const { _id, _rev, _conflicts, ...resto } = bruto;
  const doc = { _id, _rev, ...(_conflicts ? { _conflicts } : {}), ...resto };
  abrirModal(`
    <h3>Documento como está ${esc(onde)}</h3>
    <p class="explica"><code>_id</code> identifica o documento. <code>_rev</code> é a revisão: número de vezes que ele mudou + um código da versão.
    ${doc._conflicts ? '<code>_conflicts</code> lista as versões concorrentes que ainda não foram resolvidas.' : ''}</p>
    <pre class="json">${jsonColorido(doc)}</pre>`);
}

// ---------------------------------------------------------------- modal
function abrirModal(html) {
  document.getElementById('modal-conteudo').innerHTML = html;
  document.getElementById('modal').hidden = false;
}
function fecharModal() { document.getElementById('modal').hidden = true; }

// ---------------------------------------------------------------- desenho da tela
function piscar(dispId, docId) {
  setTimeout(() => {
    const el = document.querySelector(`#celular-${dispId} [data-id="${CSS.escape(docId)}"]`);
    if (!el) return;
    el.classList.add('piscar');
    setTimeout(() => el.classList.remove('piscar'), 900);
  }, 60);
}

function textoStatus(d) {
  if (!d.online) {
    return d.pendentes.size
      ? `<span class="pendente"><b>${d.pendentes.size} documento(s) alterado(s) só no celular</b>, esperando o sinal voltar.</span>`
      : 'Sem sinal. Tudo que for gravado fica no celular.';
  }
  if (d.estado === 'sem-servidor') return '<b>Servidor fora do ar.</b> Tentando de novo sozinho…';
  if (d.estado === 'sincronizando') return 'Sincronizando com o servidor…';
  return '<b>✓ Sincronizado</b> com o servidor.';
}

async function renderizarCelular(d) {
  const raiz = document.getElementById('celular-' + d.id);
  const { produtos, saldos, movimentacoes } = await lerEstoque(d.local);

  d.conflitosVistos = d.conflitosVistos || new Set();
  for (const p of produtos) {
    const chave = p._id + '|' + (p._conflicts || []).join(',');
    if (p._conflicts && !d.conflitosVistos.has(chave)) {
      d.conflitosVistos.add(chave);
      log('conflito', `<b>${d.rotulo}</b> detectou um conflito em ${esc(p.nome)}: ${p._conflicts.length + 1} versões do mesmo documento.`);
    }
  }

  const cartoes = produtos.map((p) => {
    const conflito = p._conflicts && p._conflicts.length;
    const valor = modo === 'campo' ? p.quantidade : (saldos[p._id] ?? 0);
    const outro = modo === 'campo'
      ? `saldo por movimentações: ${saldos[p._id] ?? 0}`
      : `campo quantidade: ${p.quantidade}`;
    return `
      <div class="produto ${conflito ? 'em-conflito' : ''}" data-id="${esc(p._id)}">
        <div class="produto-linha">
          <span class="produto-nome">${esc(p.nome)}</span>
          <div class="botoes-qtd">
            <button data-acao="menos" data-id="${esc(p._id)}" aria-label="Tirar 1">−</button>
            <span class="qtd">${valor}</span>
            <button data-acao="mais" data-id="${esc(p._id)}" aria-label="Pôr 1">+</button>
          </div>
        </div>
        <div class="meta">
          <span class="rev" title="Revisão do documento neste celular">_rev ${revCurta(p._rev)}</span>
          <span>${esc(outro)}</span>
          <button class="link" data-acao="json" data-id="${esc(p._id)}">ver JSON</button>
        </div>
        ${conflito ? `<div class="alerta-conflito"><span>⚠ ${conflito + 1} versões deste produto</span><button data-acao="resolver" data-id="${esc(p._id)}">Resolver</button></div>` : ''}
      </div>`;
  }).join('');

  raiz.innerHTML = `
    <div class="cel-cab">
      <h2>📱 ${d.rotulo}</h2>
      <p>${d.pessoa}, ${d.papel} · banco local <code>estoque_celular_${d.id}</code> · ${movimentacoes} movimentação(ões)</p>
    </div>
    <button class="conexao ${d.online ? 'online' : 'offline'}" data-acao="conexao">
      ${d.online ? '📶 Com sinal' : '🚫 Sem sinal'} <small>(toque para ${d.online ? 'desligar' : 'ligar'})</small>
    </button>
    <div class="sync-status">${textoStatus(d)}</div>
    ${cartoes || '<p class="vazio">Nenhum produto ainda.</p>'}
    <form class="novo-produto">
      <input name="nome" placeholder="Novo produto" required maxlength="40">
      <input name="qtd" type="number" min="0" value="5" required aria-label="Quantidade">
      <button>Cadastrar</button>
    </form>`;

  raiz.querySelector('form').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    await criarProduto(d, f.nome.value.trim(), Number(f.qtd.value));
  };
}

function renderizarSetas() {
  for (const d of Object.values(dispositivos)) {
    const el = document.getElementById('seta-' + d.id);
    el.className = d.online ? 'ligada' : 'desligada';
  }
}

async function renderizarServidor() {
  const status = document.getElementById('servidor-status');
  try {
    const { produtos, saldos, movimentacoes, total } = await lerEstoque(servidor);
    status.textContent = 'no ar';
    status.className = 'tag ok';
    document.getElementById('servidor-lista').innerHTML = produtos.map((p) => `
      <div class="doc-servidor ${p._conflicts ? 'em-conflito' : ''}">
        <div class="linha1"><span>${esc(p.nome)}</span><span>${modo === 'campo' ? p.quantidade : (saldos[p._id] ?? 0)}</span></div>
        <div class="linha2"><code>${esc(p._id)}</code> · _rev ${revCurta(p._rev)} · ${esc(p.atualizadoPor)} às ${hora(p.atualizadoEm)}</div>
        ${p._conflicts ? `<div class="aviso">⚠ conflito: ${p._conflicts.length + 1} versões guardadas</div>` : ''}
      </div>`).join('') || '<p class="vazio">Banco vazio.</p>';
    document.getElementById('servidor-contagem').textContent =
      `${total} documento(s) no servidor: ${produtos.length} produto(s) e ${movimentacoes} movimentação(ões).`;
  } catch (erro) {
    status.textContent = 'fora do ar';
    status.className = 'tag erro';
    document.getElementById('servidor-lista').innerHTML =
      '<p class="vazio">Não consegui falar com o CouchDB. Confira se ele está rodando e se usuário e senha do config.json estão certos.</p>';
  }
}

function renderizarModo() {
  document.querySelectorAll('.modo-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.modo === modo));
}

async function renderizarTudo() {
  renderizarModo();
  renderizarSetas();
  await Promise.all(Object.values(dispositivos).map(renderizarCelular));
  await renderizarServidor();
}

// ---------------------------------------------------------------- eventos
document.addEventListener('click', async (e) => {
  const alvo = e.target.closest('[data-acao]');
  if (!alvo) return;
  const celular = e.target.closest('.celular');
  const d = celular && dispositivos[celular.id.replace('celular-', '')];
  if (!d) return;
  const id = alvo.dataset.id;
  try {
    if (alvo.dataset.acao === 'conexao') alternarConexao(d);
    if (alvo.dataset.acao === 'menos') await alterarQuantidade(d, id, -1);
    if (alvo.dataset.acao === 'mais') await alterarQuantidade(d, id, +1);
    if (alvo.dataset.acao === 'json') await abrirJson(d.local, id, `no ${d.rotulo}`);
    if (alvo.dataset.acao === 'resolver') await abrirConflito(d, id);
  } catch (erro) {
    log('conflito', `Erro: ${esc(erro.message)}`);
    console.error(erro);
  }
});

document.querySelectorAll('.modo-btn').forEach((b) => {
  b.onclick = () => {
    modo = b.dataset.modo;
    salvarPreferencia('modo', modo);
    log('info', modo === 'campo'
      ? 'Modo <b>alterar o campo quantidade</b>: cada baixa reescreve o mesmo documento do produto (pode gerar conflito).'
      : 'Modo <b>gravar movimentação</b>: cada baixa vira um documento novo e o saldo é a soma (não gera conflito).');
    renderizarTudo();
  };
});

document.getElementById('modal-fechar').onclick = fecharModal;
document.getElementById('modal').onclick = (e) => { if (e.target.id === 'modal') fecharModal(); };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });
document.getElementById('btn-limpar-log').onclick = () => { document.getElementById('log-lista').innerHTML = ''; };
document.getElementById('btn-zerar').onclick = async () => {
  if (!confirm('Apagar os bancos dos dois celulares e do servidor e começar de novo com os produtos iniciais?')) return;
  await zerarLaboratorio();
};

async function zerarLaboratorio() {
  for (const d of Object.values(dispositivos)) {
    desligarSync(d);
    if (d.ouvinte) d.ouvinte.cancel();
    await d.local.destroy();
    d.local = new PouchDB('estoque_celular_' + d.id);
    d.pendentes.clear();
  }
  await servidor.destroy().catch(() => {});
  servidor = new PouchDB(URL_SERVIDOR);
  await semear();
  document.getElementById('log-lista').innerHTML = '';
  log('info', 'Laboratório zerado: produtos iniciais gravados no servidor. Os celulares vão baixar tudo na primeira sincronização.');
  iniciarCelulares();
}

async function semear() {
  const docs = PRODUTOS_INICIAIS.flatMap((p) => documentosDoProduto(p.nome, p.quantidade, 'Servidor (carga inicial)', 'servidor'));
  await servidor.bulkDocs(docs);
}

function iniciarCelulares() {
  for (const d of Object.values(dispositivos)) {
    d.ouvinte = d.local.changes({ since: 'now', live: true }).on('change', () => renderizarCelular(d));
    if (d.online) ligarSync(d); else d.estado = 'offline';
  }
  renderizarTudo();
}

// ---------------------------------------------------------------- início
(async function iniciar() {
  document.getElementById('link-fauxton').href = 'http://localhost:5984/_utils/#database/estoque/_all_docs';
  renderizarModo();
  try {
    const info = await servidor.info();
    if (info.doc_count === 0) {
      await semear();
      log('info', 'Primeira execução: produtos iniciais gravados no servidor.');
    }
  } catch (erro) {
    log('conflito', 'CouchDB não respondeu. O app funciona offline mesmo assim; a sincronização começa quando ele voltar.');
  }
  iniciarCelulares();
  setInterval(renderizarServidor, 1000);
  log('info', 'Pronto. Desligue o sinal de um celular, mexa no estoque e ligue de novo para ver a sincronização.');
})();
