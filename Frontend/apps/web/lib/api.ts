import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ─── Axios instance ───────────────────────────────────────────────────────────
export const apiClient = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// ─── Request interceptor — attach JWT ────────────────────────────────────────
apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ─── Response interceptor — handle 401 / token refresh ───────────────────────
let isRefreshing = false;
let refreshSubscribers: Array<(token: string) => void> = [];

function subscribeTokenRefresh(cb: (token: string) => void) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            resolve(apiClient(originalRequest));
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = getRefreshToken();
        if (!refreshToken) throw new Error('No refresh token');

        const res = await axios.post(`${API_BASE}/api/v1/auth/refresh`, {
          refreshToken,
        });

        const { accessToken, refreshToken: newRefreshToken } = res.data.data;
        setTokens(accessToken, newRefreshToken);
        onRefreshed(accessToken);

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        return apiClient(originalRequest);
      } catch {
        clearTokens();
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// ─── Token storage helpers ────────────────────────────────────────────────────
const ACCESS_TOKEN_KEY = 'nexus_access_token';
const REFRESH_TOKEN_KEY = 'nexus_refresh_token';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setTokens(accessToken: string, refreshToken: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
}

// ─── API response types ───────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: { code: string; message: string; details?: unknown[] };
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}

// ─── API methods ──────────────────────────────────────────────────────────────
export const api = {
  // Auth
  auth: {
    login: (email: string, password: string) =>
      apiClient.post<
        ApiResponse<{
          accessToken: string;
          refreshToken: string;
          user: User;
        }>
      >('/auth/login', { email, password }),

    register: (data: RegisterData) =>
      apiClient.post<ApiResponse<{ user: User; tenant: Tenant }>>('/auth/register', data),

    logout: (refreshToken: string) => apiClient.delete('/auth/logout', { data: { refreshToken } }),

    me: () => apiClient.get<ApiResponse<{ user: User }>>('/auth/me'),

    refresh: (refreshToken: string) =>
      apiClient.post<ApiResponse<{ accessToken: string; refreshToken: string }>>('/auth/refresh', {
        refreshToken,
      }),

    changePassword: (currentPassword: string, newPassword: string) =>
      apiClient.patch('/auth/change-password', { currentPassword, newPassword }),
  },

  // Dashboard
  dashboard: {
    metrics: () => apiClient.get<ApiResponse<DashboardMetrics>>('/dashboard/metrics'),
    incidents: (params?: { limit?: number; severity?: string }) =>
      apiClient.get<ApiResponse<{ incidents: Incident[]; count: number }>>('/dashboard/incidents', {
        params,
      }),
    activity: (limit?: number) => apiClient.get('/dashboard/activity', { params: { limit } }),
  },

  // Agents
  agents: {
    list: () => apiClient.get<ApiResponse<{ agents: Agent[]; count: number }>>('/agents'),
    get: (id: string) => apiClient.get<ApiResponse<{ agent: Agent }>>(`/agents/${id}`),
    run: (id: string, task: string) =>
      apiClient.post<ApiResponse<AgentTaskResult>>(`/agents/${id}/run`, { task }),
    executions: (id: string, limit?: number) =>
      apiClient.get(`/agents/${id}/executions`, { params: { limit } }),
    updateConfig: (id: string, config: Partial<Agent>) => apiClient.patch(`/agents/${id}`, config),
    setStatus: (id: string, status: string) => apiClient.patch(`/agents/${id}/status`, { status }),
  },

  // Workflows
  workflows: {
    list: (params?: { enabled?: boolean; page?: number; limit?: number }) =>
      apiClient.get<ApiResponse<{ workflows: Workflow[]; pagination: Pagination }>>('/workflows', {
        params,
      }),
    get: (id: string) => apiClient.get<ApiResponse<{ workflow: Workflow }>>(`/workflows/${id}`),
    create: (data: CreateWorkflowData) =>
      apiClient.post<ApiResponse<{ workflow: Workflow }>>('/workflows', data),
    update: (id: string, data: Partial<Workflow>) =>
      apiClient.patch<ApiResponse<{ workflow: Workflow }>>(`/workflows/${id}`, data),
    toggle: (id: string, enabled: boolean) =>
      apiClient.patch(`/workflows/${id}/toggle`, { enabled }),
    trigger: (id: string, payload?: Record<string, unknown>) =>
      apiClient.post(`/workflows/${id}/trigger`, { payload }),
    delete: (id: string) => apiClient.delete(`/workflows/${id}`),
    executions: (id: string) => apiClient.get(`/workflows/${id}/executions`),
    dlq: () => apiClient.get('/workflows/dlq'),
  },

  // Approvals
  approvals: {
    list: (params?: { status?: string; risk?: string; page?: number }) =>
      apiClient.get<ApiResponse<{ approvals: Approval[]; pagination: Pagination }>>('/approvals', {
        params,
      }),
    get: (id: string) => apiClient.get<ApiResponse<{ approval: Approval }>>(`/approvals/${id}`),
    review: (id: string, action: 'approved' | 'rejected', reviewNote?: string) =>
      apiClient.patch(`/approvals/${id}`, { action, reviewNote }),
    cancel: (id: string) => apiClient.delete(`/approvals/${id}`),
    stats: () => apiClient.get('/approvals/stats'),
  },

  // Integrations
  integrations: {
    list: () => apiClient.get('/integrations'),
    status: (provider: string) => apiClient.get(`/integrations/${provider}/status`),
    sync: (provider: string) => apiClient.post(`/integrations/${provider}/sync`),
    jira: {
      issues: (jql?: string, limit?: number) =>
        apiClient.get('/integrations/jira/issues', { params: { jql, limit } }),
    },
    zendesk: {
      tickets: (params?: { status?: string; priority?: string; days?: number }) =>
        apiClient.get('/integrations/zendesk/tickets', { params }),
    },
    salesforce: {
      accounts: (params?: { filter?: string; limit?: number }) =>
        apiClient.get('/integrations/salesforce/accounts', { params }),
    },
  },

  // RAG
  rag: {
    search: (query: string, options?: { source?: string; limit?: number; mode?: string }) =>
      apiClient.post('/rag/search', { query, ...options }),
    ingestText: (title: string, content: string, source?: string) =>
      apiClient.post('/rag/ingest/text', { title, content, source }),
    documents: () => apiClient.get('/rag/documents'),
    deleteDocument: (documentId: string) => apiClient.delete(`/rag/documents/${documentId}`),
  },

  // Copilot (streaming)
  copilot: {
    chat: async (
      messages: ChatMessage[],
      onChunk: (chunk: string) => void,
      signal?: AbortSignal
    ) => {
      const response = await fetch(`${API_BASE}/api/v1/copilot/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getAccessToken()}`,
        },
        body: JSON.stringify({ messages }),
        signal,
      });

      if (!response.ok) throw new Error('Copilot request failed');

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) return;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        // Parse SSE format
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              if (parsed.text) onChunk(parsed.text);
            } catch {
              onChunk(data);
            }
          }
        }
      }
    },
  },
};

// ─── TypeScript interfaces ────────────────────────────────────────────────────
export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: 'admin' | 'manager' | 'analyst' | 'viewer';
  tenant: Tenant;
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: 'starter' | 'pro' | 'enterprise';
}

export interface RegisterData {
  tenantName: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface DashboardMetrics {
  mrr: number;
  mrrDelta: number;
  churnRiskCount: number;
  openIncidents: number;
  criticalIncidents: number;
  slaCompliance: number;
  pendingApprovals: number;
  runningAgents: number;
  enabledWorkflows: number;
  totalAgentCostUSD: number;
}

export interface Incident {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: string;
  status: string;
  createdAt: string;
}

export interface Agent {
  _id: string;
  name: string;
  type: string;
  status: 'running' | 'idle' | 'error' | 'paused';
  currentTask: string | null;
  totalCostUSD: number;
  totalExecutions: number;
  successRate: number;
  circuitBreaker: { state: string };
}

export interface AgentTaskResult {
  taskId: string;
  agentId: string;
  status: string;
  message: string;
}

export interface Workflow {
  _id: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: { type: string; eventType?: string; schedule?: string };
  steps: WorkflowStep[];
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  successRate: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: string;
  integration: string;
  action: string;
  params: Record<string, unknown>;
}

export interface Approval {
  _id: string;
  action: string;
  detail: string;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  requestedBy: { agentType?: string; source: string };
  reviewedBy?: { firstName: string; lastName: string; email: string };
  reviewedAt?: string;
  reviewNote?: string;
  auditTrail: AuditEntry[];
  createdAt: string;
  expiresAt: string;
}

export interface AuditEntry {
  ts: string;
  action: string;
  actor: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface CreateWorkflowData {
  name: string;
  description?: string;
  trigger: Record<string, unknown>;
  steps: WorkflowStep[];
  enabled?: boolean;
}
