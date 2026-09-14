import { useMemo } from 'react';
import type { Aggregation, AnalyticsCatalog, CardConfig, MetricName, ScopeKind, TimeGrain, Visualization } from './types';
import { AGGREGATIONS, METRIC_NAMES, TIME_GRAINS, VISUALIZATIONS } from './types';
import { EXERCISE_CATEGORIES } from '../services/exerciseCatalog';

const MOVEMENTS = ['Squat', 'Bench', 'Deadlift'];

export function CardBuilder({
  name,
  config,
  onName,
  onChange,
  catalog,
  onSave,
  onCancel,
}: {
  name: string;
  config: CardConfig;
  onName: (name: string) => void;
  onChange: (config: CardConfig) => void;
  catalog: AnalyticsCatalog | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const metricMeta = useMemo(() => {
    const map = new Map((catalog?.metrics || []).map((m) => [m.name, m]));
    return map;
  }, [catalog]);

  const disableReason = (metric: MetricName, vis: Visualization, grain: TimeGrain): string | null => {
    const meta = metricMeta.get(metric);
    if (!meta) return null;
    if (!meta.visualizations.includes(vis)) return `${metric} cannot render as ${vis}`;
    if (!meta.grains.includes(grain)) return `${metric} does not support ${grain} grain`;
    return null;
  };

  const toggleMetric = (metric: MetricName) => {
    const has = config.metrics.includes(metric);
    onChange({
      ...config,
      metrics: has ? config.metrics.filter((m) => m !== metric) : [...config.metrics, metric],
    });
  };

  const scope = config.scopes[0] || { kind: 'all' as ScopeKind, ids: [] };

  return (
    <aside className="w-[320px] shrink-0 border-l border-border bg-sidebar h-full overflow-y-auto p-3" data-testid="card-builder">
      <h3 className="text-sm text-fg-strong mb-2">Card</h3>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Name</label>
      <input
        value={name}
        onChange={(e) => onName(e.target.value)}
        className="w-full h-8 px-2 mb-3 text-caption bg-inspector border border-border rounded text-fg-strong"
      />
      <p className="text-micro text-fg-subtle uppercase mb-1">Metrics</p>
      <div className="flex flex-wrap gap-1 mb-3">
        {METRIC_NAMES.map((metric) => {
          const reason = disableReason(metric, config.visualization, config.time_grain);
          const selected = config.metrics.includes(metric);
          return (
            <button
              key={metric}
              type="button"
              disabled={Boolean(reason) && !selected}
              title={reason || metric}
              onClick={() => toggleMetric(metric)}
              className={`h-7 px-2 text-mini rounded ${selected ? 'bg-white/10 text-fg-strong' : 'text-fg-muted'} disabled:opacity-40`}
            >
              {metric}
            </button>
          );
        })}
      </div>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Scope</label>
      <select
        value={scope.kind}
        onChange={(e) => onChange({ ...config, scopes: [{ kind: e.target.value as ScopeKind, ids: [] }] })}
        className="w-full h-8 mb-2 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
      >
        <option value="all">All</option>
        <option value="movement">Movement</option>
        <option value="pattern">Pattern</option>
      </select>
      {scope.kind === 'movement' && (
        <div className="flex flex-wrap gap-1 mb-3">
          {MOVEMENTS.map((id) => {
            const on = scope.ids.includes(id);
            return (
              <button
                key={id}
                type="button"
                className={`h-7 px-2 text-mini rounded ${on ? 'bg-white/10 text-fg-strong' : 'text-fg-muted'}`}
                onClick={() => {
                  const ids = on ? scope.ids.filter((x) => x !== id) : [...scope.ids, id];
                  onChange({ ...config, scopes: [{ kind: 'movement', ids }] });
                }}
              >
                {id}
              </button>
            );
          })}
        </div>
      )}
      {scope.kind === 'pattern' && (
        <select
          value={scope.ids[0] || ''}
          onChange={(e) => onChange({ ...config, scopes: [{ kind: 'pattern', ids: e.target.value ? [e.target.value] : [] }] })}
          className="w-full h-8 mb-3 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
        >
          <option value="">Choose pattern</option>
          {EXERCISE_CATEGORIES.filter((c) => c !== 'User Defined').map((pattern) => (
            <option key={pattern} value={pattern}>{pattern}</option>
          ))}
        </select>
      )}
      <label className="block text-micro text-fg-subtle uppercase mb-1">Grain</label>
      <select
        value={config.time_grain}
        onChange={(e) => onChange({ ...config, time_grain: e.target.value as TimeGrain })}
        className="w-full h-8 mb-3 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
      >
        {TIME_GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Rolling window</label>
      <div className="flex gap-2 mb-3">
        <input
          type="number"
          min={1}
          max={365}
          value={'n' in config.range ? config.range.n : 12}
          onChange={(e) => onChange({
            ...config,
            range: { n: Number(e.target.value) || 1, grain: 'grain' in config.range ? config.range.grain : config.time_grain },
          })}
          className="w-20 h-8 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
        />
        <select
          value={'grain' in config.range ? config.range.grain : config.time_grain}
          onChange={(e) => onChange({
            ...config,
            range: { n: 'n' in config.range ? config.range.n : 12, grain: e.target.value as TimeGrain },
          })}
          className="flex-1 h-8 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
        >
          {TIME_GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Visualization</label>
      <select
        value={config.visualization}
        onChange={(e) => onChange({ ...config, visualization: e.target.value as Visualization })}
        className="w-full h-8 mb-3 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
      >
        {VISUALIZATIONS.map((v) => {
          const blocked = config.metrics.map((m) => disableReason(m, v, config.time_grain)).find(Boolean);
          return <option key={v} value={v} disabled={Boolean(blocked)} title={blocked || v}>{v}</option>;
        })}
      </select>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Comparison</label>
      <select
        value={config.comparison?.kind || ''}
        onChange={(e) => {
          const kind = e.target.value as '' | 'prescribed_vs_actual' | 'period_vs_period';
          if (!kind) {
            onChange({ ...config, comparison: null });
            return;
          }
          onChange({
            ...config,
            comparison: kind === 'period_vs_period'
              ? { kind, secondary: { relative: 'previous_equal' } }
              : { kind },
          });
        }}
        className="w-full h-8 mb-3 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
      >
        <option value="">None</option>
        <option value="prescribed_vs_actual">Prescribed vs actual</option>
        <option value="period_vs_period">Period vs previous equal</option>
      </select>
      <label className="block text-micro text-fg-subtle uppercase mb-1">Aggregation</label>
      <select
        value={config.aggregation || ''}
        onChange={(e) => onChange({ ...config, aggregation: (e.target.value || null) as Aggregation | null })}
        className="w-full h-8 mb-3 px-2 text-caption bg-inspector border border-border rounded text-fg-strong"
      >
        <option value="">Default</option>
        {AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
      </select>
      <div className="flex gap-2">
        <button type="button" data-testid="card-builder-save" onClick={onSave} className="h-8 px-3 text-caption bg-accent text-fg-strong rounded">Save</button>
        <button type="button" onClick={onCancel} className="h-8 px-3 text-caption text-fg-muted">Cancel</button>
      </div>
    </aside>
  );
}
