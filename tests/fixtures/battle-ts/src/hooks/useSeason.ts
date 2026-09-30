import { useEffect, useState } from 'react';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export function seasonOf(month: number): Season {
  if (month >= 2 && month <= 4) return 'spring';
  if (month >= 5 && month <= 7) return 'summer';
  if (month >= 8 && month <= 10) return 'autumn';
  return 'winter';
}

export function useSeason(clock: () => number): Season {
  const [season, setSeason] = useState<Season>(() => seasonOf(clock()));
  useEffect(() => {
    const timer = setInterval(() => setSeason(seasonOf(clock())), 60000);
    return () => clearInterval(timer);
  }, [clock]);
  return season;
}
