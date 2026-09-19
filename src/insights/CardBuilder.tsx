import { useMemo } from 'react';
import type { Aggregation, AnalyticsCatalog, CardConfig, MetricName, ScopeKind, TimeGrain, Visualization } from './types';
import { AGGREGATIONS, METRIC_NAMES, TIME_GRAINS, VISUALIZATIONS } from './types';
import { EXERCISE_CATEGORIES } from '../services/exerciseCatalog';

const MOVEMENTS = ['Squat', 'Bench', 'Deadlift'];

const LABEL = 'text-[10px] uppercase tracking-wider text-[var(--cal-muted)] leading-4';
const FIELD =
  'h-8 w-full min-w-0 px-2 rounded-[var(--cal-radius-md)] bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] text-xs text-[var(--cal-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--cal-accent)]';
const SECTION = 'cal-nested-card bg-[var(--cal-surface-soft)] p-[var(--cal-space-xs)] flex flex-col gap-[var(--cal-space-xs)]';

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

  const chipClass = (selected: boolean) =>
    `h-7 px-2 text-[11px] rounded-[var(--cal-radius-md)] transition-colors ${
      selected
        ? 'bg-[var(--cal-surface-strong)] text-[var(--cal-ink)]'
        : 'text-[var(--cal-muted)] hover:text-[var(--cal-ink)] hover:bg-[var(--cal-surface-soft)]'
    }`;

  return (
    <aside
      className="w-[320px] shrink-0 border-l border-[var(--cal-hairline)] bg-[var(--cal-surface-elevated)] h-full overflow-y-auto p-[var(--cal-space-sm)] cal-card-outer"
      data-testid="card-builder"
    >
      <h3 className="text-sm font-semibold tracking-tight text-[var(--cal-ink)] mb-[var(--cal-space-xs)]">Card</h3>

      <div className={SECTION}>
        <label className={LABEL}>Name</label>
        <input value={name} onChange={(e) => onName(e.target.value)} className={FIELD} />
      </div>

      <div className={`${SECTION} mt-[var(--cal-space-xs)]`}>
        <p className={LABEL}>Metrics</p>
        <div className="flex flex-wrap gap-1">
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
                className={`${chipClass(selected)} disabled:opacity-40`}
              >
                {metric}
              </button>
            );
          })}
        </div>
      </div>

      <div className={`${SECTION} mt-[var(--cal-space-xs)]`}>
        <label className={LABEL}>Scope</label>
        <select
          value={scope.kind}
          onChange={(e) => onChange({ ...config, scopes: [{ kind: e.target.value as ScopeKind, ids: [] }] })}
          className={FIELD}
        >
          <option value="all">All</option>
          <option value="movement">Movement</option>
          <option value="pattern">Pattern</option>
        </select>
        {scope.kind === 'movement' && (
          <div className="flex flex-wrap gap-1">
            {MOVEMENTS.map((id) => {
              const on = scope.ids.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={chipClass(on)}
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
            className={FIELD}
          >
            <option value="">Choose pattern</option>
            {EXERCISE_CATEGORIES.filter((c) => c !== 'User Defined').map((pattern) => (
              <option key={pattern} value={pattern}>{pattern}</option>
            ))}
          </select>
        )}
      </div>

      <div className={`${SECTION} mt-[var(--cal-space-xs)]`}>
        <label className={LABEL}>Grain</label>
        <select
          value={config.time_grain}
          onChange={(e) => onChange({ ...config, time_grain: e.target.value as TimeGrain })}
          className={FIELD}
        >
          {TIME_GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>

        <label className={LABEL}>Rolling window</label>
        <div className="flex gap-2">
          <input
            type="number"
            min={1}
            max={365}
            value={'n' in config.range ? config.range.n : 12}
            onChange={(e) => onChange({
              ...config,
              range: { n: Number(e.target.value) || 1, grain: 'grain' in config.range ? config.range.grain : config.time_grain },
            })}
            className="w-20 h-8 px-2 text-xs bg-[var(--cal-canvas)] border border-[var(--cal-hairline)] rounded-[var(--cal-radius-md)] text-[var(--cal-ink)]"
          />
          <select
            value={'grain' in config.range ? config.range.grain : config.time_grain}
            onChange={(e) => onChange({
              ...config,
              range: { n: 'n' in config.range ? config.range.n : 12, grain: e.target.value as TimeGrain },
            })}
            className={`${FIELD} flex-1`}
          >
            {TIME_GRAINS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      </div>

      <div className={`${SECTION} mt-[var(--cal-space-xs)]`}>
        <label className={LABEL}>Visualization</label>
        <select
          value={config.visualization}
          onChange={(e) => onChange({ ...config, visualization: e.target.value as Visualization })}
          className={FIELD}
        >
          {VISUALIZATIONS.map((v) => {
            const blocked = config.metrics.map((m) => disableReason(m, v, config.time_grain)).find(Boolean);
            return <option key={v} value={v} disabled={Boolean(blocked)} title={blocked || v}>{v}</option>;
          })}
        </select>

        <label className={LABEL}>Comparison</label>
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
          className={FIELD}
        >
          <option value="">None</option>
          <option value="prescribed_vs_actual">Prescribed vs actual</option>
          <option value="period_vs_period">Period vs previous equal</option>
        </select>

        <label className={LABEL}>Aggregation</label>
        <select
          value={config.aggregation || ''}
          onChange={(e) => onChange({ ...config, aggregation: (e.target.value || null) as Aggregation | null })}
          className={FIELD}
        >
          <option value="">Default</option>
          {AGGREGATIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <div className="flex gap-2 mt-[var(--cal-space-sm)]">
        <button
          type="button"
          data-testid="card-builder-save"
          onClick={onSave}
          className="h-8 px-3 text-xs font-medium text-[var(--cal-on-primary)] bg-[var(--cal-primary)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-primary-active)]"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-8 px-3 text-xs text-[var(--cal-muted)] hover:text-[var(--cal-ink)] rounded-[var(--cal-radius-md)] hover:bg-[var(--cal-surface-soft)]"
        >
          Cancel
        </button>
      </div>
    </aside>
  );
}
