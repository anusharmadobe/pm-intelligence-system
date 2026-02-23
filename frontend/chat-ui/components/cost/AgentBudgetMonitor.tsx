'use client';

import { useEffect, useState } from 'react';
import { PMIntelligenceClient } from '@/lib/api-client';
import { AlertTriangle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';

interface AgentBudgetMonitorProps {
  apiClient: PMIntelligenceClient;
}

interface AgentBudget {
  agent_id: string;
  agent_name: string;
  budget_limit: number;
  current_cost: number;
  remaining: number;
  utilization_pct: number;
  operation_count: number;
  total_input_tokens: number;
  total_output_tokens: number;
  is_active: boolean;
  cost_reset_at: string;
}

export function AgentBudgetMonitor({ apiClient }: AgentBudgetMonitorProps) {
  const [agents, setAgents] = useState<AgentBudget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAgents();
    // Refresh every 2 minutes
    const interval = setInterval(loadAgents, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  async function loadAgents() {
    try {
      const response = await apiClient.getAgentBudgets();
      setAgents(response.data.agents);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load agent budgets');
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-center gap-2 text-red-800">
          <AlertTriangle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Agent Budget Status</h3>
        <button
          onClick={loadAgents}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="h-5 w-5 text-gray-600" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Agent
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Budget
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Used
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Remaining
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Utilization
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Operations
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {agents.map((agent) => (
              <tr key={agent.agent_id} className="hover:bg-gray-50">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {agent.agent_name}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${agent.budget_limit.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  ${agent.current_cost.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  ${agent.remaining.toFixed(2)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-gray-200 rounded-full h-2 max-w-[100px]">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          agent.utilization_pct >= 100
                            ? 'bg-red-600'
                            : agent.utilization_pct >= 90
                            ? 'bg-red-500'
                            : agent.utilization_pct >= 75
                            ? 'bg-yellow-500'
                            : agent.utilization_pct >= 50
                            ? 'bg-blue-500'
                            : 'bg-green-500'
                        }`}
                        style={{ width: `${Math.min(agent.utilization_pct, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm text-gray-900 min-w-[48px]">
                      {agent.utilization_pct.toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {agent.operation_count.toLocaleString()}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <StatusBadge
                    isActive={agent.is_active}
                    utilizationPct={agent.utilization_pct}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary Stats */}
      <div className="px-6 py-4 bg-gray-50 border-t border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Total Agents:</span>
            <span className="ml-2 font-semibold text-gray-900">{agents.length}</span>
          </div>
          <div>
            <span className="text-gray-600">Active:</span>
            <span className="ml-2 font-semibold text-green-600">
              {agents.filter(a => a.is_active).length}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Paused:</span>
            <span className="ml-2 font-semibold text-red-600">
              {agents.filter(a => !a.is_active).length}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Total Spent:</span>
            <span className="ml-2 font-semibold text-gray-900">
              ${agents.reduce((sum, a) => sum + a.current_cost, 0).toFixed(2)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatusBadgeProps {
  isActive: boolean;
  utilizationPct: number;
}

function StatusBadge({ isActive, utilizationPct }: StatusBadgeProps) {
  if (!isActive) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
        <XCircle className="h-3 w-3" />
        Paused
      </span>
    );
  }

  if (utilizationPct >= 90) {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
        <AlertTriangle className="h-3 w-3" />
        Warning
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
      <CheckCircle className="h-3 w-3" />
      Active
    </span>
  );
}
