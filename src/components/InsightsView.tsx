import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { LiftFilter } from './LiftFilter';

interface TrendPoint {
  date: string;
  exercise: string;
  variation: string;
  weight: number;
  reps: number;
  rpe: number;
  e1rm: number;
  volume: number;
}

export function InsightsView() {
  const [trends, setTrends] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeChart, setActiveChart] = useState<'e1rm' | 'tonnage' | 'acwr'>('e1rm');
  const [selectedLift, setSelectedLift] = useState<'All' | 'Squat' | 'Bench' | 'Deadlift'>('All');
  const [timeRange, setTimeRange] = useState<'All' | '30d' | '90d'>('All');
  
  // State for chart hover interaction
  const [hoveredPoint, setHoveredPoint] = useState<any | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Advanced Powerlifting Analytics states
  const [analytics, setAnalytics] = useState<any>(null);
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);
  const [attemptPlannerInput, setAttemptPlannerInput] = useState<number>(200);
  const [attemptPlannerProfile, setAttemptPlannerProfile] = useState<'squat_dl'|'bench'>('squat_dl');

  // Gemini AI Auto-Regulation Coach states
  const [aiResponse, setAiResponse] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const triggerAICoachAnalysis = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const response = await apiService.fetchAICoachPrescription();
      setAiResponse(response);
    } catch (err: any) {
      setAiError(err.message || 'AI coach request failed.');
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    async function loadTrends() {
      try {
        const data = await apiService.fetchTrends();
        setTrends(data);
      } catch (err) {
        console.error('Failed to load trends data', err);
      } finally {
        setLoading(false);
      }
    }

    async function loadAnalytics() {
      setLoadingAnalytics(true);
      try {
        const data = await apiService.fetchAnalyticsTrends();
        setAnalytics(data);
        if (data && data.attempt_planner_defaults && data.attempt_planner_defaults.opener) {
          setAttemptPlannerInput(data.attempt_planner_defaults.opener);
        }
      } catch (err) {
        console.error('Failed to load advanced analytics', err);
      } finally {
        setLoadingAnalytics(false);
      }
    }

    loadTrends();
    loadAnalytics();
  }, []);

  // Filter trends based on movement and time range
  const getFilteredData = () => {
    let result = [...trends];

    // 1. Time range filter
    if (timeRange !== 'All') {
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - (timeRange === '30d' ? 30 : 90));
      const limitStr = limitDate.toISOString().split('T')[0];
      result = result.filter(p => p.date >= limitStr);
    }

    // 2. Lift classification
    if (selectedLift !== 'All') {
      result = result.filter(p => {
        const title = p.exercise.toLowerCase();
        if (selectedLift === 'Squat') return title.includes('squat');
        if (selectedLift === 'Bench') return title.includes('bench');
        if (selectedLift === 'Deadlift') return title.includes('dead');
        return true;
      });
    }

    return result;
  };

  const filteredTrends = getFilteredData();

  // --- Dynamic Math Computations ---
  
  // Peak e1RM values
  const getPeakE1RM = (liftType: 'squat' | 'bench' | 'dead') => {
    const points = trends.filter(p => p.exercise.toLowerCase().includes(liftType));
    if (points.length === 0) return 0;
    return Math.max(...points.map(p => p.e1rm));
  };

  const peakSquat = getPeakE1RM('squat');
  const peakBench = getPeakE1RM('bench');
  const peakDeadlift = getPeakE1RM('dead');

  // Cumulative volume
  const cumulativeVolume = trends.reduce((acc, p) => acc + p.volume, 0);

  // CNS stress fatigue assessment based on recent tonnage deltas
  // CNS stress fatigue assessment based on recent tonnage deltas
  const getCNSAnalysis = () => {
    if (analytics && analytics.fatigue_metrics) {
      const acwr = analytics.fatigue_metrics.acute_chronic_ratio;
      
      let status = 'Balanced';
      let textClass = 'text-[#007AFF]';
      let description = `ACWR ${acwr}`;
      
      if (acwr < 0.8) {
        status = 'Under-training';
        textClass = 'text-amber-400';
        description = `ACWR ${acwr} low`;
      } else if (acwr > 1.5) {
        status = 'Danger';
        textClass = 'text-red-500';
        description = `ACWR ${acwr} high`;
      } else if (acwr > 1.3) {
        status = 'Elevated';
        textClass = 'text-orange-500';
        description = `ACWR ${acwr} elevated`;
      }
      
      return { status, class: textClass, description };
    }

    // Group trends by date to get daily tonnages
    const dailyTonnageMap: Record<string, number> = {};
    trends.forEach(p => {
      dailyTonnageMap[p.date] = (dailyTonnageMap[p.date] || 0) + p.volume;
    });

    const dates = Object.keys(dailyTonnageMap).sort();
    if (dates.length < 2) {
      return {
        status: 'Baseline',
        class: 'text-amber-400',
        description: 'Need more sessions for ACWR'
      };
    }

    // Get last 3 completed training days
    const recentDates = dates.slice(-3);
    const deltas: number[] = [];
    for (let i = 1; i < recentDates.length; i++) {
      const prev = dailyTonnageMap[recentDates[i-1]];
      const curr = dailyTonnageMap[recentDates[i]];
      deltas.push(curr - prev);
    }

    // Sum recent deltas
    const netDelta = deltas.reduce((acc, d) => acc + d, 0);

    if (netDelta > 1200) {
      return {
        status: 'Rising load',
        class: 'text-[#34C759]',
        description: `Δ ${Math.round(netDelta)}kg`
      };
    } else if (netDelta < -1500) {
      return {
        status: 'Fatigue',
        class: 'text-orange-500',
        description: `Δ ${Math.round(netDelta)}kg`
      };
    } else {
      return {
        status: 'Balanced',
        class: 'text-[#007AFF]',
        description: `Δ ${Math.round(netDelta)}kg`
      };
    }
  };

  const cnsAssessment = getCNSAnalysis();

  // --- SVG Layout & Point Scaling Helper ---
  
  const width = 850;
  const height = 260;
  const paddingLeft = 44;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 32;

  // Process data points specifically for daily peak e1RM chart
  const getDailyPeakPoints = (liftType: 'squat' | 'bench' | 'dead') => {
    const liftPoints = filteredTrends.filter(p => p.exercise.toLowerCase().includes(liftType));
    
    // Group by date, taking the maximum e1RM of that date
    const dailyMax: Record<string, TrendPoint> = {};
    liftPoints.forEach(p => {
      if (!dailyMax[p.date] || p.e1rm > dailyMax[p.date].e1rm) {
        dailyMax[p.date] = p;
      }
    });

    return Object.keys(dailyMax)
      .sort()
      .map(date => dailyMax[date]);
  };

  const squatPeaks = getDailyPeakPoints('squat');
  const benchPeaks = getDailyPeakPoints('bench');
  const deadPeaks = getDailyPeakPoints('dead');

  // Aggregate daily tonnages for Tonnage Bar Chart
  const getDailyTonnages = () => {
    const dailyMap: Record<string, { date: string; volume: number; delta: number }> = {};
    
    // Group volume by date
    trends.forEach(p => {
      if (!dailyMap[p.date]) {
        dailyMap[p.date] = { date: p.date, volume: 0, delta: 0 };
      }
      dailyMap[p.date].volume += p.volume;
    });

    const sortedDays = Object.keys(dailyMap).sort();
    
    // Compute deltas between successive days
    sortedDays.forEach((day, i) => {
      if (i > 0) {
        const prevDay = sortedDays[i-1];
        dailyMap[day].delta = dailyMap[day].volume - dailyMap[prevDay].volume;
      }
    });

    // Filter by time range
    let dayList = sortedDays.map(d => dailyMap[d]);
    if (timeRange !== 'All') {
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - (timeRange === '30d' ? 30 : 90));
      const limitStr = limitDate.toISOString().split('T')[0];
      dayList = dayList.filter(d => d.date >= limitStr);
    }

    return dayList;
  };

  const dailyTonnages = getDailyTonnages();

  // --- SVG Coordinates Computation Engines ---

  // 1. Line Chart Coordinates
  const getLineCoordinates = (peaks: TrendPoint[]) => {
    if (peaks.length === 0) return [];

    // Find global X bounds (all dates in filteredTrends)
    const allFilteredDates = Array.from(new Set(filteredTrends.map(p => p.date))).sort();
    if (allFilteredDates.length === 0) return [];

    // Find global Y bounds (min/max e1RM across all curves)
    const allPeaks = [...squatPeaks, ...benchPeaks, ...deadPeaks];
    const e1rms = allPeaks.map(p => p.e1rm);
    const maxVal = e1rms.length > 0 ? Math.max(...e1rms) : 200;
    const minVal = e1rms.length > 0 ? Math.min(...e1rms) : 60;
    const yMax = Math.ceil(maxVal / 10) * 10 + 10;
    const yMin = Math.max(0, Math.floor(minVal / 10) * 10 - 10);

    const xRange = allFilteredDates.length > 1 ? allFilteredDates.length - 1 : 1;
    const yRange = yMax - yMin > 0 ? yMax - yMin : 1;

    return peaks.map(point => {
      const dateIndex = allFilteredDates.indexOf(point.date);
      const x = paddingLeft + (dateIndex / xRange) * (width - paddingLeft - paddingRight);
      const y = height - paddingBottom - ((point.e1rm - yMin) / yRange) * (height - paddingTop - paddingBottom);
      return { x, y, data: point };
    });
  };

  const squatCoords = getLineCoordinates(squatPeaks);
  const benchCoords = getLineCoordinates(benchPeaks);
  const deadCoords = getLineCoordinates(deadPeaks);

  // Generate smooth SVG Bezier path from coordinate list
  const getBezierPath = (coords: { x: number; y: number }[]) => {
    if (coords.length === 0) return '';
    if (coords.length === 1) return `M ${coords[0].x} ${coords[0].y}`;
    
    let path = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + 2 * (next.x - curr.x) / 3;
      const cpY2 = next.y;
      path += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
    }
    return path;
  };

  // 2. Bar Chart Coordinates
  const getBarCoordinates = () => {
    if (dailyTonnages.length === 0) return [];

    const volumes = dailyTonnages.map(d => d.volume);
    const maxVol = Math.max(...volumes, 5000);
    const yMax = Math.ceil(maxVol / 1000) * 1000 + 1000;
    
    const xRange = dailyTonnages.length;
    const yRange = yMax;

    const chartWidth = width - paddingLeft - paddingRight;
    const barWidth = Math.max(10, (chartWidth / xRange) * 0.6);
    const barSpacing = (chartWidth / xRange);

    return dailyTonnages.map((day, idx) => {
      const x = paddingLeft + idx * barSpacing + (barSpacing - barWidth) / 2;
      const barHeight = (day.volume / yRange) * (height - paddingTop - paddingBottom);
      const y = height - paddingBottom - barHeight;

      return {
        x,
        y,
        width: barWidth,
        height: barHeight,
        data: day
      };
    });
  };

  const barCoords = getBarCoordinates();

  // --- ACWR Coordinates & Ticks Engine ---
  const acwrSeries = analytics?.fatigue_metrics?.acwr_series || [];
  
  const getFilteredACWRSeries = () => {
    let result = [...acwrSeries];
    if (timeRange !== 'All') {
      const limitDate = new Date();
      limitDate.setDate(limitDate.getDate() - (timeRange === '30d' ? 30 : 90));
      const limitStr = limitDate.toISOString().split('T')[0];
      result = result.filter((p: any) => p.date >= limitStr);
    }
    return result;
  };

  const filteredACWRSeries = getFilteredACWRSeries();

  const getACWRMaxY = () => {
    if (filteredACWRSeries.length === 0) return 2.0;
    const maxVal = Math.max(...filteredACWRSeries.map((p: any) => p.acwr));
    return Math.max(2.0, Math.ceil(maxVal * 2) / 2);
  };

  const acwrYMax = getACWRMaxY();

  const getACWRY = (val: number) => {
    return height - paddingBottom - (val / acwrYMax) * (height - paddingTop - paddingBottom);
  };

  const getACWRCoordinates = () => {
    if (filteredACWRSeries.length === 0) return [];
    const xRange = filteredACWRSeries.length > 1 ? filteredACWRSeries.length - 1 : 1;
    return filteredACWRSeries.map((point: any, idx: number) => {
      const x = paddingLeft + (idx / xRange) * (width - paddingLeft - paddingRight);
      const y = getACWRY(point.acwr);
      return { x, y, data: point };
    });
  };

  const acwrCoords = getACWRCoordinates();

  // Y-Axis Ticks helper
  const getYAxisTicks = () => {
    if (activeChart === 'e1rm') {
      const allPeaks = [...squatPeaks, ...benchPeaks, ...deadPeaks];
      const e1rms = allPeaks.map(p => p.e1rm);
      const maxVal = e1rms.length > 0 ? Math.max(...e1rms) : 200;
      const minVal = e1rms.length > 0 ? Math.min(...e1rms) : 60;
      const yMax = Math.ceil(maxVal / 10) * 10 + 10;
      const yMin = Math.max(0, Math.floor(minVal / 10) * 10 - 10);
      
      const ticks = [];
      const step = Math.ceil((yMax - yMin) / 5 / 5) * 5 || 10;
      for (let val = yMin; val <= yMax; val += step) {
        ticks.push({
          value: `${val}kg`,
          y: height - paddingBottom - ((val - yMin) / (yMax - yMin)) * (height - paddingTop - paddingBottom)
        });
      }
      return ticks;
    } else if (activeChart === 'acwr') {
      const ticks = [];
      const step = 0.5;
      for (let val = 0.0; val <= acwrYMax; val += step) {
        ticks.push({
          value: `${val.toFixed(1)}`,
          y: getACWRY(val)
        });
      }
      return ticks;
    } else {
      const volumes = dailyTonnages.map(d => d.volume);
      const maxVol = Math.max(...volumes, 5000);
      const yMax = Math.ceil(maxVol / 1000) * 1000 + 1000;
      
      const ticks = [];
      const step = Math.ceil(yMax / 5 / 500) * 500 || 2000;
      for (let val = 0; val <= yMax; val += step) {
        ticks.push({
          value: `${(val / 1000).toFixed(1)}k`,
          y: height - paddingBottom - (val / yMax) * (height - paddingTop - paddingBottom)
        });
      }
      return ticks;
    }
  };

  const yTicks = getYAxisTicks();

  // X-Axis Dates helper
  const getXAxisDates = () => {
    const dates = activeChart === 'acwr'
      ? filteredACWRSeries.map((p: any) => p.date)
      : Array.from(new Set(filteredTrends.map(p => p.date))).sort();
      
    if (dates.length === 0) return [];
    
    // Limit to max 6 labels for clean display spacing
    const stride = Math.max(1, Math.ceil(dates.length / 6));
    const result = [];
    
    for (let i = 0; i < dates.length; i += stride) {
      const dateStr = dates[i];
      // Format to short representation, e.g. "Sep 16"
      let formatted = dateStr;
      try {
        const [, m, d] = dateStr.split('-');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        formatted = `${monthNames[parseInt(m)-1]} ${d}`;
      } catch {}

      const x = paddingLeft + (i / (dates.length - 1 || 1)) * (width - paddingLeft - paddingRight);
      result.push({ value: formatted, x });
    }
    return result;
  };

  const xTicks = getXAxisDates();

  const handlePointHover = (e: React.MouseEvent, pointData: any, type: 'e1rm' | 'tonnage') => {
    const rect = e.currentTarget.parentElement?.getBoundingClientRect();
    if (rect) {
      const x = e.clientX - rect.left + 15;
      const y = e.clientY - rect.top - 80;
      setTooltipPos({ x, y });
      setHoveredPoint({ ...pointData, type });
    }
  };

  const handleACWRMouseMove = (e: React.MouseEvent<SVGSVGElement>, coords: any[]) => {
    if (coords.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Find the coordinate with the closest X value
    let closest = coords[0];
    let minDiff = Math.abs(coords[0].x - mouseX);
    
    for (let i = 1; i < coords.length; i++) {
      const diff = Math.abs(coords[i].x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closest = coords[i];
      }
    }
    
    // Position tooltip near the hover point
    setTooltipPos({
      x: closest.x + 15,
      y: closest.y - 120
    });
    setHoveredPoint({
      ...closest.data,
      type: 'acwr',
      x: closest.x,
      y: closest.y
    });
  };

  return (
    <div className="flex-1 overflow-y-auto p-2 bg-[#0A0A0A]">
      <div className="space-y-2 pb-8">
        <div className="h-7 flex items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2 min-w-0">
            <h2 className="text-sm text-white">Insights</h2>
            <span className="text-[11px] text-[#AEAEB2] truncate">e1RM · tonnage · ACWR · DOTS</span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {(['All', '90d', '30d'] as const).map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                className={`px-2 h-7 text-xs rounded ${
                  timeRange === range ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
                }`}
              >
                {range === 'All' ? 'All' : range}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <p className="px-1 text-xs text-[#AEAEB2]">Loading…</p>
        ) : trends.length === 0 ? (
          <p className="px-1 text-xs text-[#AEAEB2]">No logged sets yet. Complete a session to seed e1RM and tonnage.</p>
        ) : (
          <>
            <div className="px-1 h-7 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono border-b border-white/10">
              <span className="text-[#AEAEB2]">SQ <span className="text-white">{peakSquat > 0 ? Math.round(peakSquat) : '—'}</span></span>
              <span className="text-[#AEAEB2]">BP <span className="text-white">{peakBench > 0 ? Math.round(peakBench) : '—'}</span></span>
              <span className="text-[#AEAEB2]">DL <span className="text-white">{peakDeadlift > 0 ? Math.round(peakDeadlift) : '—'}</span></span>
              <span className="text-[#AEAEB2]">Vol <span className="text-white">{(cumulativeVolume / 1000).toFixed(1)}t</span></span>
              <span className="text-[#AEAEB2]">DOTS <span className="text-white">{analytics?.dots_score > 0 ? analytics.dots_score : '—'}</span></span>
              <span className={`ml-auto ${cnsAssessment.class}`}>
                {analytics?.fatigue_metrics?.acute_chronic_ratio != null
                  ? `ACWR ${analytics.fatigue_metrics.acute_chronic_ratio}`
                  : cnsAssessment.status}
              </span>
            </div>

            {analytics?.fatigue_metrics && (
              <p className="px-1 text-[10px] text-[#AEAEB2] font-mono">
                INOL W · SQ {analytics.fatigue_metrics.weekly_inol_squat} · BP {analytics.fatigue_metrics.weekly_inol_bench} · DL {analytics.fatigue_metrics.weekly_inol_deadlift}
                <span className={`ml-2 ${cnsAssessment.class}`}>{cnsAssessment.status}</span>
              </p>
            )}

            <div className="border-b border-white/10 px-1 py-1">
              <div className="h-7 flex items-center justify-between gap-2">
                <span className="text-[11px] text-[#AEAEB2]">AI coach</span>
                <button
                  type="button"
                  onClick={triggerAICoachAnalysis}
                  disabled={aiLoading}
                  className="h-7 px-2 text-[11px] text-white bg-white/10 rounded disabled:opacity-50"
                >
                  {aiLoading ? 'Running…' : 'Run'}
                </button>
              </div>
              {aiError && <p className="text-[11px] text-red-400 pb-1">{aiError}</p>}
              {aiResponse && !aiLoading && (
                <div className="pb-1 space-y-1 text-[11px]">
                  <p className="font-mono text-[#AEAEB2]">
                    CNS {aiResponse.cns_readiness.score}/100 · <span className="text-white">{aiResponse.cns_readiness.status}</span>
                    {' · '}
                    RPE cap @{aiResponse.microcycle_prescription.suggested_rpe_cap}
                    {' · '}
                    <span className="text-white">{aiResponse.microcycle_prescription.loading_strategy}</span>
                  </p>
                  <p className="text-[#AEAEB2] leading-snug">{aiResponse.microcycle_prescription.tactical_guidance}</p>
                  <p className="font-mono text-[#AEAEB2]">
                    INOL SQ {aiResponse.movement_diagnostics.squat_fatigue.inol} ({aiResponse.movement_diagnostics.squat_fatigue.status})
                    {' · '}BP {aiResponse.movement_diagnostics.bench_fatigue.inol} ({aiResponse.movement_diagnostics.bench_fatigue.status})
                    {' · '}DL {aiResponse.movement_diagnostics.deadlift_fatigue.inol} ({aiResponse.movement_diagnostics.deadlift_fatigue.status})
                  </p>
                  <p className="text-[#AEAEB2]">
                    Opener: <span className="text-white">{aiResponse.attempt_feedback.opener_feasibility}</span>
                    {' — '}{aiResponse.attempt_feedback.coaching_notes}
                  </p>
                </div>
              )}
            </div>

            <div className="border-b border-white/10">
              <div className="h-7 px-1 flex items-center justify-between gap-2">
                <div className="flex items-center gap-0.5">
                  {([
                    ['e1rm', 'e1RM'],
                    ['tonnage', 'Tonnage'],
                    ['acwr', 'ACWR'],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => { setActiveChart(key); setHoveredPoint(null); }}
                      className={`px-2 h-7 text-xs rounded ${
                        activeChart === key ? 'bg-white/10 text-white' : 'text-[#AEAEB2] hover:text-white'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {activeChart === 'e1rm' && (
                  <LiftFilter
                    value={selectedLift}
                    onChange={(l) => { setSelectedLift(l); setHoveredPoint(null); }}
                  />
                )}
              </div>

              <div className="relative w-full aspect-[850/260] bg-black/30 overflow-visible">
                {(activeChart === 'acwr' ? filteredACWRSeries.length === 0 : filteredTrends.length === 0) ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[11px] text-[#AEAEB2]">No points in range</span>
                  </div>
                ) : (
                  <svg
                    viewBox={`0 0 ${width} ${height}`}
                    className="w-full h-full overflow-visible"
                    onMouseMove={activeChart === 'acwr' ? (e) => handleACWRMouseMove(e, acwrCoords) : undefined}
                    onMouseLeave={activeChart === 'acwr' ? () => setHoveredPoint(null) : undefined}
                  >
                    {yTicks.map((tick, i) => (
                      <g key={i}>
                        <line
                          x1={paddingLeft}
                          y1={tick.y}
                          x2={width - paddingRight}
                          y2={tick.y}
                          stroke="rgba(255,255,255,0.06)"
                          strokeWidth="1"
                        />
                        <text
                          x={paddingLeft - 8}
                          y={tick.y + 3}
                          fill="#8E8E93"
                          fontSize="10"
                          textAnchor="end"
                          className="font-mono"
                        >
                          {tick.value}
                        </text>
                      </g>
                    ))}

                    {xTicks.map((tick, i) => (
                      <text
                        key={i}
                        x={tick.x}
                        y={height - paddingBottom + 18}
                        fill="#8E8E93"
                        fontSize="10"
                        textAnchor="middle"
                        className="font-mono"
                      >
                        {tick.value}
                      </text>
                    ))}

                    {activeChart === 'e1rm' && (
                      <>
                        {(selectedLift === 'All' || selectedLift === 'Squat') && squatCoords.length > 1 && (
                          <path d={getBezierPath(squatCoords)} fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
                        )}
                        {(selectedLift === 'All' || selectedLift === 'Bench') && benchCoords.length > 1 && (
                          <path d={getBezierPath(benchCoords)} fill="none" stroke="#34C759" strokeWidth="2" strokeLinecap="round" />
                        )}
                        {(selectedLift === 'All' || selectedLift === 'Deadlift') && deadCoords.length > 1 && (
                          <path d={getBezierPath(deadCoords)} fill="none" stroke="#F5A623" strokeWidth="2" strokeLinecap="round" />
                        )}
                        {(selectedLift === 'All' || selectedLift === 'Squat') && squatCoords.map((c, i) => (
                          <circle key={`sq-${i}`} cx={c.x} cy={c.y} r="3.5" fill="#0A0A0A" stroke="#007AFF" strokeWidth="1.5"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}
                        {(selectedLift === 'All' || selectedLift === 'Bench') && benchCoords.map((c, i) => (
                          <circle key={`bp-${i}`} cx={c.x} cy={c.y} r="3.5" fill="#0A0A0A" stroke="#34C759" strokeWidth="1.5"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}
                        {(selectedLift === 'All' || selectedLift === 'Deadlift') && deadCoords.map((c, i) => (
                          <circle key={`dl-${i}`} cx={c.x} cy={c.y} r="3.5" fill="#0A0A0A" stroke="#F5A623" strokeWidth="1.5"
                            className="cursor-pointer"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}
                      </>
                    )}

                    {activeChart === 'tonnage' && barCoords.map((bar, i) => (
                      <g key={i}>
                        <rect
                          x={bar.x}
                          y={bar.y}
                          width={bar.width}
                          height={bar.height}
                          fill="#007AFF"
                          fillOpacity="0.7"
                          rx="1"
                          className="cursor-pointer"
                          onMouseEnter={(e) => handlePointHover(e, bar.data, 'tonnage')}
                          onMouseLeave={() => setHoveredPoint(null)}
                        />
                      </g>
                    ))}

                    {activeChart === 'acwr' && (
                      <>
                        <rect x={paddingLeft} y={getACWRY(1.3)} width={width - paddingLeft - paddingRight} height={getACWRY(0.8) - getACWRY(1.3)} fill="rgba(46, 204, 113, 0.06)" />
                        <rect x={paddingLeft} y={getACWRY(1.5)} width={width - paddingLeft - paddingRight} height={getACWRY(1.3) - getACWRY(1.5)} fill="rgba(230, 126, 34, 0.06)" />
                        <rect x={paddingLeft} y={getACWRY(acwrYMax)} width={width - paddingLeft - paddingRight} height={getACWRY(1.5) - getACWRY(acwrYMax)} fill="rgba(231, 76, 60, 0.06)" />
                        <line x1={paddingLeft} y1={getACWRY(0.8)} x2={width - paddingRight} y2={getACWRY(0.8)} stroke="rgba(241, 196, 15, 0.35)" strokeWidth="1" strokeDasharray="2 2" />
                        <line x1={paddingLeft} y1={getACWRY(1.3)} x2={width - paddingRight} y2={getACWRY(1.3)} stroke="rgba(46, 204, 113, 0.35)" strokeWidth="1" strokeDasharray="2 2" />
                        <line x1={paddingLeft} y1={getACWRY(1.5)} x2={width - paddingRight} y2={getACWRY(1.5)} stroke="rgba(231, 76, 60, 0.35)" strokeWidth="1" strokeDasharray="2 2" />
                        {acwrCoords.length > 1 && (
                          <path d={getBezierPath(acwrCoords)} fill="none" stroke="#007AFF" strokeWidth="2" strokeLinecap="round" />
                        )}
                        {acwrCoords.map((c, i) => (
                          <circle
                            key={`acwr-${i}`}
                            cx={c.x}
                            cy={c.y}
                            r="3"
                            fill="#0A0A0A"
                            stroke={
                              c.data.zone === 'OPTIMAL_ZONE' ? '#2ECC71' :
                              c.data.zone === 'ELEVATED_FATIGUE' ? '#E67E22' :
                              c.data.zone === 'DANGER_ZONE' ? '#E74C3C' :
                              '#F1C40F'
                            }
                            strokeWidth="1.5"
                          />
                        ))}
                        {hoveredPoint && hoveredPoint.type === 'acwr' && (
                          <line
                            x1={hoveredPoint.x}
                            y1={paddingTop}
                            x2={hoveredPoint.x}
                            y2={height - paddingBottom}
                            stroke="rgba(255,255,255,0.2)"
                            strokeWidth="1"
                            strokeDasharray="3 3"
                          />
                        )}
                      </>
                    )}
                  </svg>
                )}

                {hoveredPoint && (
                  <div
                    style={{ position: 'absolute', left: tooltipPos.x, top: tooltipPos.y, pointerEvents: 'none' }}
                    className="bg-[#161616] border border-white/10 rounded p-2 w-48 z-30 text-[10px] font-mono space-y-1"
                  >
                    <div className="text-[#AEAEB2]">{hoveredPoint.date}</div>
                    {hoveredPoint.type === 'e1rm' ? (
                      <>
                        <div className="text-white truncate">{hoveredPoint.exercise}</div>
                        <div className="text-[#AEAEB2]">{hoveredPoint.weight}×{hoveredPoint.reps} · e1RM {Math.round(hoveredPoint.e1rm)}</div>
                      </>
                    ) : hoveredPoint.type === 'acwr' ? (
                      <>
                        <div className="text-white">{String(hoveredPoint.zone || '').replace(/_/g, ' ')}</div>
                        <div className="text-[#AEAEB2]">ACWR {hoveredPoint.acwr} · day {hoveredPoint.daily_tonnage?.toLocaleString()}kg</div>
                        <div className="text-[#AEAEB2]">7d {hoveredPoint.acute_workload?.toLocaleString()} · 28d {hoveredPoint.chronic_workload?.toLocaleString()}</div>
                      </>
                    ) : (
                      <div className="text-[#AEAEB2]">
                        {hoveredPoint.volume?.toLocaleString()}kg
                        <span className="ml-1 text-white">
                          {hoveredPoint.delta > 0 ? `+${hoveredPoint.delta}` : hoveredPoint.delta}kg
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {activeChart === 'e1rm' && (
                <div className="h-6 px-1 flex items-center gap-3 text-[10px] text-[#AEAEB2]">
                  {(selectedLift === 'All' || selectedLift === 'Squat') && <span><span className="text-[#007AFF]">■</span> SQ</span>}
                  {(selectedLift === 'All' || selectedLift === 'Bench') && <span><span className="text-[#34C759]">■</span> BP</span>}
                  {(selectedLift === 'All' || selectedLift === 'Deadlift') && <span><span className="text-[#F5A623]">■</span> DL</span>}
                </div>
              )}
              {activeChart === 'acwr' && (
                <div className="h-6 px-1 flex items-center gap-3 text-[10px] text-[#AEAEB2]">
                  <span>0.8–1.3 ok</span>
                  <span>1.3–1.5 caution</span>
                  <span>&gt;1.5 danger</span>
                  <span>&lt;0.8 under</span>
                </div>
              )}
            </div>

            <div className="px-1 py-1 border-b border-white/10">
              <div className="h-7 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-[#AEAEB2]">Attempts</span>
                <input
                  type="number"
                  value={attemptPlannerInput}
                  onChange={(e) => setAttemptPlannerInput(parseFloat(e.target.value) || 0)}
                  className="w-20 h-7 px-2 text-xs font-mono bg-[#161616] border border-white/10 rounded text-white"
                />
                <select
                  value={attemptPlannerProfile}
                  onChange={(e) => setAttemptPlannerProfile(e.target.value as 'squat_dl'|'bench')}
                  className="h-7 px-2 text-xs bg-[#161616] border border-white/10 rounded text-white"
                >
                  <option value="squat_dl">SQ / DL</option>
                  <option value="bench">BP</option>
                </select>
                {(() => {
                  const first = attemptPlannerInput || 0;
                  const minSec = Math.round((first * 1.075) / 2.5) * 2.5;
                  let maxSec = Math.round((first * 1.10) / 2.5) * 2.5;
                  if (minSec >= maxSec) maxSec = minSec + 2.5;
                  const ceiling = attemptPlannerProfile === 'squat_dl'
                    ? Math.round((maxSec * 1.10) / 2.5) * 2.5
                    : maxSec + 10;
                  return (
                    <span className="text-[11px] font-mono text-[#AEAEB2]">
                      2nd <span className="text-white">{minSec}–{maxSec}</span>
                      {' · '}3rd <span className="text-white">{ceiling}</span>
                    </span>
                  );
                })()}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
