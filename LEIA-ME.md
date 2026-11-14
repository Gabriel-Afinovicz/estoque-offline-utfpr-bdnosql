# Estoque Offline: laboratório de PouchDB + CouchDB

Este é um sistema pequeno para **estudar** o Tema 6 do seminário (Offline e sincronização).
Ele **não é cobrado** na apresentação (não tem demonstração ao vivo). Serve para vocês verem
o offline, a replicação e os conflitos acontecendo, e para tirar os prints dos slides.

A tela simula **dois celulares** (A e B) e o **servidor** no meio:

- Cada celular tem o **próprio banco** (PouchDB, guardado no navegador).
- O app lê e grava **sempre no banco do celular**. Ele nunca espera o servidor.
- Em segundo plano, cada celular **sincroniza nos dois sentidos** com o CouchDB.
- O botão **"Com sinal / Sem sinal"** corta a sincronização daquele celular, como o entregador no subsolo.

---

## 1. Instalar (uma vez só)

### 1.1 Node.js
Se ainda não tiver: https://nodejs.org → versão **LTS** → instalar com as opções padrão.
Para conferir, abra o **Prompt de Comando** e digite `node -v`.

### 1.2 CouchDB (instalador do Windows)
1. Baixe em https://couchdb.apache.org/#download → **Windows (x64)** → arquivo `.msi`.
2. Durante a instalação ele pede um **usuário e senha de administrador**. Use
   **`admin`** / **`admin`** (é só para estudo; se escolher outra, troque no `config.json`).
3. Deixe marcada a opção de instalar **como serviço**: assim o CouchDB liga sozinho com o Windows.
4. Abra no navegador **http://127.0.0.1:5984/_utils** (é o **Fauxton**, o painel do CouchDB) e entre com o usuário e a senha.
5. No menu da esquerda, clique em **Setup** → **Configure a Single Node** → informe o mesmo
   usuário e senha → **Configure Node**. Isso cria os bancos internos do CouchDB.

> Se algum dia o Windows pedir para reiniciar depois da instalação, reinicie.

### 1.3 Conferir o `config.json`
```json
{ "couchUrl": "http://127.0.0.1:5984", "usuario": "admin", "senha": "admin", "porta": 8080 }
```
Só mude se escolheu outra senha no CouchDB.

---

## 2. Rodar

Dê **dois cliques em `iniciar.bat`**. Ele liga o servidor do app e abre http://localhost:8080.
Para parar, feche a janela preta (ou `Ctrl + C`).

> Por que existe um `server.js`? Ele entrega a página e repassa o que chega em `/couch/...` para o
> CouchDB, já com a senha. Assim navegador e banco ficam no mesmo endereço e não é preciso configurar CORS.

Na primeira vez, o app grava 3 produtos no servidor (Arroz, Feijão, Café) e os dois celulares baixam tudo.
O botão **Zerar laboratório** volta a esse começo sempre que quiserem.

---

## 3. Roteiro de estudo (façam juntos, uns 30 min)

Para cada experimento: **façam**, depois **expliquem em voz alta um para o outro** o que aconteceu.
É o melhor treino para as perguntas do professor.

### Experimento 1: offline-first (Parte 1 do seminário)
1. Clique em **Com sinal** no Celular A: ele fica **Sem sinal**.
2. Tire 2 unidades de Arroz no Celular A.
3. Repare: o número muda **na hora**, o app não trava, e aparece *"1 documento alterado só no celular"*.
   O servidor e o Celular B continuam com 10.
4. Ligue o sinal do Celular A. Em 1 segundo o log mostra **⬆ Celular A → servidor** e logo **⬇ servidor → Celular B**.

**Para entender:** é o entregador no subsolo. A gravação foi para o banco do aparelho; a sincronização
levou para o servidor quando o sinal voltou. É a **consistência eventual** do Módulo 08: por alguns
instantes as cópias discordaram, depois ficaram iguais.

### Experimento 2: revisões (`_rev`)
1. Clique em **ver JSON** em um produto. Veja `_id` e `_rev`.
2. Mude a quantidade e abra o JSON de novo: o `_rev` passou de `1-...` para `2-...`.

**Para entender:** o número antes do traço é **quantas vezes o documento mudou**; o resto é um código
daquela versão. É assim que o CouchDB sabe, ao sincronizar, qual versão é mais nova e se duas versões
vieram do mesmo ponto.
**Comparação com o MongoDB:** no MongoDB o documento não tem revisão; quem grava por último sobrescreve.

### Experimento 3: conflito (Parte 2 do seminário)
1. Deixe os **dois** celulares **Sem sinal**.
2. Celular A: tire **2** do Arroz (10 → 8). Celular B: tire **3** do Arroz (10 → 7).
3. Ligue o sinal do A e depois o do B.
4. Os dois celulares e o servidor mostram **⚠ conflito: 2 versões**. Os dois celulares mostram **o mesmo valor**:
   o CouchDB escolheu a mesma **vencedora provisória** em todo lugar, sem os aparelhos conversarem
   (regra: maior número de revisão; empate, maior código). Note que ganhou quem tinha **mais edições**,
   não quem gravou por último.
5. Abra **ver JSON**: apareceu o campo **`_conflicts`** com a versão perdedora. **Nada foi apagado.**

### Experimento 4: as três formas de resolver
Clique em **Resolver** e compare as opções (faça Zerar e repita o Experimento 3 para testar cada uma):

| Estratégia | Resultado no exemplo | Quando faz sentido |
|---|---|---|
| **A última escrita vence** | fica o valor de quem gravou por último (8 ou 7); a baixa do outro **se perde** | dados em que só importa o valor atual: status, foto do perfil |
| **Mesclar** | 10 − 2 − 3 = **5** (soma o que cada um mudou desde a base comum) | contadores, listas, campos diferentes alterados por cada um |
| **Perguntar ao usuário** | a pessoa escolhe a versão | textos, decisões que só um humano sabe fazer |

**Cuidado com "a última escrita vence":** ela usa o relógio de cada aparelho, e um relógio adiantado "ganha sempre".

### Experimento 5: evitar o conflito na modelagem
1. **Zerar laboratório** e, no topo, escolha **Gravar uma movimentação**.
2. Repita: os dois sem sinal, A tira 2 e B tira 3 do Feijão, liguem os dois.
3. O saldo fica **3 nos dois** e **não há conflito**.

**Para entender:** cada baixa vira um **documento novo** (`mov:...`), e o saldo é a **soma** das
movimentações. Ninguém reescreve o mesmo documento, então não existe conflito.
É a mesma ideia da imutabilidade dos pedidos que o professor mostrou na modelagem do MongoDB.

### Experimento 6: onde o offline NÃO serve (Parte 3 do seminário)
1. Cadastre um produto com quantidade **1** (ainda no modo movimentação).
2. Os dois celulares sem sinal; cada um tira 1.
3. Ligue os dois: o saldo fica **−1**. Os dois "venderam" a última unidade.

**Para entender:** a sincronização não deixa nada se perder, mas **não impede** duas pessoas
de usarem o mesmo recurso ao mesmo tempo. É o caso do **pagamento** e, no Bora Lá, da **última vaga da carona**:
isso precisa de confirmação do servidor (consistência), não de offline.

---

## 4. Os trechos de código que importam (para os slides)

**O banco no celular e a sincronização** (`public/app.js`):
```js
const local = new PouchDB('estoque_celular_A');            // banco dentro do aparelho
const servidor = new PouchDB('http://.../estoque');         // CouchDB

local.sync(servidor, { live: true, retry: true })           // nos dois sentidos, sem parar
  .on('change', (info) => console.log(info.direction))      // 'push' (subiu) ou 'pull' (desceu)
  .on('paused', () => console.log('sincronizado'));
```

**Gravar** (sempre local, sem esperar a rede):
```js
const p = await local.get('produto:arroz-5-kg');
p.quantidade = p.quantidade - 1;
await local.put(p);                                         // o _rev atual vai junto
```

**Descobrir e resolver um conflito:**
```js
const doc = await local.get(id, { conflicts: true });       // doc._conflicts = ['2-1f19...']
// ...decide o conteúdo final e apaga as versões perdedoras:
await local.bulkDocs([
  { ...final, _id: id, _rev: doc._rev },
  ...doc._conflicts.map((rev) => ({ _id: id, _rev: rev, _deleted: true })),
]);
```

---

## 5. Problemas comuns

| Sintoma | O que fazer |
|---|---|
| Servidor aparece **fora do ar** | O CouchDB está ligado? Abra http://127.0.0.1:5984. Se não abrir, em *Serviços do Windows* inicie **Apache CouchDB**. |
| Erro de senha / 401 | Usuário e senha do `config.json` precisam ser os mesmos do CouchDB. |
| `node não encontrado` | Instale o Node.js LTS e abra o `iniciar.bat` de novo. |
| Porta 8080 ocupada | Troque `"porta"` no `config.json` (ex.: 8090) e abra esse endereço. |
| Quero começar do zero | Botão **Zerar laboratório**. |

## 6. Arquivos

```
estoque-offline/
├── iniciar.bat        ← dois cliques para rodar
├── server.js          ← entrega a página e repassa /couch para o CouchDB (sem bibliotecas)
├── config.json        ← endereço, usuário e senha do CouchDB
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js         ← toda a lógica: sync, offline, conflitos, movimentações
│   └── vendor/pouchdb.min.js   ← PouchDB 9 (fica local: o app abre mesmo sem internet)
└── ROTEIRO-PRINTS.md  ← quais prints tirar para cada parte do seminário
```
