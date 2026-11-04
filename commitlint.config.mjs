// Conventional Commits em português. O formato é o que o repositório já usa: `tipo(âmbito): resumo`.
// As regras valem localmente (hook commit-msg) e no CI (commits do PR e título do PR).

const SCOPES = [
  // módulos da API
  'auth', 'tutors', 'guardians', 'bookings', 'payments', 'reputation', 'admin', 'activity', 'contents', 'notifications',
  // aplicações e pacotes
  'api', 'web', 'mobile', 'types',
  // transversais
  'db', 'ci', 'docs', 'deps', 'contract', 'repo', 'docker', 'security',
];

// A mensagem nunca pode trazer assinatura de assistentes de IA (regra do repositório).
// Só apanha assinaturas, não menções: escrever sobre o ficheiro CLAUDE.md é legítimo.
const SIGNATURES = [
  /co-authored-by:.*(claude|anthropic|copilot|chatgpt|openai|gemini)/i,
  /signed-off-by:.*(claude|anthropic|copilot|chatgpt|openai|gemini)/i,
  /noreply@anthropic\.com/i,
  /generated (with|by) .*(claude|copilot|chatgpt|openai|gemini|\bai\b)/i,
  /\bai[- ]generated\b/i,
  /🤖\s*generated/iu, // o rodapé típico: "🤖 Generated with …"; o emoji sozinho não é uma assinatura
];

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-assistant-signature': (parsed) => {
          const text = parsed.raw ?? '';
          const hit = SIGNATURES.find((re) => re.test(text));
          return [!hit, 'a mensagem não pode conter assinatura de assistentes de IA (Co-Authored-By, "Generated with…", 🤖…)'];
        },
      },
    },
  ],
  rules: {
    'no-assistant-signature': [2, 'always'],
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']],
    'scope-enum': [2, 'always', SCOPES],
    'scope-case': [2, 'always', 'lower-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    // Mensagens em português começam muitas vezes por maiúscula de nomes próprios (SvelteKit, OpenAPI…)
    'subject-case': [0],
    'header-max-length': [2, 'always', 100],
    'body-leading-blank': [2, 'always'],
    'body-max-line-length': [1, 'always', 120],
    'footer-leading-blank': [1, 'always'],
  },
};
