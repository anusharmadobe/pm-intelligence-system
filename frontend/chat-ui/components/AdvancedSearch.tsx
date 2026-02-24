'use client';

import React, { useState } from 'react';
import { Search, X, Plus, ChevronDown } from 'lucide-react';

export interface SearchFilter {
  field: string;
  operator: 'equals' | 'contains' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'between' | 'in';
  value: any;
  label?: string;
}

export interface AdvancedSearchProps {
  fields: Array<{
    value: string;
    label: string;
    type: 'text' | 'number' | 'date' | 'select';
    options?: Array<{ value: string; label: string }>;
  }>;
  onSearch: (filters: SearchFilter[]) => void;
  onClear?: () => void;
  savedFilters?: Array<{ name: string; filters: SearchFilter[] }>;
  onSaveFilters?: (name: string, filters: SearchFilter[]) => void;
}

export function AdvancedSearch({
  fields,
  onSearch,
  onClear,
  savedFilters = [],
  onSaveFilters
}: AdvancedSearchProps) {
  const [filters, setFilters] = useState<SearchFilter[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const addFilter = () => {
    setFilters([
      ...filters,
      {
        field: fields[0].value,
        operator: 'contains',
        value: ''
      }
    ]);
  };

  const removeFilter = (index: number) => {
    setFilters(filters.filter((_, i) => i !== index));
  };

  const updateFilter = (index: number, updates: Partial<SearchFilter>) => {
    setFilters(filters.map((f, i) => (i === index ? { ...f, ...updates } : f)));
  };

  const handleSearch = () => {
    onSearch(filters.filter(f => f.value));
  };

  const handleClear = () => {
    setFilters([]);
    if (onClear) onClear();
  };

  const loadSavedFilter = (savedFilter: { name: string; filters: SearchFilter[] }) => {
    setFilters(savedFilter.filters);
    setIsExpanded(true);
  };

  const saveCurrentFilters = () => {
    if (saveName && onSaveFilters) {
      onSaveFilters(saveName, filters);
      setSaveName('');
      setShowSaveDialog(false);
    }
  };

  const getOperators = (fieldType: string) => {
    switch (fieldType) {
      case 'number':
      case 'date':
        return [
          { value: 'equals', label: 'Equals' },
          { value: 'gt', label: 'Greater than' },
          { value: 'lt', label: 'Less than' },
          { value: 'between', label: 'Between' }
        ];
      case 'select':
        return [
          { value: 'equals', label: 'Equals' },
          { value: 'in', label: 'In list' }
        ];
      default:
        return [
          { value: 'contains', label: 'Contains' },
          { value: 'equals', label: 'Equals' },
          { value: 'startsWith', label: 'Starts with' },
          { value: 'endsWith', label: 'Ends with' }
        ];
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 text-gray-700 dark:text-gray-300 font-medium"
        >
          <Search className="h-5 w-5" />
          <span>Advanced Search</span>
          <ChevronDown
            className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>

        {savedFilters.length > 0 && (
          <select
            className="text-sm border border-gray-300 dark:border-gray-600 rounded px-2 py-1
                     bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            value=""
            onChange={(e) => {
              const saved = savedFilters.find(f => f.name === e.target.value);
              if (saved) loadSavedFilter(saved);
            }}
          >
            <option value="">Load saved filter...</option>
            {savedFilters.map(sf => (
              <option key={sf.name} value={sf.name}>
                {sf.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Filters */}
      {isExpanded && (
        <div className="space-y-3">
          {filters.map((filter, index) => {
            const field = fields.find(f => f.value === filter.field);
            const operators = field ? getOperators(field.type) : [];

            return (
              <div key={index} className="flex items-center gap-2">
                {/* Field selector */}
                <select
                  value={filter.field}
                  onChange={(e) => updateFilter(index, { field: e.target.value })}
                  className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2
                           bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {fields.map(f => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>

                {/* Operator selector */}
                <select
                  value={filter.operator}
                  onChange={(e) => updateFilter(index, { operator: e.target.value as any })}
                  className="border border-gray-300 dark:border-gray-600 rounded px-3 py-2
                           bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  {operators.map(op => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {/* Value input */}
                {field?.type === 'select' ? (
                  <select
                    value={filter.value}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="">Select...</option>
                    {field.options?.map(opt => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : 'text'}
                    value={filter.value}
                    onChange={(e) => updateFilter(index, { value: e.target.value })}
                    placeholder="Value..."
                    className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2
                             bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                )}

                {/* Remove button */}
                <button
                  onClick={() => removeFilter(index)}
                  className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                  aria-label="Remove filter"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            );
          })}

          {/* Add filter button */}
          <button
            onClick={addFilter}
            className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400
                     hover:text-blue-700 dark:hover:text-blue-300"
          >
            <Plus className="h-4 w-4" />
            Add filter
          </button>

          {/* Actions */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center gap-2">
              <button
                onClick={handleSearch}
                disabled={filters.length === 0}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700
                         disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Search
              </button>
              <button
                onClick={handleClear}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded
                         text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                Clear
              </button>
            </div>

            {onSaveFilters && filters.length > 0 && (
              <button
                onClick={() => setShowSaveDialog(true)}
                className="text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
              >
                Save filters
              </button>
            )}
          </div>

          {/* Save dialog */}
          {showSaveDialog && (
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded">
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Filter name..."
                className="flex-1 border border-gray-300 dark:border-gray-600 rounded px-3 py-2
                         bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              <button
                onClick={saveCurrentFilters}
                disabled={!saveName}
                className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700
                         disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setShowSaveDialog(false);
                  setSaveName('');
                }}
                className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded
                         text-gray-700 dark:text-gray-300"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
