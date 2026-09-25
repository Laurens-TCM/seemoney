// Query hooks for household data. Keys include the household id so a sign-out never shows stale data.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { LIVE_TABLES, subscribeHousehold } from '../lib/realtime';
import { loadBusinessOwed, loadDismissed, loadGoals, loadHousehold, loadImports, loadLines, loadOverrides, loadTrips, loadUserSettings, saveUserSettings, type UserSettings } from '../lib/store';
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

export const useOverrides = (householdId: string | undefined) =>
  useQuery({ queryKey: ['overrides', householdId], queryFn: () => loadOverrides(supabase, householdId!), enabled: !!householdId });

export const useTrips = (householdId: string | undefined) =>
  useQuery({ queryKey: ['trips', householdId], queryFn: () => loadTrips(supabase, householdId!), enabled: !!householdId });

export function useUserSettings(householdId: string | undefined) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const queryClient = useQueryClient();
  const key = ['user-settings', householdId, userId];
  const q = useQuery({ queryKey: key, queryFn: () => loadUserSettings(supabase, householdId!, userId!), enabled: !!householdId && !!userId });
  // The choice shows straight away (controls stay in step with the click); saving happens behind it.
  const [chosen, setChosen] = useState<UserSettings | null>(null);
  const save = useMutation({
    mutationFn: (s: UserSettings) => saveUserSettings(supabase, householdId!, userId!, s),
    onSuccess: (_r, s) => queryClient.setQueryData(key, s),
  });
  const settings = chosen ?? q.data ?? { hideTrips: null, windowMonths: 12 as const };
  return { settings, save: (s: UserSettings) => { setChosen(s); save.mutate(s); }, saveError: save.error };
}

export const useBusinessOwed = (householdId: string | undefined) =>
  useQuery({ queryKey: ['business-owed', householdId], queryFn: () => loadBusinessOwed(supabase, householdId!), enabled: !!householdId });

export const useDismissed = (householdId: string | undefined) =>
  useQuery({ queryKey: ['dismissed', householdId], queryFn: () => loadDismissed(supabase, householdId!), enabled: !!householdId });

export const useGoals = (householdId: string | undefined) =>
  useQuery({ queryKey: ['goals', householdId], queryFn: () => loadGoals(supabase, householdId!), enabled: !!householdId });

/** Keeps both phones in step: refetches whatever the other person just changed. */
export function useLiveUpdates(householdId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!householdId) return;
    return subscribeHousehold(supabase, householdId, table => {
      for (const key of LIVE_TABLES[table] ?? []) void queryClient.invalidateQueries({ queryKey: [key, householdId] });
    });
  }, [householdId, queryClient]);
}
