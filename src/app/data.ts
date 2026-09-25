// Query hooks for household data. Keys include the household id so a sign-out never shows stale data.
import { useQuery } from '@tanstack/react-query';
import { loadHousehold, loadImports, loadLines } from '../lib/store';
import { supabase } from '../lib/supabase';
import { useAuth } from './auth';

export function useHousehold() {
  const { session } = useAuth();
  const userId = session?.user.id;
  const q = useQuery({ queryKey: ['household', userId], queryFn: () => loadHousehold(supabase), enabled: !!userId });
  const me = q.data?.members.find(m => m.userId === userId) ?? null;
  return { ...q, household: q.data ?? null, me };
}

export const useImports = (householdId: string | undefined) =>
  useQuery({ queryKey: ['imports', householdId], queryFn: () => loadImports(supabase, householdId!), enabled: !!householdId });

export const useLines = (householdId: string | undefined) =>
  useQuery({ queryKey: ['lines', householdId], queryFn: () => loadLines(supabase, householdId!), enabled: !!householdId });
