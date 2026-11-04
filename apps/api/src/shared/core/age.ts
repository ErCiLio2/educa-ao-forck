// Maioridade civil em Angola: 18 anos (a validar juridicamente — RNF-CON-01)
export const MAJORITY_AGE = 18;

export function isAdult(birthDate: Date, now: Date = new Date()): boolean {
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - MAJORITY_AGE);
  return birthDate <= cutoff;
}
