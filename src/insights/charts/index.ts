import { createElement, type ComponentType } from 'react';
import type { QueryResult, Visualization } from '../types';
import { LineChart } from './LineChart';
import { BarChart } from './BarChart';
import { HeatmapChart } from './HeatmapChart';
import { WeekdayMatrix } from './WeekdayMatrix';
import { TableChart } from './TableChart';

export const VISUALIZATION_REGISTRY: Record<Visualization, ComponentType<{ result: QueryResult }>> = {
  line: LineChart,
  bar: BarChart,
  heatmap: HeatmapChart,
  weekday_matrix: WeekdayMatrix,
  table: TableChart,
};

export function ChartFor({ visualization, result }: { visualization: Visualization; result: QueryResult }) {
  const Chart = VISUALIZATION_REGISTRY[visualization] || TableChart;
  return createElement(Chart, { result });
}
