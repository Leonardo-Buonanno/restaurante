# Compliance comercial do MesaPro

Este material e um checklist tecnico-operacional. Ele nao substitui revisao juridica, fiscal ou contabil antes da venda.

## Fiscal no Brasil

O MesaPro agora possui configuracao fiscal externa em `Integracoes > Fiscal NFC-e/SAT`.

Como funciona:

- o app nao emite NFC-e/SAT diretamente;
- ao liberar uma mesa quitada, o servidor envia um evento `fiscal.nfce.issue.request` para o endpoint fiscal configurado;
- o endpoint deve ser de um provedor fiscal homologado ou de uma camada propria validada pelo contador/desenvolvedor fiscal;
- se a emissao fiscal estiver desativada, o fechamento continua operacional, mas sem documento fiscal gerado pelo MesaPro.

Antes de vender em producao:

- confirmar com contador quais documentos fiscais se aplicam ao estado e ao modelo do restaurante;
- configurar UF, codigo de municipio e provedor fiscal;
- testar `/api/fiscal/test` e um fechamento real em ambiente de homologacao;
- guardar protocolo/autorizacao fiscal fora do MesaPro ou estender o payload para persistir retorno do provedor.

Fontes oficiais de referencia:

- SEFAZ MS, NFC-e: https://www.sefaz.ms.gov.br/documentos-fiscais-eletronicos/nfc-e/
- SEF SC, NFC-e/PAF-NFC-e: https://www.sef.sc.gov.br/servicos/servico/136/NFC-e

## LGPD

O MesaPro trata dados pessoais de operadores, como nome, perfil de acesso, sessoes e trilha de auditoria. Foram adicionados:

- exportacao administrativa em `GET /api/privacy/export`;
- apagamento de dados operacionais em `DELETE /api/privacy/operational-data`, preservando operadores e perfis;
- controle de acesso por token, PIN com hash PBKDF2 e permissoes por acao;
- backups com criptografia opcional via `BACKUP_ENCRYPTION_KEY`;
- metricas protegidas em producao por rede privada ou `METRICS_TOKEN`.

Antes de vender:

- definir controlador, operador, encarregado e canal de atendimento;
- publicar politica de privacidade e termos comerciais;
- definir prazo de retencao de auditoria/backups;
- registrar quais subprocessadores acessam dados, como hospedagem, fiscal, pagamento e monitoramento;
- documentar procedimento de incidente e restauracao.

Fontes oficiais de referencia:

- ANPD, escopo da LGPD: https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes/perguntas-frequentes/1-lei-geral-de-protecao-de-dados-pessoais-lgpd/1-1-do-que-trata
- Principio de seguranca: https://www.gov.br/saude/pt-br/acesso-a-informacao/lgpd/principios

## Operacao

Variaveis recomendadas para producao:

```text
ALLOWED_HOSTS=app.seudominio.com
CORS_ORIGIN=https://app.seudominio.com
METRICS_TOKEN=valor_longo_aleatorio
METRICS_PUBLIC=false
BACKUP_RETENTION_DAYS=30
BACKUP_ENCRYPTION_KEY=valor_longo_aleatorio
BACKUP_ALERT_WEBHOOK=https://monitoramento.exemplo.com/webhook
```

Checklist minimo por cliente:

- restaurar um backup em ambiente separado antes do primeiro turno;
- testar fechamento de mesa com fiscal habilitado;
- testar queda de internet em um aparelho de garcom;
- criar operadores individuais e remover acessos compartilhados;
- revisar permissoes de perfis personalizados;
- configurar monitoramento para `/api/health`, `/api/ready` e `/api/metrics` com token.
