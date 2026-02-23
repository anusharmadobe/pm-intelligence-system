'use client';

import { useEffect, useState } from 'react';
import { PMIntelligenceClient } from '@/lib/api-client';
import { AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface CostTrendsChartProps {
  apiClient: PMIntelligenceClient;
  days?: number;
}

interface TrendData {
  daily_trend: Array<{
    day: string;
    cost_usd: number;
    operation_count: number;
    total_tokens: number;
  }>;
  projection: {
    month_to_date_cost: number;
    avg_daily_cost: number;
    projected_monthly_cost: number;
    days_remaining: number;
    confidence: 'high' | 'medium' | 'low';
  };
}

export function CostTrendsChart({ apiClient, days = 30 }: CostTrendsChartProps) {
  const [data, setData] = useState<TrendData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTrends();
    // Refresh every 10 minutes
    const interval = setInterval(loadTrends, 10 * 60 * 1000);
    return () => clearInterval(interval);
  }, [days]);

  async function loadTrends() {
    try {
      const response = await apiClient.getCostTrends(days);
      setData(response.data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load cost trends');
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

  if (!data) return null;

  const maxCost = Math.max(...data.daily_trend.map(d => d.cost_usd));

  return (
    <div className="space-y-6">
      {/* Projection Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ProjectionCard
          title="Month to Date"
          value={`$${data.projection.month_to_date_cost.toFixed(2)}`}
          subtitle="Current spending"
          color="blue"
        />
        <ProjectionCard
          title="Average Daily"
          value={`$${data.projection.avg_daily_cost.toFixed(2)}`}
          subtitle="Per day average"
          color="green"
        />
        <ProjectionCard
          title="Projected Monthly"
          value={`$${data.projection.projected_monthly_cost.toFixed(2)}`}
          subtitle={`${data.projection.confidence} confidence`}
          color="purple"
        />
        <ProjectionCard
          title="Days Remaining"
          value={data.projection.days_remaining.toString()}
          subtitle="Until month end"
          color="orange"
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-6">Daily Cost Trend</h3>

        <div className="space-y-2">
          {data.daily_trend.map((day, idx) => {
            const date = new Date(day.day);
            const barWidth = (day.cost_usd / maxCost) * 100;
            const isToday = date.toDateString() === new Date().toDateString();

            return (
              <div key={idx} className="flex items-center gap-3">
                <div className="text-xs text-gray-500 w-20 text-right">
                  {date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </div>
                <div className="flex-1 relative">
                  <div className="bg-gray-100 rounded h-8 overflow-hidden">
                    <div
                      className={`h-full rounded transition-all ${
                        isToday ? 'bg-blue-600' : 'bg-blue-500'
                      } hover:bg-blue-700`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </div>
                  <div className="absolute inset-y-0 left-2 flex items-center">
                    <span className={`text-xs font-medium ${
                      barWidth > 20 ? 'text-white' : 'text-gray-900 ml-2'
                    }`}>
                      ${day.cost_usd.toFixed(2)}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-500 w-16 text-right">
                  {day.operation_count.toLocaleString()} ops
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 pt-4 border-t border-gray-200 flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-gray-600">Daily cost</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-600 rounded"></div>
              <span className="text-gray-600">Today</span>
            </div>
          </div>
          <div className="text-gray-500">
            Showing last {days} days
          </div>
        </div>
      </div>

      {/* Trend Analysis */}
      <TrendAnalysis data={data} />
    </div>
  );
}

interface ProjectionCardProps {
  title: string;
  value: string;
  subtitle: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}

function ProjectionCard({ title, value, subtitle, color }: ProjectionCardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 border-blue-200',
    green: 'bg-green-50 border-green-200',
    purple: 'bg-purple-50 border-purple-200',
    orange: 'bg-orange-50 border-orange-200'
  };

  return (
    <div className={`rounded-lg border p-4 ${colorClasses[color]}`}>
      <p className="text-sm font-medium text-gray-600">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
    </div>
  );
}

interface TrendAnalysisProps {
  data: TrendData;
}

function TrendAnalysis({ data }: TrendAnalysisProps) {
  const recentDays = data.daily_trend.slice(-7);
  const firstWeekAvg = recentDays.slice(0, 3).reduce((sum, d) => sum + d.cost_usd, 0) / 3;
  const lastWeekAvg = recentDays.slice(-3).reduce((sum, d) => sum + d.cost_usd, 0) / 3;
  const trend = ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100;
  const isTrendingUp = trend > 5;
  const isTrendingDown = trend < -5;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">Trend Analysis</h3>

      <div className="space-y-4">
        {/* Trend Direction */}
        <div className="flex items-center gap-3">
          {isTrendingUp ? (
            <TrendingUp className="h-5 w-5 text-red-500" />
          ) : isTrendingDown ? (
            <TrendingDown className="h-5 w-5 text-green-500" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-gray-300"></div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">
              {isTrendingUp ? 'Costs are increasing' : isTrendingDown ? 'Costs are decreasing' : 'Costs are stable'}
            </p>
            <p className="text-sm text-gray-500">
              {Math.abs(trend).toFixed(1)}% change over last 7 days
            </p>
          </div>
        </div>

        {/* Confidence Level */}
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Projection Confidence</span>
            <span className={`text-sm font-medium ${
              data.projection.confidence === 'high' ? 'text-green-600' :
              data.projection.confidence === 'medium' ? 'text-yellow-600' :
              'text-red-600'
            }`}>
              {data.projection.confidence.toUpperCase()}
            </span>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {data.projection.confidence === 'high'
              ? 'Based on 7+ days of data'
              : data.projection.confidence === 'medium'
              ? 'Based on 3-6 days of data'
              : 'Less than 3 days of data available'}
          </p>
        </div>
      </div>
    </div>
  );
}
