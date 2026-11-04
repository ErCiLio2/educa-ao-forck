import { vi } from 'vitest';

// Testes unitários não têm Redis: o `authenticate` consulta-o (sessões revogadas) e ficaria à espera.
// Os testes de integração usam o Redis real; aqui basta um stub sem sessões revogadas.
vi.mock('../src/shared/core/redis', () => ({
  default: {
    get: async () => null,
    set: async () => 'OK',
    del: async () => 0,
    incr: async () => 1,
    expire: async () => 1,
    eval: async () => [0, 0],
    on: () => undefined,
    quit: async () => 'OK',
  },
}));
