import { useQuery } from '@tanstack/react-query';
import apiClient from '../api/client';

export function useSettings() {
  return useQuery<Record<string, string>>({
    queryKey: ['settings'],
    queryFn: () => apiClient.get('/settings').then((r) => r.data),
    staleTime: 60_000,
  });
}
