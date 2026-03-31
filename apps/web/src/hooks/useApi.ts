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

export function useUpdateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: any) => api.patch(`/recurring-rules/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-rules'] }),
  });
}

export function useCreateRecurringRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => api.post('/recurring-rules', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recurring-rules'] }),
  });
}

export function useProjectInstances() {
  return useQuery({ queryKey: ['project-instances'], queryFn: () => api.get('/project-instances').then(r => r.data) });
}

export function useProjectTemplates() {
  return useQuery({ queryKey: ['project-templates'], queryFn: () => api.get('/project-templates').then(r => r.data) });
}

export function useFacilities() {
  return useQuery({ queryKey: ['facilities'], queryFn: () => api.get('/facilities').then(r => r.data) });
}

export function useFacilityReservations(facilityId: number) {
  return useQuery({
    queryKey: ['reservations', facilityId],
    queryFn: () => api.get(`/facilities/${facilityId}/reservations`).then(r => r.data),
  });
}

export function useCreateReservation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ facilityId, ...data }: { facilityId: number; title: string; reservedBy: string; startTime: string; endTime: string; notes?: string }) =>
      api.post(`/facilities/${facilityId}/reservations`, data).then(r => r.data),
    onSuccess: (_: unknown, { facilityId }: { facilityId: number }) =>
      qc.invalidateQueries({ queryKey: ['reservations', facilityId] }),
  });
}

export function useMessageThreads() {
  return useQuery({ queryKey: ['message-threads'], queryFn: () => api.get('/message-threads').then(r => r.data) });
}

export function useCreateMessageThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { title: string }) => api.post('/message-threads', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['message-threads'] }),
  });
}

export function useThreadMessages(threadId: number | null) {
  return useQuery({
    queryKey: ['messages', threadId],
    queryFn: () => api.get(`/message-threads/${threadId}/messages`).then(r => r.data),
    enabled: threadId !== null,
  });
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, ...data }: { threadId: number; senderName: string; body: string }) =>
      api.post(`/message-threads/${threadId}/messages`, data).then(r => r.data),
    onSuccess: (_: unknown, { threadId }: { threadId: number }) => {
      qc.invalidateQueries({ queryKey: ['messages', threadId] });
      qc.invalidateQueries({ queryKey: ['message-threads'] });
    },
  });
}
