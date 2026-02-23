'use client';

import { useState } from 'react';
import { useApiKey } from '@/components/ApiKeyProvider';
import { CostDashboard } from '@/components/cost/CostDashboard';
import { AgentBudgetMonitor } from '@/components/cost/AgentBudgetMonitor';
import { CostTrendsChart } from '@/components/cost/CostTrendsChart';
import { DollarSign, TrendingUp, Users, BarChart3 } from 'lucide-react';

export default function CostPage() {
  const { apiClient } = useApiKey();
  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'trends'>('overview');

  if (!apiClient) {
    return null; // ApiKeyProvider will show login screen
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <DollarSign className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Cost Tracking & Monitoring</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Monitor LLM costs, agent budgets, and spending trends
                </p>
              </div>
            </div>

            {/* Tabs */}
            <div className="mt-6 flex gap-4 border-b border-gray-200">
              <TabButton
                active={activeTab === 'overview'}
                onClick={() => setActiveTab('overview')}
                icon={<BarChart3 className="h-5 w-5" />}
                label="Overview"
              />
              <TabButton
                active={activeTab === 'agents'}
                onClick={() => setActiveTab('agents')}
                icon={<Users className="h-5 w-5" />}
                label="Agent Budgets"
              />
              <TabButton
                active={activeTab === 'trends'}
                onClick={() => setActiveTab('trends')}
                icon={<TrendingUp className="h-5 w-5" />}
                label="Trends & Projections"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && <CostDashboard apiClient={apiClient} />}
        {activeTab === 'agents' && <AgentBudgetMonitor apiClient={apiClient} />}
        {activeTab === 'trends' && <CostTrendsChart apiClient={apiClient} days={30} />}
      </div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-3 border-b-2 font-medium transition-colors ${
        active
          ? 'border-blue-600 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
