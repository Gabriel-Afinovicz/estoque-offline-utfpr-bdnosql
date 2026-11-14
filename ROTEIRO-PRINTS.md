# Roteiro de prints para os slides

Baseado na **Especificação dos Seminários**: sem demonstração ao vivo, exemplos **curtos e explicados**
nos slides, **pouco texto**, situação do **GastroHub ou equivalente do projeto** (Bora Lá) e comparação
com os bancos da disciplina.

**Regra de ouro:** um print por ideia. Recorte só a parte que importa (Win + Shift + S) e, no slide,
destaque com uma seta ou um retângulo o ponto que vocês vão falar. A explicação fica na fala.

> **Sobre o estoque nos slides:** os exemplos da apresentação são do GastroHub/Bora Lá. Os prints do
> estoque entram como **"o que vimos acontecer"**, a prova visual do mecanismo. Ao mostrar, digam a
> tradução: *"aqui é um produto, no Bora Lá seria a corrida"*. Se preferirem, renomeiem os produtos
> antes do print (ex.: cadastrar "Corrida #1042"), já que o mecanismo é o mesmo.

---

## Parte 1: Offline-first

| # | O que mostrar | Como chegar na tela | O que dizer |
|---|---|---|---|
| **P1** | A tela inteira: 2 celulares + servidor no meio, todos sincronizados | Abrir o app logo depois de **Zerar** | "Cada aparelho tem o próprio banco; o servidor é só mais uma cópia." |
| **P2** | Celular A **Sem sinal**, com *"1 documento alterado só no celular"*, e o servidor ainda com o valor antigo | Exp. 1, passos 1 a 3 | "O app não travou: gravou no aparelho. É o entregador no subsolo / o motorista na estrada sem sinal." |
| **P3** | O banco **dentro do navegador** | F12 → aba **Application** → **IndexedDB** → `_pouch_estoque_celular_A` | "O dado está fisicamente no aparelho, não no servidor." |
| **P4** | O log com **⬆ enviado** e, logo abaixo, **⬇ recebido** | Exp. 1, passo 4 (recortar só o log) | "Voltou o sinal, a sincronização roda sozinha, em segundo plano." |

Código para um slide desta parte (não é print, é texto no slide):
```js
const local = new PouchDB('bora_la');                 // banco no celular
local.sync(servidor, { live: true, retry: true });    // sincroniza em segundo plano
```

## Parte 2: Replicação e conflitos

| # | O que mostrar | Como chegar na tela | O que dizer |
|---|---|---|---|
| **P5** | **ver JSON** de um documento com `_id` e `_rev` | Exp. 2 | "Toda alteração gera uma revisão nova: número de mudanças + código." |
| **P6** | Os **dois celulares e o servidor** com **⚠ conflito: 2 versões** | Exp. 3, passo 4 | "Dois aparelhos mexeram no mesmo documento sem sinal." |
| **P7** | **ver JSON** com o campo **`_conflicts`** | Exp. 3, passo 5 | "O CouchDB não apaga nada: guarda as duas versões e escolhe uma vencedora provisória, igual em todos os aparelhos." |
| **P8** | A janela **Resolver** com as 3 estratégias | Exp. 4 | É o coração da Parte 2: a última escrita vence × mesclar × perguntar ao usuário. |
| **P9** | Modo **movimentações**: saldo igual nos dois, sem conflito | Exp. 5 | "Modelar para evitar conflito: cada evento é um documento novo." |
| **P10** *(opcional)* | O mesmo documento no **Fauxton** | http://127.0.0.1:5984/_utils → banco `estoque` → abrir o produto | "É o CouchDB de verdade, o painel oficial." |

## Parte 3: Quando usar (e quando não)

| # | O que mostrar | Como chegar na tela | O que dizer |
|---|---|---|---|
| **P11** | Saldo **−1** depois de dois aparelhos venderem a última unidade | Exp. 6 | "A sincronização não perde nada, mas não impede duas pessoas de pegarem a mesma coisa. Pagamento e a última vaga da carona do Bora Lá não podem funcionar assim." |

O resto da Parte 3 é diagrama, não print:
- **CAP:** o CouchDB/PouchDB fica do lado **AP** (aceita escrita mesmo com a rede partida), com
  **consistência eventual**. Comparar com o slide do Módulo 10: MongoDB escolhe C (o primário isolado
  para de escrever), Redis escolhe A.
- **Apps conhecidos que funcionam assim:** sugestão para pesquisar e confirmar antes de colocar no slide
  (Google Docs offline, Google Maps offline, WhatsApp, apps de entregador e de motorista).

---

## Os prints mais importantes (se o tempo apertar)

**P2, P6, P7, P8, P9 e P11.** Esses mostram o problema, o conflito, a resolução, a modelagem que evita
o conflito e o limite do offline, que é exatamente o que a especificação pede nas três partes.

---

## Prints já tirados

Os prints do roteiro já estão em [`docs/prints/`](docs/prints/), gerados no laboratório
(P1 a P11, mais variações). Se preferirem refazer no próprio PC, sigam os passos acima: o
resultado é o mesmo.
