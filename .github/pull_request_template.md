<!--
O título do PR tem de seguir Conventional Commits em português (passa a ser a mensagem do commit na main):
  feat(bookings): limitar aulas em grupo a 7 alunos      fix(auth): …      docs: …      chore(deps): …
Sem assinaturas de assistentes de IA no título, na descrição ou nos commits.
-->

## O quê e porquê

<!-- O problema ou o requisito (RF-/RN-/RNF-…) e a abordagem. O "porquê" importa mais do que o "como". -->

## Como verificar

<!-- Passos ou comandos para rever/testar. -->

## Verificações

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` e `pnpm test:int` passam localmente (ou explico porque não)
- [ ] Regras de negócio/segurança novas têm teste de **integração**; as de concorrência foram validadas por **mutação**
- [ ] Mexi em rotas ou schemas → corri `pnpm contract:build` e fiz commit de `openapi.json` e `packages/api-types`
- [ ] Mexi em `schema.prisma` → migração **aditiva e reversível**, sem *drift*
- [ ] Docs/README actualizados (e os pressupostos assumidos estão escritos)

## Segurança e privacidade

- [ ] Rota nova: `authenticate` + `authorize(…)`, propriedade do recurso, e entrada em `protected-routes.ts`
- [ ] Dados de menores: consentimento (`requireConsent`) e auditoria dos acessos
- [ ] Admin: `requireMfa`/`requireRecentMfa`; alterações de papéis só por pedido + aprovação de outro admin
- [ ] Nada de segredos, tokens ou dados pessoais em código, logs, respostas ou mensagens de erro
- [ ] Sem campos novos nas respostas que não estejam no contrato

## Dependências do cliente

<!-- Decisão em aberto (gateway, preços, políticas…)? Qual o pressuposto e onde está documentado? "Não se aplica" se não houver. -->

## Notas para quem revê

<!-- O que merece mais atenção; decisões que quer discutir; o que ficou de fora de propósito. -->
