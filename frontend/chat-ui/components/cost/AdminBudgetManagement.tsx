'use client';

import { useState } from 'react';
import { PMIntelligenceClient } from '@/lib/api-client';
import { DollarSign, Pause, Play, RotateCcw, Check, X, AlertCircle } from 'lucide-react';

interface AdminBudgetManagementProps {
  apiClient: PMIntelligenceClient;
  agentId: string;
  agentName: string;
  currentBudget: number;
  currentCost: number;
  isActive: boolean;
  onUpdate?: () => void;
}

export function AdminBudgetManagement({
  apiClient,
  agentId,
  agentName,
  currentBudget,
  currentCost,
  isActive,
  onUpdate
}: AdminBudgetManagementProps) {
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [newBudget, setNewBudget] = useState(currentBudget.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleUpdateBudget() {
    const budgetValue = parseFloat(newBudget);
    if (isNaN(budgetValue) || budgetValue < 0) {
      setError('Please enter a valid positive number');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await apiClient.updateAgentBudget(agentId, budgetValue);
      setSuccess(`Budget updated to $${budgetValue.toFixed(2)}`);
      setIsEditingBudget(false);
      setTimeout(() => setSuccess(null), 3000);
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to update budget');
    } finally {
      setLoading(false);
    }
  }

  async function handlePauseAgent() {
    if (!confirm(`Are you sure you want to pause ${agentName}?`)) return;

    setLoading(true);
    setError(null);
    try {
      await apiClient.pauseAgent(agentId, 'manual_pause');
      setSuccess(`Agent ${agentName} has been paused`);
      setTimeout(() => setSuccess(null), 3000);
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to pause agent');
    } finally {
      setLoading(false);
    }
  }

  async function handleUnpauseAgent() {
    setLoading(true);
    setError(null);
    try {
      await apiClient.unpauseAgent(agentId);
      setSuccess(`Agent ${agentName} has been unpaused`);
      setTimeout(() => setSuccess(null), 3000);
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to unpause agent');
    } finally {
      setLoading(false);
    }
  }

  async function handleResetBudget() {
    if (!confirm(`Are you sure you want to reset the monthly cost counter for ${agentName}?`)) return;

    setLoading(true);
    setError(null);
    try {
      await apiClient.resetAgentBudget(agentId);
      setSuccess(`Monthly cost counter reset for ${agentName}`);
      setTimeout(() => setSuccess(null), 3000);
      onUpdate?.();
    } catch (err: any) {
      setError(err.message || 'Failed to reset budget');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Admin Actions - {agentName}</h3>

      {/* Status Messages */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
          <span className="text-sm text-red-800">{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-600 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {success && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
          <Check className="h-5 w-5 text-green-600 flex-shrink-0" />
          <span className="text-sm text-green-800">{success}</span>
          <button onClick={() => setSuccess(null)} className="ml-auto text-green-600 hover:text-green-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Current Status */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-600">Current Budget:</span>
            <span className="ml-2 font-semibold text-gray-900">${currentBudget.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-600">Current Cost:</span>
            <span className="ml-2 font-semibold text-gray-900">${currentCost.toFixed(2)}</span>
          </div>
          <div>
            <span className="text-gray-600">Remaining:</span>
            <span className="ml-2 font-semibold text-gray-900">
              ${Math.max(currentBudget - currentCost, 0).toFixed(2)}
            </span>
          </div>
          <div>
            <span className="text-gray-600">Status:</span>
            <span className={`ml-2 font-semibold ${isActive ? 'text-green-600' : 'text-red-600'}`}>
              {isActive ? 'Active' : 'Paused'}
            </span>
          </div>
        </div>
      </div>

      {/* Budget Management */}
      <div className="mb-6">
        <h4 className="text-sm font-semibold text-gray-900 mb-3">Budget Management</h4>
        {isEditingBudget ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-gray-400" />
              <input
                type="number"
                value={newBudget}
                onChange={(e) => setNewBudget(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter new budget"
                min="0"
                step="0.01"
                disabled={loading}
              />
            </div>
            <button
              onClick={handleUpdateBudget}
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={() => {
                setIsEditingBudget(false);
                setNewBudget(currentBudget.toString());
              }}
              disabled={loading}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setIsEditingBudget(true)}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <DollarSign className="h-5 w-5" />
            <span>Update Budget Limit</span>
          </button>
        )}
      </div>

      {/* Agent Controls */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-900">Agent Controls</h4>

        {isActive ? (
          <button
            onClick={handlePauseAgent}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Pause className="h-5 w-5" />
            <span>{loading ? 'Pausing...' : 'Pause Agent'}</span>
          </button>
        ) : (
          <button
            onClick={handleUnpauseAgent}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="h-5 w-5" />
            <span>{loading ? 'Unpausing...' : 'Unpause Agent'}</span>
          </button>
        )}

        <button
          onClick={handleResetBudget}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="h-5 w-5" />
          <span>{loading ? 'Resetting...' : 'Reset Monthly Cost'}</span>
        </button>
      </div>

      {/* Warning Note */}
      <div className="mt-6 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
        <p className="text-xs text-yellow-800">
          <strong>Note:</strong> Pausing an agent will prevent it from processing new requests.
          Resetting the monthly cost counter will clear the current cost but preserve the budget limit.
        </p>
      </div>
    </div>
  );
}
