import type { PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

type Tutor = {
  id: string;
  fullName: string;
  subjects: string[];
  levels: string[];
  averageRating: number | null;
  reviewCount: number;
  hourlyRate: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
};

export const load: PageServerLoad = async ({ url, fetch }) => {
  const q = url.searchParams.get('q') ?? '';
  const disciplina = url.searchParams.get('disciplina') ?? '';
  const nivel = url.searchParams.get('nivel') ?? '';
  const tipo = url.searchParams.get('tipo') ?? '';
  const page = Number(url.searchParams.get('page') ?? '1');
  const limit = 12;

  const params = new URLSearchParams({ limit: String(limit), page: String(page) });
  if (q) params.set('q', q);
  if (disciplina) params.set('disciplina', disciplina);
  if (nivel) params.set('nivel', nivel);
  if (tipo) params.set('tipo', tipo);

  let tutors: Tutor[] = [];
  let total = 0;

  try {
    const res = await fetch(`${PUBLIC_API_URL}/api/v1/tutors?${params}`);
    if (res.ok) {
      const body = await res.json();
      tutors = body.tutors ?? [];
      total = body.total ?? 0;
    }
  } catch {
    // API indisponível — página carrega sem resultados
  }

  return { tutors, total, page, limit, q, disciplina, nivel, tipo };
};
