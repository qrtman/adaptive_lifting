import type { InsightKpi } from '../../insights/construct';

export function InsightKpiStrip({ kpis }: { kpis: InsightKpi[]; key?: string | number }) {
  return (
    <div
      data-testid="insight-kpi-strip"
      className="px-1 h-7 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono border-b border-white/10"
    >
      {kpis.map((kpi, index) => (
        <span
          key={kpi.id}
          data-testid={`insight-kpi-${kpi.id}`}
          className={`${kpi.className ?? 'text-[#AEAEB2]'} ${index === kpis.length - 1 ? 'ml-auto' : ''}`}
        >
          {kpi.id === 'acwr' ? (
            kpi.value
          ) : (
            <>
              {kpi.label} <span className="text-white">{kpi.value}</span>
            </>
          )}
        </span>
      ))}
    </div>
  );
}
