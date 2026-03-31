import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../lib/api';

export function useTasks() {
  return useQuery({ queryKey: ['tasks'], queryFn: () => api.get('/tasks').then(r => r.data) });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/tasks', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export function useRecurringRules() {
  return useQuery({ queryKey: ['recurring-rules'], queryFn: () => api.get('/recurring-rules').then(r => r.data) });
}

export function useProjectInstances() {
  return useQuery({ queryKey: ['project-instances'], queryFn: () => api.get('/project-instances').then(r => r.data) });
}
