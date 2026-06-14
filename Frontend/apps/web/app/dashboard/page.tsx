'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/lib/auth';
import { api, DashboardMetrics, Incident, Agent, Approval } from '@/lib/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n: number, prefix = '') {
  if (n >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${prefix}${(n / 1_000).toFixed(1)}K`;
  return `${prefix}${n}`;
}

function Badge({ label, variant }: { label: string; variant: 'critical' | 'high' | 'medium' | 'low' | 'green' | 'blue' }) {
  const colors = {
    critical: { bg: 'rgba(239,68,68,.12)', color: '#ef4444', border: 'rgba(239,68,68,.25)' },
    high: { bg: 'rgba(245,158,11,.1)', color: '#f59e0b', border: 'rgba(245,158,11,.25)' },
    medium: { bg: 'rgba(59,130,246,.1)', color: '#3b82f6', border: 'rgba(59,130,246,.25)' },
    low: { bg: 'rgba(100,116,139,.1)', color: '#94a3b8', border: 'rgba(100,116,139,.2)' },
    green: { bg: 'rgba(34,197,94,.1)', color: '#22c55e', border: 'rgba(34,197,94,.25)' },
    blue: { bg: 'rgba(59,130,246,.1)', color: '#3b82f6', border: 'rgba(59,130,246,.25)' },
  };
  const c = colors[variant];
  return (
    <span style={{
      display: 'inline-block', padding: '1px 7px',
      borderRadius: '4px', fontSize: '10px', fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.5px',
      background: c.bg, color: c.color, border: `1px solid ${c.border}`,
    }}>
      {label}
    </span>
  );
}

function MetricCard({
  label, value, delta, deltaType, color,
}: {
  label: string; value: string; delta?: string;
  deltaType?: 'up' | 'down'; color: string;
}) {
  return (
    <div style={{
      background: '#111318', border: '1px solid #2a3040', borderRadius: '12px',
      padding: '16px 18px', cursor: 'pointer', transition: 'transform 0.15s, border-color 0.15s',
    }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#3a4560'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-1px)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#2a3040'; (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'; }}
    >
      <div style={{ fontSize: '11px', fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '28px', fontWeight: 700, letterSpacing: '-1px', color, lineHeight: 1 }}>{value}</div>
      {delta && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginTop: '6px', fontWeight: 500, color: deltaType === 'up' ? '#22c55e' : '#ef4444' }}>
          {deltaType === 'up' ? '↑' : '↓'} {delta}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard page ───────────────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { user, isAuthenticated, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'approvals'>('overview');
  const queryClient = useQueryClient();

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated && typeof window !== 'undefined') {
      router.push('/login');
    }
  }, [isAuthenticated, router]);

  // ─── Data queries ───────────────────────────────────────────
  const { data: metricsData } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: () => api.dashboard.metrics(),
    refetchInterval: 30000,
    enabled: isAuthenticated,
  });

  const { data: incidentsData } = useQuery({
    queryKey: ['dashboard-incidents'],
    queryFn: () => api.dashboard.incidents({ limit: 5 }),
    refetchInterval: 15000,
    enabled: isAuthenticated,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => api.agents.list(),
    refetchInterval: 10000,
    enabled: isAuthenticated,
  });

  const { data: approvalsData } = useQuery({
    queryKey: ['approvals-pending'],
    queryFn: () => api.approvals.list({ status: 'pending' }),
    refetchInterval: 20000,
    enabled: isAuthenticated,
  });

  // ─── Approval mutation ──────────────────────────────────────
  const reviewMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'approved' | 'rejected' }) =>
      api.approvals.review(id, action),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['approvals-pending'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    },
  });

  const metrics: DashboardMetrics | undefined = metricsData?.data?.data;
  const incidents: Incident[] = incidentsData?.data?.data?.incidents || [];
  const agents: Agent[] = agentsData?.data?.data?.agents || [];
  const approvals: Approval[] = approvalsData?.data?.data?.approvals || [];

  const s: React.CSSProperties = {
    fontFamily: 'Inter, system-ui, sans-serif',
    background: '#0a0c10',
    minHeight: '100vh',
    color: '#e2e8f0',
  };

  return (
    <div style={s}>
      {/* ─── Topbar ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '12px',
        padding: '0 24px', height: '56px',
        background: '#111318', borderBottom: '1px solid #2a3040',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '28px', height: '28px', borderRadius: '7px',
            background: 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px',
          }}>⬡</div>
          <div>
            <div style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.3px' }}>NEXUS</div>
            <div style={{ fontSize: '9px', color: '#475569', letterSpacing: '1.2px', textTransform: 'uppercase' }}>Ops Intelligence</div>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', gap: '4px' }}>
          {(['overview', 'agents', 'approvals'] as const).map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: '6px 14px', borderRadius: '6px', fontSize: '13px', fontWeight: 500,
              border: activeTab === tab ? '1px solid #3a4560' : 'none',
              background: activeTab === tab ? '#1e2330' : 'transparent',
              color: activeTab === tab ? '#e2e8f0' : '#64748b',
              cursor: 'pointer', textTransform: 'capitalize', fontFamily: 'inherit',
            }}>
              {tab}{tab === 'approvals' && approvals.length > 0 && (
                <span style={{
                  marginLeft: '6px', padding: '1px 6px', borderRadius: '10px',
                  fontSize: '10px', fontWeight: 700, background: 'rgba(239,68,68,.15)', color: '#ef4444',
                }}>{approvals.length}</span>
              )}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <div style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e', animation: 'pulse 2s infinite' }} />
            <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>Live</span>
          </div>
          <div style={{ fontSize: '12px', color: '#64748b' }}>
            {user?.firstName} {user?.lastName} · <span style={{ color: '#3b82f6' }}>{user?.role}</span>
          </div>
          <button onClick={logout} style={{
            padding: '5px 12px', borderRadius: '6px', fontSize: '12px',
            background: 'transparent', border: '1px solid #2a3040',
            color: '#94a3b8', cursor: 'pointer', fontFamily: 'inherit',
          }}>
            Sign out
          </button>
        </div>
      </div>

      {/* ─── Content ───────────────────────────────────────── */}
      <div style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>

        {/* OVERVIEW TAB */}
        {activeTab === 'overview' && (
          <>
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px' }}>
                Operations Command Center
              </div>
              <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                Real-time intelligence · {user?.tenant?.name} workspace · {new Date().toLocaleString()}
              </div>
            </div>

            {/* Metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', marginBottom: '24px' }}>
              <MetricCard label="MRR" value={fmt(metrics?.mrr || 2840000, '$')} delta={`${metrics?.mrrDelta || 8.3}% vs last month`} deltaType="up" color="#22c55e" />
              <MetricCard label="Churn risk" value={String(metrics?.churnRiskCount || 14)} delta="3 accounts flagged today" deltaType="down" color="#ef4444" />
              <MetricCard label="Open incidents" value={String(metrics?.openIncidents || 7)} delta={`${metrics?.criticalIncidents || 2} critical`} deltaType="down" color="#f59e0b" />
              <MetricCard label="SLA compliance" value={`${metrics?.slaCompliance || 94.2}%`} delta="↑ 1.1% vs yesterday" deltaType="up" color="#3b82f6" />
            </div>

            {/* Incidents + health */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <div style={{ background: '#111318', border: '1px solid #2a3040', borderRadius: '12px', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div style={{ fontSize: '14px', fontWeight: 600 }}>Live incident feed</div>
                  <div style={{ fontSize: '12px', color: '#3b82f6', cursor: 'pointer' }}>Ask AI →</div>
                </div>
                {incidents.length === 0 ? (
                  <div style={{ color: '#475569', fontSize: '13px' }}>No incidents — all systems operational</div>
                ) : (
                  incidents.map((inc) => (
                    <div key={inc.id} style={{
                      display: 'flex', gap: '12px', padding: '10px 0',
                      borderBottom: '1px solid #1e2330', cursor: 'pointer',
                    }}>
                      <div style={{
                        width: '5px', borderRadius: '3px', flexShrink: 0,
                        background: inc.severity === 'critical' ? '#ef4444' : inc.severity === 'high' ? '#f59e0b' : '#3b82f6',
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                          <span style={{ fontSize: '13px', fontWeight: 600 }}>{inc.title}</span>
                          <Badge label={inc.severity} variant={inc.severity as any} />
                        </div>
                        <div style={{ fontSize: '11px', color: '#475569' }}>
                          {inc.source} · {new Date(inc.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={{ background: '#111318', border: '1px solid #2a3040', borderRadius: '12px', padding: '20px' }}>
                <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '16px' }}>Customer health by segment</div>
                {[
                  { name: 'Enterprise', score: 87, color: '#22c55e' },
                  { name: 'Mid-Market', score: 72, color: '#3b82f6' },
                  { name: 'SMB', score: 54, color: '#f59e0b' },
                  { name: 'Startup', score: 41, color: '#ef4444' },
                ].map((seg) => (
                  <div key={seg.name} style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 500 }}>{seg.name}</span>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: seg.color }}>{seg.score}</span>
                    </div>
                    <div style={{ height: '6px', background: '#1e2330', borderRadius: '3px' }}>
                      <div style={{ height: '100%', borderRadius: '3px', background: seg.color, width: `${seg.score}%`, transition: 'width 1s' }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* AGENTS TAB */}
        {activeTab === 'agents' && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px' }}>AI Agents</div>
              <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                {agents.filter((a) => a.status === 'running').length} running · {agents.filter((a) => a.status === 'error').length} error
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {agents.map((agent) => {
                const statusColor = agent.status === 'running' ? '#22c55e' : agent.status === 'error' ? '#ef4444' : '#64748b';
                return (
                  <div key={agent._id} style={{
                    background: '#111318', border: '1px solid #2a3040',
                    borderRadius: '12px', padding: '18px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '8px', height: '8px', borderRadius: '50%',
                          background: statusColor,
                          boxShadow: agent.status === 'running' ? `0 0 6px ${statusColor}` : 'none',
                        }} />
                        <div>
                          <div style={{ fontSize: '14px', fontWeight: 600 }}>{agent.name}</div>
                          <div style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>{agent.type.replace('_', ' ')}</div>
                        </div>
                      </div>
                      <Badge
                        label={agent.status}
                        variant={agent.status === 'running' ? 'green' : agent.status === 'error' ? 'critical' : 'low'}
                      />
                    </div>
                    {agent.currentTask && (
                      <div style={{
                        fontSize: '12px', color: '#94a3b8', background: '#181c24',
                        borderRadius: '6px', padding: '8px 10px', marginBottom: '12px',
                        fontFamily: 'monospace',
                      }}>
                        {agent.currentTask.slice(0, 80)}...
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#64748b' }}>
                      <span>Success: <strong style={{ color: '#22c55e' }}>{agent.successRate}%</strong></span>
                      <span>Cost: <strong style={{ color: '#f59e0b' }}>${agent.totalCostUSD?.toFixed(3)}</strong></span>
                      <span>Runs: <strong style={{ color: '#3b82f6' }}>{agent.totalExecutions}</strong></span>
                      <span>Circuit: <strong style={{ color: agent.circuitBreaker?.state === 'open' ? '#ef4444' : '#22c55e' }}>{agent.circuitBreaker?.state || 'closed'}</strong></span>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* APPROVALS TAB */}
        {activeTab === 'approvals' && (
          <>
            <div style={{ marginBottom: '20px' }}>
              <div style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px' }}>Human-in-the-Loop Approvals</div>
              <div style={{ fontSize: '13px', color: '#475569', marginTop: '4px' }}>
                {approvals.length} pending · Full audit trail maintained
              </div>
            </div>
            {approvals.length === 0 ? (
              <div style={{
                background: '#111318', border: '1px solid #2a3040', borderRadius: '12px',
                padding: '40px', textAlign: 'center', color: '#475569', fontSize: '14px',
              }}>
                No pending approvals — all clear ✓
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {approvals.map((approval) => (
                  <div key={approval._id} style={{
                    background: '#111318',
                    borderLeft: `3px solid ${approval.risk === 'high' ? '#ef4444' : approval.risk === 'medium' ? '#f59e0b' : '#3b82f6'}`,
                    border: '1px solid #2a3040',
                    borderRadius: '12px', padding: '18px',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                      <div>
                        <div style={{ fontSize: '11px', color: '#475569', fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', marginBottom: '4px' }}>
                          {approval.requestedBy?.agentType?.replace('_', ' ') || 'System'} · {new Date(approval.createdAt).toLocaleString()}
                        </div>
                        <div style={{ fontSize: '14px', fontWeight: 600 }}>{approval.action}</div>
                      </div>
                      <Badge label={`${approval.risk} risk`} variant={approval.risk === 'high' ? 'critical' : approval.risk === 'medium' ? 'high' : 'blue'} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '14px', lineHeight: 1.6 }}>
                      {approval.detail}
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => reviewMutation.mutate({ id: approval._id, action: 'approved' })}
                        disabled={reviewMutation.isPending}
                        style={{
                          padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
                          background: 'rgba(34,197,94,.1)', color: '#22c55e',
                          border: '1px solid rgba(34,197,94,.25)', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        ✓ Approve
                      </button>
                      <button
                        onClick={() => reviewMutation.mutate({ id: approval._id, action: 'rejected' })}
                        disabled={reviewMutation.isPending}
                        style={{
                          padding: '7px 14px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
                          background: 'rgba(239,68,68,.08)', color: '#ef4444',
                          border: '1px solid rgba(239,68,68,.2)', cursor: 'pointer', fontFamily: 'inherit',
                        }}
                      >
                        ✕ Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}