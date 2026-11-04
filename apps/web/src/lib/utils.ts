import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Devolve classes de cor para avatar baseadas num hash da string (nome/id). */
export function avatarColor(seed: string): string {
  const palette = [
    'bg-red-400 text-white',
    'bg-emerald-500 text-white',
    'bg-violet-400 text-white',
    'bg-amber-400 text-black',
    'bg-sky-400 text-white',
    'bg-rose-500 text-white',
    'bg-teal-500 text-white',
    'bg-orange-400 text-white',
  ];
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0;
  }
  return palette[Math.abs(h) % palette.length];
}

/** Extrai as iniciais de um nome (máx. 2 letras). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
