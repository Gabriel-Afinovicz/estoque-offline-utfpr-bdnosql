// Servidor do laboratório "Estoque Offline".
// Não precisa de nenhuma biblioteca: só o Node.js.
//
// Faz duas coisas:
//   1. Entrega os arquivos da pasta public/ (a página do app).
//   2. Repassa tudo que chega em /couch/... para o CouchDB, já com o usuário e a senha.
//      Assim o navegador e o CouchDB ficam no "mesmo endereço" e não é preciso configurar CORS.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const COUCH = new URL(config.couchUrl || 'http://127.0.0.1:5984');
const AUTH = 'Basic ' + Buffer.from(`${config.usuario}:${config.senha}`).toString('base64');
const PORTA = Number(process.env.PORTA || config.porta || 8080);
const PUBLICO = path.join(__dirname, 'public');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function repassarParaCouch(req, res) {
  const destino = req.url.replace(/^\/couch/, '') || '/';
  const headers = { ...req.headers, host: COUCH.host, authorization: AUTH };
  delete headers.cookie;
  delete headers.origin;
  delete headers.referer;

  const proxy = http.request(
    { hostname: COUCH.hostname, port: COUCH.port || 5984, path: destino, method: req.method, headers },
    (resposta) => {
      res.writeHead(resposta.statusCode, resposta.headers);
      resposta.pipe(res);
    }
  );
  proxy.on('error', (erro) => {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'couchdb_fora_do_ar', reason: erro.message }));
  });
  req.pipe(proxy);
}

function entregarArquivo(req, res) {
  let caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (caminho === '/') caminho = '/index.html';
  const arquivo = path.normalize(path.join(PUBLICO, caminho));
  if (!arquivo.startsWith(PUBLICO)) { res.writeHead(403); return res.end(); }
  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, {
      'content-type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(conteudo);
  });
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/couch')) return repassarParaCouch(req, res);
    return entregarArquivo(req, res);
  })
  .listen(PORTA, () => {
    console.log('');
    console.log('  Estoque Offline rodando!');
    console.log(`  App ............ http://localhost:${PORTA}`);
    console.log(`  CouchDB ........ ${COUCH.origin}  (painel Fauxton: ${COUCH.origin}/_utils)`);
    console.log('');
    console.log('  Para parar: Ctrl + C');
    if (process.platform === 'win32' && !process.env.SEM_NAVEGADOR) {
      require('child_process').exec(`start "" http://localhost:${PORTA}`);
    }
  });
