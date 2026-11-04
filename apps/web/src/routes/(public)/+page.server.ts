import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { PUBLIC_API_URL } from '$env/static/public';

type Tutor = {
  id: string;
  fullName: string;
  subjects: string[];
  averageRating: number | null;
  hourlyRate: number | null;
  avatarUrl: string | null;
};

export const load: PageServerLoad = async ({ locals, fetch }) => {
  if (locals.user?.role === 'ADMIN') redirect(302, '/dashboard');

  let featuredTutors: Tutor[] = [];
  try {
    const res = await fetch(`${PUBLIC_API_URL}/api/v1/tutors/public?limit=4&sort=rating`);
    if (res.ok) {
      const body = await res.json();
      featuredTutors = body.tutors ?? [];
    }
  } catch {
    // API indisponível — mostra landing sem tutores em destaque
  }

  return { featuredTutors };
};
