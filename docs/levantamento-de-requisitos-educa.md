# Levantamento de Requisitos — Plataforma de Explicações Online (Educa)

| | |
|---|---|
| **Empresa** | SOMATEC — Software Marketing Tecnologia (NIF: 5001795830) |
| **Email** | somatecangola@gmail.com |
| **Cliente** | Helder Teixeira Congo |
| **Local e data** | Angola - Luanda, 17 de Setembro de 2026 |
| **Referência** | Levantamento de Requisitos |
| **Base documental** | Escopo Técnico e Funcional Consolidado (Ref. 8), ATB-EDUCA-2026 v1.0 e ATB-EDUCA-2026-R1 |

---

## 1. Objectivo

Este documento consolida o levantamento de requisitos da Plataforma Educa, com o propósito de:

- Registar de forma estruturada os requisitos funcionais e não funcionais da plataforma;
- Identificar as regras de negócio, as integrações externas, os pressupostos e as restrições;
- Estabelecer a rastreabilidade entre casos de uso e requisitos;
- Listar os pontos em aberto que exigem decisão ou validação do cliente.

Os requisitos foram consolidados a partir da documentação existente do projecto — Escopo Técnico e Funcional Consolidado (Ref. 8), ATB-EDUCA-2026 v1.0 e ATB-EDUCA-2026-R1 — e devem ser validados com o cliente antes do congelamento. Nenhuma alteração de escopo funcional é proposta.

---

## 2. Contexto e Visão Geral da Plataforma

A Educa é uma plataforma de explicações online que liga alunos a tutores, com aulas individuais (1-on-1) ou em grupo (máximo de 7 estudantes), pagamento por pacotes de horas e verificação documental dos tutores. Inclui perfis para menores de idade, que actuam sob a responsabilidade de um Encarregado de Educação.

Decisões tecnológicas já estabelecidas:

- Monólito Modular em Node.js/TypeScript, com Prisma e PostgreSQL;
- SvelteKit para o back-office web e Flutter para a aplicação móvel (Alunos/Tutores);
- Redis e BullMQ para cache, filas e rate limiting; CDN e object storage privado para conteúdo e documentos;
- Módulos: `auth`, `tutors`, `bookings`, `payments`, `reputation`, `contents_datalite` e `shared/core`.

---

## 3. Partes Interessadas e Perfis de Utilizador

| Actor | Natureza | Necessidades principais |
|---|---|---|
| Aluno | Interno | Pesquisar tutores, agendar e participar em aulas, pagar, avaliar tutores e consultar o seu histórico. |
| Encarregado de Educação | Interno | Autorizar o tratamento de dados do menor, efectuar pagamentos e acompanhar a actividade do dependente. |
| Tutor / Explicador | Interno | Submeter documentos de verificação, prestar aulas, gerir conteúdos e consultar métricas. |
| Administrador | Interno | Aprovar ou rejeitar tutores, gerir utilizadores e conteúdos, e consultar métricas. |
| Gateway de Pagamento | Externo | Proxypay, PayPay ou Kwanza Online: processar e confirmar pagamentos. |
| Serviço de Videoconferência | Externo | Zoom, Teams ou WebRTC leve: orquestrar as salas virtuais das aulas. |

---

## 4. Requisitos Funcionais

Os requisitos funcionais estão agrupados por módulo. A coluna **Origem** indica o caso de uso ou o documento de referência (ATB-R1 = ATB-EDUCA-2026-R1). A prioridade é uma proposta, sujeita a validação.

### 4.1 Autenticação e Contas

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-AUT-01 | O sistema deve permitir autenticar-se e manter sessão segura (JWT de curta duração e refresh token). | Todos os perfis | UC01 | Alta |
| RF-AUT-02 | O sistema deve segregar quatro perfis de utilizador: Aluno, Encarregado de Educação, Tutor e Administrador. | Todos os perfis | ATB-R1 5.3 | Alta |
| RF-AUT-03 | O sistema deve permitir associar um aluno menor a um Encarregado de Educação, como dependente. | Encarregado, Aluno | UC13 | Alta |
| RF-AUT-04 | O utilizador deve poder gerir o seu perfil. | Aluno, Encarregado, Tutor | UC02 | Média |

### 4.2 Tutores e Verificação

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-TUT-01 | O tutor deve poder submeter documentos de verificação (diploma, registo criminal, fotografia tipo passe e vídeo de apresentação). | Tutor | UC09 | Alta |
| RF-TUT-02 | O Administrador deve poder aprovar ou rejeitar tutores, actualizando o estado (PENDING, APPROVED, REJECTED), com registo em auditoria. | Administrador | UC10 | Alta |
| RF-TUT-03 | O perfil do tutor deve apresentar a média de avaliação, o total de avaliações, de aulas e de alunos. | Tutor, Aluno | ATB-R1 5.2 | Média |

### 4.3 Catálogo e Pesquisa

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-CAT-01 | O aluno deve poder pesquisar tutores e consultar o catálogo. | Aluno | UC03 | Alta |

### 4.4 Aulas e Agendamento

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-AUL-01 | O aluno deve poder agendar uma aula individual (1-on-1) ou em grupo. | Aluno | UC04 | Alta |
| RF-AUL-02 | O sistema deve limitar cada aula em grupo a um máximo de 7 estudantes. | Aluno, Tutor | ATB-R1 5.3 | Alta |
| RF-AUL-03 | O agendamento deve exigir autenticação e um pacote de horas disponível. | Aluno | UC04 | Alta |
| RF-AUL-04 | O sistema deve registar a matrícula do aluno na aula e o respectivo estado de presença. | Aluno, Tutor | UC04 | Alta |
| RF-AUL-05 | O aluno e o tutor devem poder participar na aula numa sala virtual orquestrada pelo serviço de videoconferência. | Aluno, Tutor | UC05, UC15 | Alta |
| RF-AUL-06 | As salas de aula devem suportar whiteboard e notificações em tempo real. | Aluno, Tutor | ATB-R1 2.2 | Média |

### 4.5 Pagamentos e Pacotes de Horas

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-PAG-01 | O aluno ou o encarregado deve poder efectuar pagamento através de uma referência gerada no gateway seleccionado. | Aluno, Encarregado | UC06 | Alta |
| RF-PAG-02 | O sistema deve confirmar o pagamento a partir do webhook do gateway e libertar o pacote de horas correspondente. | Gateway | UC06, UC14, Escopo IV.7 | Alta |
| RF-PAG-03 | O utilizador deve poder consultar o saldo de horas do pacote e, quando definida, a sua validade. | Aluno, Encarregado | ATB-R1 5.4 | Média |
| RF-PAG-04 | O sistema deve gerir os estados do pagamento (PENDING, CONFIRMED, FAILED, REFUNDED), incluindo reembolsos. | Administrador | ATB-R1 5.4 | Média |

### 4.6 Avaliações e Reputação

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-AVA-01 | O aluno deve poder avaliar o tutor de 1 a 5 estrelas, com os critérios pontualidade, domínio da matéria, clareza didáctica e progresso, e comentário opcional. | Aluno | UC07 | Média |

### 4.7 Histórico e Métricas

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-HIS-01 | O sistema deve permitir consultar o histórico de actividade e as métricas, de acordo com o perfil do utilizador. | Aluno, Encarregado, Tutor, Administrador | UC08 | Média |

### 4.8 Encarregado de Educação e Consentimento

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-ENC-01 | O encarregado deve poder consentir o tratamento dos dados do menor, ficando o consentimento registado e auditável. | Encarregado | UC13, Escopo IV.8 | Alta |
| RF-ENC-02 | O encarregado deve poder revogar o consentimento, ficando registada a data de revogação. | Encarregado | ATB-R1 5.4 | Alta |
| RF-ENC-03 | O encarregado deve poder acompanhar a actividade dos seus dependentes. | Encarregado | ATB-R1 5.3 | Média |

### 4.9 Conteúdos Pedagógicos e Modo Data-Lite

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-CON-01 | O tutor e o Administrador devem poder gerir conteúdos pedagógicos. | Tutor, Administrador | UC11 | Média |
| RF-CON-02 | O sistema deve servir vídeo e materiais em qualidade reduzida (360p/480p) no modo Data-Lite. | Aluno, Tutor | ATB-R1 2.5 | Média |
| RF-CON-03 | O conteúdo pago deve ser protegido contra pirataria através de DPM. | Aluno | ATB-R1 3.6 | Alta |

### 4.10 Administração

| ID | Requisito | Actor(es) | Origem | Prioridade (proposta) |
|---|---|---|---|---|
| RF-ADM-01 | O Administrador deve poder gerir utilizadores. | Administrador | UC12 | Alta |
| RF-ADM-02 | As acções administrativas sensíveis devem ficar registadas num registo de auditoria imutável. | Administrador | ATB-R1 3.6 | Alta |

---

## 5. Requisitos Não Funcionais

| ID | Categoria | Requisito | Referência |
|---|---|---|---|
| RNF-SEG-01 | Segurança | Access tokens JWT de 10–15 minutos e refresh token rotativo, com detecção de reutilização. | ATB-R1 3.2 |
| RNF-SEG-02 | Segurança | Controlo de acesso RBAC com verificação de propriedade do recurso. | ATB-R1 3.2 |
| RNF-SEG-03 | Segurança | Dados em trânsito (TLS) e em repouso protegidos; campos de identificação encriptados ao nível da aplicação; documentos em bucket privado com URLs assinadas. | ATB-R1 3.3 |
| RNF-SEG-04 | Segurança | Verificação de assinatura e idempotência em todos os webhooks de pagamento. | ATB-R1 3.5 |
| RNF-SEG-05 | Segurança | Nenhum dado de cartão ou de conta armazenado pela Educa. | ATB-R1 3.5 |
| RNF-SEG-06 | Segurança | MFA e segregação de funções nas acções administrativas sensíveis. | ATB-R1 3.2 |
| RNF-ESC-01 | Escalabilidade | API stateless, com múltiplas réplicas atrás de um balanceador de carga. | ATB-R1 2.2 |
| RNF-ESC-02 | Escalabilidade | Cache, filas e rate limiting distribuído em Redis/BullMQ; processamento de vídeo assíncrono. | ATB-R1 2.3 |
| RNF-ESC-03 | Escalabilidade | PostgreSQL com PgBouncer, índices dirigidos e réplicas de leitura para relatórios. | ATB-R1 2.4 |
| RNF-DES-01 | Desempenho e acessibilidade | Modo Data-Lite para redes com largura de banda limitada, com entrega por CDN. | ATB-R1 2.5 |
| RNF-DIS-01 | Disponibilidade | Health-checks por módulo e implantação sem indisponibilidade (rolling deploy, migrações Prisma aditivas e reversíveis). | ATB-R1 2.2, 2.4 |
| RNF-MAN-01 | Manutenibilidade | Fronteiras de módulo impostas por regras de lint em CI; comunicação entre módulos por eventos internos. | ATB-R1 2.1 |
| RNF-PLA-01 | Plataformas | Aplicação móvel Flutter (Alunos/Tutores) e back-office web em SvelteKit. | ATB-R1 7 |
| RNF-CON-01 | Conformidade | Alinhamento com ISO/IEC 27001, 27034, 25010, 29100, 27017/27018 e com a legislação angolana de protecção de dados pessoais, sujeito a validação jurídica. | ATB-R1 4 |

---

## 6. Regras de Negócio

| ID | Regra de negócio |
|---|---|
| RN-01 | Uma aula em grupo tem no máximo 7 estudantes. |
| RN-02 | Um aluno menor deve estar associado a um Encarregado de Educação, e os seus dados só são tratados após consentimento. |
| RN-03 | O pacote de horas só é libertado após a confirmação do pagamento. |
| RN-04 | O agendamento de uma aula exige um pacote de horas disponível. |
| RN-05 | O estado de verificação do tutor só pode ser alterado pelo Administrador, após revisão dos documentos submetidos. |
| RN-06 | As avaliações são de 1 a 5 estrelas, com critérios pedagógicos definidos. |
| RN-07 | Uma transacção de pagamento origina, no máximo, um pacote de horas. |
| RN-08 | Reembolsos e alterações de papéis exigem MFA e segregação de funções. |

---

## 7. Interfaces e Integrações Externas

| Sistema | Finalidade | Observações |
|---|---|---|
| Gateway de pagamento | Geração de referências e confirmação de pagamentos. | Proxypay, PayPay ou Kwanza Online; webhooks com assinatura verificada. |
| Videoconferência | Salas virtuais das aulas. | Zoom, Teams ou WebRTC leve; escolha final por confirmar. |
| CDN | Entrega de vídeo e materiais. | URLs assinadas de curta duração. |
| Object storage | Documentos dos tutores e conteúdos. | Compatível com S3, privado. |
| Serviço de segredos | Gestão de chaves e credenciais. | AWS Secrets Manager ou HashiCorp Vault. |

---

## 8. Modelo de Dados de Alto Nível

As entidades principais, detalhadas na secção 5 do ATB-EDUCA-2026-R1, são:

- `User`, `TutorProfile`, `ClassSession`, `ClassEnrollment` e `Review`;
- `PaymentTransaction` e `HourPackage`, para pagamentos e pacotes de horas;
- `GuardianConsent`, para o consentimento do encarregado;
- `AuditLog`, para o registo de auditoria imutável.

---

## 9. Pressupostos e Restrições

- A arquitectura de Monólito Modular e a stack tecnológica estão decididas e não fazem parte do levantamento;
- O escopo funcional é o do Escopo Técnico e Funcional Consolidado (Ref. 8); qualquer extensão segue a Secção X (Limites e Gestão de Alterações);
- Existem menores de idade como utilizadores, o que condiciona o tratamento de dados e o acesso;
- A disponibilidade dos gateways de pagamento e do serviço de videoconferência depende de terceiros;
- O limite de 7 estudantes por grupo é uma restrição de negócio e técnica.

---

## 10. Riscos

| Risco | Impacto | Mitigação |
|---|---|---|
| Tratamento indevido de dados de menores | Legal e reputacional | Consentimento auditável do encarregado, minimização de dados e controlo de acesso. |
| Pirataria de conteúdo pago | Perda de receita | DPM com tokens de streaming assinados e URLs de curta duração. |
| Duplicação da libertação de pacotes de horas | Perda financeira | Idempotência e verificação de assinatura nos webhooks. |
| Acoplamento entre módulos | Dificuldade de evolução | Fronteiras impostas por lint e comunicação por eventos. |
| Largura de banda limitada dos utilizadores | Baixa adopção | Modo Data-Lite (360p/480p) e entrega por CDN. |
| Dependência de fornecedores externos | Indisponibilidade de pagamentos ou aulas | Gestão de fornecedores (ISO/IEC 27001) e monitorização de integrações. |

---

## 11. Pontos em Aberto a Validar com o Cliente

Os pontos seguintes não estão definidos na documentação disponível e exigem decisão do cliente:

- Preços, composição, moeda e validade dos pacotes de horas;
- Política de cancelamento, reagendamento e reembolso;
- Modelo de remuneração dos tutores;
- Canal de acesso do Encarregado de Educação (aplicação móvel, web ou ambos);
- Canais de notificação (aplicação, email, SMS);
- Gateway(s) de pagamento e serviço de videoconferência a adoptar;
- Critérios de aprovação de tutores e estrutura do catálogo (disciplinas e níveis);
- Idiomas suportados;
- Volumetria esperada (utilizadores e aulas em simultâneo), para dimensionamento;
- Bases legais e prazos de retenção de dados pessoais.

---

## 12. Rastreabilidade entre Casos de Uso e Requisitos

| Caso de uso | Requisitos associados |
|---|---|
| UC01 Autenticar-se | RF-AUT-01 |
| UC02 Gerir Perfil | RF-AUT-04 |
| UC03 Pesquisar Tutores / Catálogo | RF-CAT-01 |
| UC04 Agendar Aula (1-on-1 / Grupo) | RF-AUL-01, RF-AUL-02, RF-AUL-03, RF-AUL-04 |
| UC05 Participar em Aula | RF-AUL-05, RF-AUL-06 |
| UC06 Efectuar Pagamento | RF-PAG-01, RF-PAG-02, RF-PAG-03, RF-PAG-04 |
| UC07 Avaliar Tutor | RF-AVA-01 |
| UC08 Consultar Histórico e Métricas | RF-HIS-01 |
| UC09 Submeter Documentos de Verificação | RF-TUT-01 |
| UC10 Aprovar / Rejeitar Tutor | RF-TUT-02, RF-ADM-02 |
| UC11 Gerir Conteúdos Pedagógicos | RF-CON-01 |
| UC12 Gerir Utilizadores | RF-ADM-01 |
| UC13 Consentir Dados do Menor | RF-AUT-03, RF-ENC-01, RF-ENC-02 |
| UC14 Processar Pagamento | RF-PAG-02 |
| UC15 Orquestrar Sala Virtual | RF-AUL-05 |

---

## 13. Validação e Aprovação

Os requisitos serão verificados através dos testes funcionais e de segregação de perfis previstos na Secção IV.9 do Escopo Consolidado, incluindo testes de autorização e de idempotência de webhooks. Após a resolução dos pontos em aberto, o documento será submetido à aprovação formal do cliente e passará a ser a base para o controlo de alterações.

| Parte | Nome | Assinatura | Data |
|---|---|---|---|
| Pela SOMATEC | | | |
| Pelo Cliente | Helder Teixeira Congo | | |

*Este documento deve ser revisto sempre que houver alterações de escopo, decisões sobre os pontos em aberto ou mudanças relevantes na arquitectura.*
