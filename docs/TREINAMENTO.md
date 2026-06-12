# Treinamento de Uso do MesaPro

Este treinamento prepara a equipe para operar o app em uso real de restaurante, desde a configuracao inicial ate o fechamento de contas.

## Publico

- Administrador: configura o sistema, acessos, mesas, cardapio e integracoes.
- Gerente: acompanha operacao, mesas, riscos e indicadores.
- Garcom: abre mesas, registra pessoas, pedidos e observacoes por prato.
- Cozinha: acompanha a fila de preparo e muda status dos itens.
- Caixa: confere conta, registra pagamentos e libera mesas.

## Duracao sugerida

- Treinamento rapido: 45 minutos.
- Treinamento completo: 2 horas.
- Acompanhamento no primeiro turno real: 1 turno.

## Preparacao antes do treinamento

1. Abrir o app em `http://127.0.0.1:5173`.
2. Confirmar que a API esta online em `http://127.0.0.1:8787/api/health`.
3. Para treinamento guiado, clicar no botao `Treinamento` na tela de login.
4. Para treinamento pratico com dados reais, criar o primeiro administrador, caso ainda nao exista.
5. Em producao, instalar o app no navegador do tablet/celular quando o botao `Instalar` aparecer.
6. Cadastrar pelo menos:
   - 3 mesas reais;
   - 5 produtos reais no cardapio;
   - os tipos de acesso que a operacao usa.
7. Separar os participantes por funcao.

## Treinamento guiado no app

Na tela de login existe o botao `Treinamento`.

Ao clicar nele, o app entra em modo instrutivo:

- a tela fica escurecida;
- o campo explicado fica em foco;
- a explicacao aparece em uma caixa sobre a tela;
- os botoes `Proximo`, `Voltar` e `Pular` controlam o roteiro;
- dados temporarios de treinamento podem aparecer somente para explicar o fluxo, sem gravar no banco.

Ordem do roteiro guiado:

1. Tipos de acesso.
2. Cadastro de mesas.
3. Cadastro do cardapio.
4. Integracoes.
5. Abertura de mesa.
6. Lancamento de pedido.
7. Envio para cozinha.
8. Producao na cozinha.
9. Fechamento de conta.
10. Gestao do turno.
11. Modo offline e sincronizacao.

## Preparacao para treinamento pratico

Antes de simular um turno com a equipe:

1. Criar o primeiro administrador.
2. Criar tipos de acesso.
3. Cadastrar pelo menos:
   - 3 mesas reais;
   - 5 produtos reais no cardapio;
   - os tipos de acesso que a operacao usa.
4. Separar os participantes por funcao.

## Aula 1: Primeiro acesso e login

Objetivo: ensinar como entrar no sistema com seguranca.

Passos:

1. Abrir o app.
2. Selecionar o operador.
3. Digitar o PIN.
4. Conferir se o nome e o tipo de acesso aparecem no canto inferior da barra lateral.
5. Usar o botao de sair ao trocar de operador.

Pontos importantes:

- Cada pessoa deve usar o proprio acesso.
- PIN nao deve ser compartilhado.
- Ao terminar o turno, o operador deve sair do app.

## Aula 2: Tipos de acesso

Objetivo: ensinar o administrador a controlar quais abas cada perfil pode acessar.

Onde fica:

- Aba `Gestao`.
- Secao `Tipos de acesso`.

Como criar:

1. Informar o nome do tipo de acesso.
2. Marcar as abas permitidas.
3. Marcar as acoes permitidas.
4. Clicar em `Criar tipo de acesso`.

Como editar:

1. Localizar o perfil na lista.
2. Clicar em `Editar`.
3. Alterar nome ou permissoes.
4. Clicar em `Salvar tipo de acesso`.

Como excluir:

1. Localizar um perfil personalizado.
2. Clicar em `Excluir`.
3. Confirmar a exclusao.

Regras:

- Perfis padrao do sistema nao podem ser excluidos.
- Perfil em uso por operador nao pode ser excluido.
- O perfil `Admin` deve ficar restrito a pessoas de confianca.
- Permissoes de acao controlam funcoes sensiveis, como cancelar pedido, liberar mesa, cadastrar produtos e configurar integracoes.

Exercicio:

Criar um perfil chamado `Bar` com permissao apenas para `Cozinha` e acao `Status da cozinha`, simulando uma tela de producao do bar.

## Aula 3: Cadastro de mesas no salao

Objetivo: ensinar como preparar o mapa de mesas.

Onde fica:

- Aba `Salao`.
- Painel lateral `Cadastrar mesa`.

Como cadastrar:

1. Informar o numero da mesa.
2. Informar a capacidade de referencia.
3. Informar o setor, como `Salao principal`, `Varanda` ou `Area externa`.
4. Clicar em `Cadastrar mesa`.

Regras:

- O numero da mesa deve ser unico.
- A capacidade e uma referencia, mas o pedido aceita qualquer quantidade real de pessoas.
- Setores ajudam a organizar o salao visualmente.

Exercicio:

Cadastrar as mesas 1, 2 e 3 no setor `Salao principal` e a mesa 10 no setor `Varanda`.

## Aula 4: Cadastro e edicao do cardapio

Objetivo: ensinar o administrador a manter produtos reais.

Onde fica:

- Aba `Cardapio`.
- Secao `Novo produto`.

Campos:

- Nome.
- Categoria.
- Praca de preparo.
- Descricao.
- Preco.
- Tempo de preparo.
- Tags.
- Alergenicos.
- Favorito.
- Disponivel para venda.

Como cadastrar:

1. Preencher os dados do produto.
2. Marcar se ele e favorito.
3. Confirmar se esta disponivel para venda.
4. Clicar em `Cadastrar produto`.

Como editar:

1. Localizar o produto na lista.
2. Clicar em `Editar`.
3. Alterar os campos necessarios.
4. Clicar em `Salvar alteracoes`.

Como pausar venda:

1. Localizar o produto.
2. Usar o botao `Disponivel` ou `Indisponivel`.

Exercicio:

Cadastrar um prato principal, uma bebida e uma sobremesa. Depois editar o preco de um deles e deixar outro indisponivel.

## Aula 5: Fluxo do garcom

Objetivo: ensinar como atender uma mesa do inicio ao envio para a cozinha.

Passos:

1. Abrir a aba `Salao`.
2. Clicar em `Abrir` na mesa.
3. Conferir a quantidade de pessoas.
4. Ajustar pessoas com `+`, `-` ou digitando a quantidade.
5. Escolher pessoa/lugar no controle de assentos.
6. Buscar o produto.
7. Preencher observacoes do prato, se necessario.
8. Usar atalhos como `Sem cebola`, `Sem molho` ou ponto da carne.
9. Clicar em `Adicionar`.
10. Conferir a comanda.
11. Editar observacao na comanda enquanto o item estiver em rascunho.
12. Clicar em `Enviar`.
13. Se precisar cancelar um item, usar `Cancelar` e informar o motivo.

Pontos importantes:

- A observacao fica presa ao item, nao a mesa inteira.
- Antes de enviar, ainda e possivel ajustar quantidade e observacao.
- Depois de enviado, a cozinha recebe o item com as observacoes.
- Cancelamentos ficam registrados no historico operacional.

Exercicio:

Abrir uma mesa com 6 pessoas, adicionar um prato `sem cebola`, outro `bem passado`, e enviar para cozinha.

## Aula 6: Fluxo da cozinha

Objetivo: ensinar como acompanhar producao.

Onde fica:

- Aba `Cozinha`.

Passos:

1. Ver os itens por praca.
2. Clicar em `Iniciar` quando comecar o preparo.
3. Clicar em `Pronto` quando o item estiver pronto.
4. Usar `Ver mesa` quando precisar voltar para o pedido da mesa.

Pontos importantes:

- A cozinha deve manter o status atualizado.
- Observacoes do prato aparecem no ticket.
- Itens atrasados impactam a gestao.

Exercicio:

Receber dois pedidos, iniciar um, marcar outro como pronto e conferir o status na mesa. Depois simular um cancelamento com motivo.

## Aula 7: Fechamento de conta

Objetivo: ensinar caixa e garcom a fechar mesa corretamente.

Onde fica:

- Aba `Conta`.

Passos:

1. Selecionar a mesa.
2. Conferir itens.
3. Escolher visualizacao:
   - total;
   - por pessoa;
   - por item.
4. Selecionar metodo de pagamento.
5. Informar o valor pago.
6. Clicar em `Registrar pagamento`.
7. Conferir saldo restante.
8. Quando estiver quitado, clicar em `Liberar mesa`.

Pontos importantes:

- A mesa so deve ser liberada depois do pagamento.
- Pagamentos parciais podem ser registrados.
- A conta inclui servico de 10%.

Exercicio:

Fechar uma mesa com pagamento parcial em dinheiro e restante em Pix.

## Aula 8: Gestao do turno

Objetivo: ensinar gerente e administrador a acompanhar a operacao.

Onde fica:

- Aba `Gestao`.

O que acompanhar:

- Mesas ativas.
- Ticket medio.
- Pedidos prontos.
- Atrasos.
- Risco operacional.
- Itens mais vendidos.
- Historico operacional.

Como agir:

- Se houver atraso, abrir a mesa e verificar pedido.
- Se houver chamado, orientar atendimento.
- Usar itens mais vendidos para orientar equipe e cardapio.
- Conferir o historico para ver quem abriu mesa, enviou pedido, cancelou item, registrou pagamento ou alterou configuracoes.

Exercicio:

Simular uma mesa ativa, marcar pedido como pronto e verificar os indicadores.

## Aula 9: Integracoes

Objetivo: explicar configuracoes comerciais.

Onde fica:

- Aba `Integracoes`.

Recursos:

- Impressora de producao.
- Pagamentos.
- KDS externo.

Passos:

1. Ativar a integracao desejada.
2. Informar endpoint ou provedor.
3. Clicar em `Salvar`.
4. Usar `Testar` para confirmar resposta.

Pontos importantes:

- Integracoes devem ser configuradas por admin ou gerente.
- Para venda real, testar antes do turno.
- Em producao, usar HTTPS e credenciais reais.

## Aula 10: Modo offline e sincronizacao

Objetivo: ensinar a equipe a continuar operando quando houver queda de internet ou instabilidade na API.

Onde aparece:

- Barra superior do app.
- Indicador `Sincronizado`, `Offline` ou pendencias.
- Botao `Sincronizar`, quando houver fila pendente e conexao disponivel.

Como funciona:

1. Se a conexao cair, o app mostra modo offline.
2. O garcom pode continuar lancando pedidos e alteracoes no aparelho.
3. As alteracoes ficam salvas localmente.
4. Quando a conexao volta, o app tenta sincronizar automaticamente.
5. Se ainda houver pendencia, clicar em `Sincronizar`.

Pontos importantes:

- O primeiro login precisa ter acontecido com conexao para existir sessao e dados locais.
- A fila offline guarda o ultimo estado operacional pendente.
- Antes de trocar de aparelho, confirme que o topo esta como `Sincronizado`.
- Para uso real, teste a rede do salao antes do primeiro turno.

Exercicio:

Abrir uma mesa, simular queda de internet pelo navegador, adicionar um pedido, voltar a conexao e confirmar que a pendencia foi sincronizada.

## Roteiro de treinamento rapido

Tempo total: 45 minutos.

1. 5 min: login e troca de operador.
2. 5 min: tipos de acesso.
3. 5 min: mesas do salao.
4. 10 min: cadastro de produtos.
5. 10 min: pedido com observacoes.
6. 5 min: cozinha.
7. 5 min: conta e pagamento.

## Checklist de liberacao para uso real

- Primeiro administrador criado.
- Tipos de acesso revisados.
- Operadores cadastrados com PIN individual.
- Mesas reais cadastradas.
- Cardapio real cadastrado.
- Produtos indisponiveis revisados.
- Alergenicos preenchidos.
- Equipe treinada no fluxo de pedido.
- Cozinha treinada no status de producao.
- Caixa treinado em pagamento parcial e fechamento.
- Cancelamento de item testado com motivo obrigatorio.
- Historico operacional revisado na Gestao.
- Modo offline/PWA testado no aparelho usado pelos garcons.
- Backup configurado.
- API e frontend testados antes do turno.

## Duvidas frequentes

### A aba Pedido esta vazia

Cadastre uma mesa no `Salao` e abra a mesa antes de lancar pedido.

### O produto nao aparece no pedido

Verifique se ele esta cadastrado, disponivel e na categoria selecionada. Use a busca para localizar.

### Nao consigo excluir um tipo de acesso

Perfis padrao nao podem ser excluidos. Se for perfil personalizado, verifique se algum operador ainda usa esse perfil.

### Nao consigo liberar mesa

A mesa so e liberada quando existe pedido e o saldo restante esta quitado.

### A cozinha nao ve o pedido

Confirme se o garcom clicou em `Enviar` na comanda.

### Nao consigo cancelar pedido, liberar mesa ou editar produto

Revise o tipo de acesso na aba `Gestao`. A pessoa precisa ter a aba correta e a permissao de acao correspondente.

### O app ficou offline

Continue operando se o usuario ja estava logado. Quando a conexao voltar, aguarde a sincronizacao automatica ou clique em `Sincronizar`.

## Avaliacao pratica

Cada participante deve conseguir executar:

- login com seu operador;
- abrir uma mesa;
- ajustar quantidade de pessoas;
- adicionar pedido com observacao;
- enviar para cozinha;
- atualizar status na cozinha;
- registrar pagamento;
- liberar mesa.

Admin e gerente tambem devem conseguir:

- criar tipo de acesso;
- cadastrar mesa;
- cadastrar e editar produto;
- tornar produto indisponivel;
- consultar indicadores de gestao;
- revisar historico operacional;
- liberar permissoes por acao somente para perfis autorizados.
