import React, { useState, useEffect } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Activity, 
  Dumbbell, 
  Calendar, 
  Zap, 
  AlertCircle,
  CheckCircle,
  HelpCircle,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { apiService } from '../services/api';

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
      setAiError(err.message || 'An unexpected neural processing exception occurred.');
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
      const squat_inol = analytics.fatigue_metrics.weekly_inol_squat;
      const bench_inol = analytics.fatigue_metrics.weekly_inol_bench;
      const deadlift_inol = analytics.fatigue_metrics.weekly_inol_deadlift;
      
      let status = 'Functional Adaptation Cycle';
      let textClass = 'text-mac-blue';
      let bgClass = 'bg-mac-blue/10 border-mac-blue/20';
      let icon = <CheckCircle className="text-mac-blue" size={20} />;
      let description = `Training stress ACWR is at a well-balanced ${acwr}. Systemic recovery capacity matches your load delta perfectly.`;
      
      if (acwr < 0.8) {
        status = 'System Under-Training';
        textClass = 'text-amber-400';
        bgClass = 'bg-amber-500/10 border-amber-500/20';
        icon = <HelpCircle className="text-amber-400" size={20} />;
        description = `ACWR is low (${acwr}). Systemic load is below baseline adaptation thresholds. Gradually escalate training density to build fatigue resilience.`;
      } else if (acwr > 1.5) {
        status = 'CRITICAL CNS STRESS FATIGUE';
        textClass = 'text-red-500 animate-pulse';
        bgClass = 'bg-red-500/10 border-red-500/20';
        icon = <AlertCircle className="text-red-500" size={20} />;
        description = `ACWR is at a high-risk ${acwr}! Systemic stress is critically high. Cap top singles at RPE 8.0, reduce backdown sets by -10%, and prioritize nervous system decompression.`;
      } else if (acwr > 1.3) {
        status = 'System Fatigue Threshold';
        textClass = 'text-orange-500';
        bgClass = 'bg-orange-500/10 border-orange-500/20';
        icon = <AlertCircle className="text-orange-500" size={20} />;
        description = `ACWR is elevated at ${acwr}. Fatigue accumulation is out-pacing recovery. Consider a -5% downset load drop today.`;
      }
      
      description += ` | Weekly INOL Fatigue Split: Squat: ${squat_inol} (L) • Bench: ${bench_inol} (M) • Deadlift: ${deadlift_inol} (H).`;
      
      return { status, class: textClass, bg: bgClass, icon, description };
    }

    // Group trends by date to get daily tonnages
    const dailyTonnageMap: Record<string, number> = {};
    trends.forEach(p => {
      dailyTonnageMap[p.date] = (dailyTonnageMap[p.date] || 0) + p.volume;
    });

    const dates = Object.keys(dailyTonnageMap).sort();
    if (dates.length < 2) {
      return {
        status: 'Accumulating baseline',
        class: 'text-amber-400',
        bg: 'bg-amber-500/10 border-amber-500/20',
        icon: <HelpCircle className="text-amber-400" size={20} />,
        description: 'Seeding initial training volume. CNS stress delta is calibrating. Maintain planned baseline repetitions.'
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
        status: 'Supercompensation Phase',
        class: 'text-mac-green',
        bg: 'bg-mac-green/10 border-mac-green/20',
        icon: <Zap className="text-mac-green animate-pulse" size={20} />,
        description: 'High neural drive combined with positive recovery rates. Muscle motor unit recruitment is optimized. Proceed with planned top load targets and confidently explore RPE 9.0 intensity.'
      };
    } else if (netDelta < -1500) {
      return {
        status: 'CNS Fatigue Threshold Reached',
        class: 'text-orange-500',
        bg: 'bg-orange-500/10 border-orange-500/20',
        icon: <AlertCircle className="text-orange-500" size={20} />,
        description: 'Cumulative stress fatigue detected. Daily volume deltas indicate systemic fatigue suppression. Cap top singles at RPE 8.5 today and consider applying a -5% load drop on downsets to allow neurological recovery.'
      };
    } else {
      return {
        status: 'Functional Adaptation Cycle',
        class: 'text-mac-blue',
        bg: 'bg-mac-blue/10 border-mac-blue/20',
        icon: <CheckCircle className="text-mac-blue" size={20} />,
        description: 'Training load and biological adaptation are in dynamic balance. Systemic recovery capacity matches load delta. Maintain current program layout and focus on speed consistency.'
      };
    }
  };

  const cnsAssessment = getCNSAnalysis();

  // --- SVG Layout & Point Scaling Helper ---
  
  const width = 850;
  const height = 350;
  const paddingLeft = 70;
  const paddingRight = 30;
  const paddingTop = 40;
  const paddingBottom = 50;

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
    <div className="flex-1 overflow-y-auto p-8 lg:p-10 bg-[#0E0E0E] scrollbar-thin select-none">
      <div className="max-w-5xl mx-auto space-y-8 pb-20">
        
        {/* Title and Focus header */}
        <div className="pb-6 border-b border-white/5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h2 className="text-3xl font-black text-white tracking-tight font-sans flex items-center gap-3">
              <BarChart3 className="text-mac-blue" size={28} />
              Performance Insights Console
            </h2>
            <p className="text-[14px] font-black uppercase tracking-widest text-[#AEAEB2] mt-2 font-sans">
              Mike Tuchscherer's RTS Autoregulated Training Metrics & CNS Stress Diagnostics
            </p>
          </div>
          
          {/* Dynamic Periodization Status badge */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-1.5 flex gap-1 select-none font-sans">
            <button
              onClick={() => setTimeRange('All')}
              className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                timeRange === 'All' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              All cycles
            </button>
            <button
              onClick={() => setTimeRange('90d')}
              className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                timeRange === '90d' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              90 days
            </button>
            <button
              onClick={() => setTimeRange('30d')}
              className={`px-3 py-1.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                timeRange === '30d' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
              }`}
            >
              30 days
            </button>
          </div>
        </div>

        {loading ? (
          <div className="h-96 flex flex-col justify-center items-center">
            <Activity className="text-mac-blue animate-spin" size={40} />
            <span className="text-gray-400 font-bold uppercase tracking-widest text-xs mt-4">Loading dynamic datasets...</span>
          </div>
        ) : trends.length === 0 ? (
          /* Empty state placeholder */
          <div className="glass-card rounded-[24px] border border-white/5 p-12 text-center flex flex-col items-center justify-center bg-white/[0.01]">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-gray-500 mb-6">
              <TrendingUp size={30} />
            </div>
            <h3 className="text-2xl font-black text-white tracking-tight font-sans">No Logged Analytics Detected</h3>
            <p className="text-sm text-gray-400 max-w-md mt-3 leading-relaxed">
              Before strength curves can calibrate, you must record active training volumes. Head over to your **Current Mesocycle** dashboard, launch an active session, and log completed reps at executed RPE.
            </p>
          </div>
        ) : (
          <>
            {/* Top Metrics Row */}
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              
              {/* Squat Peak Card */}
              <div className="glass-card rounded-[22px] p-5 border border-white/5 flex flex-col justify-between relative overflow-hidden bg-white/[0.01]">
                <div className="absolute top-0 right-0 w-12 h-12 bg-mac-blue/5 rounded-full blur-md pointer-events-none" />
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none font-sans">Squat Peak e1RM</span>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black text-white tracking-tighter tabular-nums leading-none font-sans">
                    {peakSquat > 0 ? `${Math.round(peakSquat)}` : '—'}
                  </span>
                  {peakSquat > 0 && <span className="text-sm font-bold text-mac-blue font-sans">kg</span>}
                </div>
                <span className="text-[10px] font-black text-mac-blue uppercase tracking-wider block mt-3 font-sans">Competition Low-Bar</span>
              </div>

              {/* Bench Peak Card */}
              <div className="glass-card rounded-[22px] p-5 border border-white/5 flex flex-col justify-between relative overflow-hidden bg-white/[0.01]">
                <div className="absolute top-0 right-0 w-12 h-12 bg-mac-green/5 rounded-full blur-md pointer-events-none" />
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none font-sans">Bench Peak e1RM</span>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black text-white tracking-tighter tabular-nums leading-none font-sans">
                    {peakBench > 0 ? `${Math.round(peakBench)}` : '—'}
                  </span>
                  {peakBench > 0 && <span className="text-sm font-bold text-mac-green font-sans">kg</span>}
                </div>
                <span className="text-[10px] font-black text-mac-green uppercase tracking-wider block mt-3 font-sans">Competition Paused</span>
              </div>

              {/* Deadlift Peak Card */}
              <div className="glass-card rounded-[22px] p-5 border border-white/5 flex flex-col justify-between relative overflow-hidden bg-white/[0.01]">
                <div className="absolute top-0 right-0 w-12 h-12 bg-amber-500/5 rounded-full blur-md pointer-events-none" />
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none font-sans">Deadlift Peak e1RM</span>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black text-white tracking-tighter tabular-nums leading-none font-sans">
                    {peakDeadlift > 0 ? `${Math.round(peakDeadlift)}` : '—'}
                  </span>
                  {peakDeadlift > 0 && <span className="text-sm font-bold text-amber-500 font-sans">kg</span>}
                </div>
                <span className="text-[10px] font-black text-amber-500 uppercase tracking-wider block mt-3 font-sans">Sumo / Conventional</span>
              </div>

              {/* Cumulative Volume Card */}
              <div className="glass-card rounded-[22px] p-5 border border-white/5 flex flex-col justify-between relative overflow-hidden bg-white/[0.01]">
                <div className="absolute top-0 right-0 w-12 h-12 bg-purple-500/5 rounded-full blur-md pointer-events-none" />
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none font-sans">Cumulative Tonnage</span>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black text-white tracking-tighter tabular-nums leading-none font-sans">
                    {(cumulativeVolume / 1000).toFixed(1)}
                  </span>
                  <span className="text-sm font-bold text-purple-400 font-sans">tons</span>
                </div>
                <span className="text-[10px] font-black text-purple-400 uppercase tracking-wider block mt-3 font-sans">Total work logged</span>
              </div>

              {/* DOTS Score Card */}
              <div className="glass-card rounded-[22px] p-5 border border-white/5 flex flex-col justify-between relative overflow-hidden bg-white/[0.01]">
                <div className="absolute top-0 right-0 w-12 h-12 bg-red-500/5 rounded-full blur-md pointer-events-none" />
                <span className="text-[11px] font-black text-gray-400 uppercase tracking-widest leading-none font-sans">DOTS Score</span>
                <div className="flex items-baseline gap-1 mt-4">
                  <span className="text-3xl font-black text-white tracking-tighter leading-none font-sans">
                    {analytics?.dots_score > 0 ? `${analytics.dots_score}` : '—'}
                  </span>
                </div>
                <span className="text-[10px] font-black text-red-500 uppercase tracking-wider block mt-3 font-sans">Relative Strength Index</span>
              </div>

            </div>

            {/* Dynamic CNS Fatigue Diagnostic Panel */}
            <div className={`glass-card rounded-[24px] p-6 border ${cnsAssessment.bg} transition-all duration-300`}>
              <div className="flex items-start gap-4">
                <div className="p-3 bg-white/5 rounded-xl border border-white/10 shrink-0">
                  {cnsAssessment.icon}
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-gray-400 uppercase tracking-widest leading-none font-sans">AUTOREGULATED DIAL</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-gray-500" />
                    <span className={`text-[13px] font-black uppercase tracking-wider leading-none ${cnsAssessment.class}`}>
                      {cnsAssessment.status}
                    </span>
                  </div>
                  <h4 className="text-lg font-black text-white tracking-tight font-sans">Neurological Recovery Index</h4>
                  <p className="text-[13.5px] font-medium leading-relaxed text-gray-300 font-sans mt-2">
                    {cnsAssessment.description}
                  </p>
                </div>
              </div>
            </div>

            {/* Gemini AI Auto-Regulation Coach Panel */}
            <div className="glass-card rounded-[28px] border border-white/5 p-6 bg-white/[0.005] relative overflow-hidden flex flex-col font-sans">
              <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2 mb-2">
                <Activity className="text-amber-400" size={20} />
                Gemini AI Auto-Regulation Coach
              </h3>
              <p className="text-xs text-zinc-500 mb-6">
                Real-time biological fatigue modeling, periodization adjustments, and competition attempt validation.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-white/5 pb-6 mb-6">
                <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">
                  Evaluate current training microcycle stress curves:
                </span>
                <button
                  onClick={triggerAICoachAnalysis}
                  disabled={aiLoading}
                  className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all cursor-pointer ${
                    aiLoading
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-amber-400 text-black font-extrabold hover:bg-amber-500 shadow-lg shadow-amber-400/10 active:scale-98'
                  }`}
                >
                  {aiLoading ? 'Decompressing Core...' : 'Generate AI Prescription'}
                </button>
              </div>

              {aiLoading && (
                <div className="p-8 border border-white/5 bg-black/20 rounded-2xl flex flex-col items-center justify-center space-y-4">
                  <Activity className="text-amber-400 animate-spin" size={28} />
                  <span className="text-[11px] font-black uppercase tracking-widest text-zinc-500">
                    Decompressing neural core...
                  </span>
                </div>
              )}

              {aiError && (
                <div className="p-4 border border-red-500/20 bg-red-500/5 rounded-2xl text-red-400 text-xs font-medium leading-relaxed font-sans">
                  {aiError}
                </div>
              )}

              {aiResponse && !aiLoading && (
                <div className="space-y-6">
                  {/* Row 1: CNS Readiness & Microcycle Prescription */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* CNS Readiness */}
                    <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">CNS Readiness</span>
                        <span className="text-xs font-black px-2 py-1 rounded bg-white/5 text-zinc-300 font-mono">
                          {aiResponse.cns_readiness.score}/100
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${
                          aiResponse.cns_readiness.status === 'Functional Adaptation' ? 'bg-[#34C759]' :
                          aiResponse.cns_readiness.status === 'Neural Fatigue Suppression' ? 'bg-orange-500 animate-pulse' :
                          'bg-amber-400'
                        }`} />
                        <h4 className="text-sm font-black text-white">{aiResponse.cns_readiness.status}</h4>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                        {aiResponse.cns_readiness.analysis}
                      </p>
                    </div>

                    {/* Microcycle Prescription */}
                    <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Microcycle Prescription</span>
                        <span className="text-[10px] font-black px-2.5 py-1 rounded bg-amber-400/10 text-amber-400 uppercase tracking-wider">
                          RPE CAP: @{aiResponse.microcycle_prescription.suggested_rpe_cap}
                        </span>
                      </div>
                      <div>
                        <span className={`inline-block text-xs font-black px-2.5 py-1 rounded-lg ${
                          aiResponse.microcycle_prescription.loading_strategy.includes('Deload') ? 'bg-red-500/10 text-red-500' :
                          aiResponse.microcycle_prescription.loading_strategy.includes('Drop') ? 'bg-orange-500/10 text-orange-500' :
                          aiResponse.microcycle_prescription.loading_strategy.includes('Escalate') ? 'bg-green-500/10 text-green-500' :
                          'bg-zinc-800 text-zinc-300'
                        }`}>
                          {aiResponse.microcycle_prescription.loading_strategy}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                        {aiResponse.microcycle_prescription.tactical_guidance}
                      </p>
                    </div>
                  </div>

                  {/* Row 2: Movement Diagnostics */}
                  <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] space-y-4">
                    <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider block">Movement Diagnostics (INOL Fatigue Limits)</span>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Squat */}
                      <div className="p-4 rounded-xl border border-white/5 bg-black/20 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black text-white">Squat</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            aiResponse.movement_diagnostics.squat_fatigue.status === 'Danger' ? 'bg-red-500/10 text-red-500' :
                            aiResponse.movement_diagnostics.squat_fatigue.status === 'Caution' ? 'bg-orange-500/10 text-orange-500' :
                            'bg-[#34C759]/10 text-[#34C759]'
                          }`}>
                            {aiResponse.movement_diagnostics.squat_fatigue.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          INOL: <span className="text-white font-bold">{aiResponse.movement_diagnostics.squat_fatigue.inol}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-relaxed font-sans">
                          {aiResponse.movement_diagnostics.squat_fatigue.warning}
                        </p>
                      </div>

                      {/* Bench */}
                      <div className="p-4 rounded-xl border border-white/5 bg-black/20 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black text-white">Bench Press</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            aiResponse.movement_diagnostics.bench_fatigue.status === 'Danger' ? 'bg-red-500/10 text-red-500' :
                            aiResponse.movement_diagnostics.bench_fatigue.status === 'Caution' ? 'bg-orange-500/10 text-orange-500' :
                            'bg-[#34C759]/10 text-[#34C759]'
                          }`}>
                            {aiResponse.movement_diagnostics.bench_fatigue.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          INOL: <span className="text-white font-bold">{aiResponse.movement_diagnostics.bench_fatigue.inol}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-relaxed font-sans">
                          {aiResponse.movement_diagnostics.bench_fatigue.warning}
                        </p>
                      </div>

                      {/* Deadlift */}
                      <div className="p-4 rounded-xl border border-white/5 bg-black/20 space-y-2">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black text-white">Deadlift</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            aiResponse.movement_diagnostics.deadlift_fatigue.status === 'Danger' ? 'bg-red-500/10 text-red-500' :
                            aiResponse.movement_diagnostics.deadlift_fatigue.status === 'Caution' ? 'bg-orange-500/10 text-orange-500' :
                            'bg-[#34C759]/10 text-[#34C759]'
                          }`}>
                            {aiResponse.movement_diagnostics.deadlift_fatigue.status}
                          </span>
                        </div>
                        <div className="text-[10px] text-zinc-400 font-mono">
                          INOL: <span className="text-white font-bold">{aiResponse.movement_diagnostics.deadlift_fatigue.inol}</span>
                        </div>
                        <p className="text-[11px] text-zinc-500 leading-relaxed font-sans">
                          {aiResponse.movement_diagnostics.deadlift_fatigue.warning}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Row 3: Competition Attempts Validation */}
                  <div className="p-5 rounded-2xl border border-white/5 bg-white/[0.01] space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Meet Opener Feasibility</span>
                      <span className={`text-xs font-black px-2.5 py-1 rounded-lg ${
                        aiResponse.attempt_feedback.opener_feasibility === 'High-Risk' ? 'bg-red-500/10 text-red-500' :
                        aiResponse.attempt_feedback.opener_feasibility === 'Conservative' ? 'bg-amber-400/10 text-amber-400' :
                        'bg-[#34C759]/10 text-[#34C759]'
                      }`}>
                        {aiResponse.attempt_feedback.opener_feasibility}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed font-sans font-bold">
                      Coaching Notes:
                    </p>
                    <p className="text-xs text-zinc-400 leading-relaxed font-sans">
                      {aiResponse.attempt_feedback.coaching_notes}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Central Graph Workspace */}
            <div className="glass-card rounded-[28px] border border-white/5 p-6 bg-white/[0.005] relative overflow-hidden flex flex-col">
              
              {/* Chart Tabs / Toolbar */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
                
                {/* Switch Chart Tab */}
                <div className="flex border border-white/10 bg-black/40 rounded-xl p-1 font-sans">
                  <button
                    onClick={() => { setActiveChart('e1rm'); setHoveredPoint(null); }}
                    className={`px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      activeChart === 'e1rm' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    e1RM Strength Curves
                  </button>
                  <button
                    onClick={() => { setActiveChart('tonnage'); setHoveredPoint(null); }}
                    className={`px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      activeChart === 'tonnage' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    Tonnage & Deltas
                  </button>
                  <button
                    onClick={() => { setActiveChart('acwr'); setHoveredPoint(null); }}
                    className={`px-4 py-2.5 text-xs font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                      activeChart === 'acwr' ? 'bg-mac-blue text-white shadow' : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    ACWR Stress Analyzer
                  </button>
                </div>

                {/* Switch Movement filter (Only show for line chart) */}
                {activeChart === 'e1rm' && (
                  <div className="flex items-center gap-2">
                    <Filter size={14} className="text-gray-400" />
                    <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 select-none h-9 items-center font-sans">
                      {(['All', 'Squat', 'Bench', 'Deadlift'] as const).map(l => (
                        <button
                          key={l}
                          onClick={() => { setSelectedLift(l); setHoveredPoint(null); }}
                          className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded transition-all cursor-pointer ${
                            selectedLift === l ? 'bg-white/10 text-white font-black' : 'text-gray-400 hover:text-white'
                          }`}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Pure SVG Graph Container */}
              <div className="relative w-full aspect-[850/350] border border-white/5 bg-black/20 rounded-2xl p-2 select-none overflow-visible">
                {(activeChart === 'acwr' ? filteredACWRSeries.length === 0 : filteredTrends.length === 0) ? (
                  <div className="absolute inset-0 flex flex-col justify-center items-center">
                    <AlertCircle className="text-orange-500 animate-pulse mb-3" size={24} />
                    <span className="text-xs text-gray-500 font-black uppercase tracking-widest">No matching logged points found</span>
                  </div>
                ) : (
                  <svg 
                    viewBox={`0 0 ${width} ${height}`} 
                    className="w-full h-full overflow-visible"
                    onMouseMove={activeChart === 'acwr' ? (e) => handleACWRMouseMove(e, acwrCoords) : undefined}
                    onMouseLeave={activeChart === 'acwr' ? () => setHoveredPoint(null) : undefined}
                  >
                    {/* SVG Filters for glowing paths */}
                    <defs>
                      <filter id="glow-blue" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#007AFF" floodOpacity="0.4" />
                      </filter>
                      <filter id="glow-green" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#34C759" floodOpacity="0.4" />
                      </filter>
                      <filter id="glow-amber" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#F5A623" floodOpacity="0.4" />
                      </filter>
                    </defs>

                    {/* Y-Axis Horizontal Grid Lines & Tick Labels */}
                    {yTicks.map((tick, i) => (
                      <g key={i} className="opacity-40">
                        <line 
                          x1={paddingLeft} 
                          y1={tick.y} 
                          x2={width - paddingRight} 
                          y2={tick.y} 
                          stroke="rgba(255,255,255,0.06)" 
                          strokeWidth="1"
                          strokeDasharray="4 4"
                        />
                        <text 
                          x={paddingLeft - 15} 
                          y={tick.y + 4} 
                          fill="#8E8E93" 
                          fontSize="11" 
                          fontWeight="bold"
                          textAnchor="end"
                          className="font-mono"
                        >
                          {tick.value}
                        </text>
                      </g>
                    ))}

                    {/* X-Axis Dates Labels */}
                    {xTicks.map((tick, i) => (
                      <text
                        key={i}
                        x={tick.x}
                        y={height - paddingBottom + 25}
                        fill="#8E8E93"
                        fontSize="11"
                        fontWeight="bold"
                        textAnchor="middle"
                        className="font-sans opacity-60"
                      >
                        {tick.value}
                      </text>
                    ))}

                    {/* 1. Render e1RM Lines & Curves */}
                    {activeChart === 'e1rm' && (
                      <>
                        {/* Squat Line */}
                        {(selectedLift === 'All' || selectedLift === 'Squat') && squatCoords.length > 1 && (
                          <path 
                            d={getBezierPath(squatCoords)} 
                            fill="none" 
                            stroke="#007AFF" 
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            filter="url(#glow-blue)"
                          />
                        )}
                        {/* Bench Line */}
                        {(selectedLift === 'All' || selectedLift === 'Bench') && benchCoords.length > 1 && (
                          <path 
                            d={getBezierPath(benchCoords)} 
                            fill="none" 
                            stroke="#34C759" 
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            filter="url(#glow-green)"
                          />
                        )}
                        {/* Deadlift Line */}
                        {(selectedLift === 'All' || selectedLift === 'Deadlift') && deadCoords.length > 1 && (
                          <path 
                            d={getBezierPath(deadCoords)} 
                            fill="none" 
                            stroke="#F5A623" 
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            filter="url(#glow-amber)"
                          />
                        )}

                        {/* Squat Dots */}
                        {(selectedLift === 'All' || selectedLift === 'Squat') && squatCoords.map((c, i) => (
                          <circle 
                            key={`sq-${i}`} 
                            cx={c.x} 
                            cy={c.y} 
                            r="6" 
                            fill="#0E0E0E" 
                            stroke="#007AFF" 
                            strokeWidth="3"
                            className="cursor-pointer transition-transform hover:scale-150"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}

                        {/* Bench Dots */}
                        {(selectedLift === 'All' || selectedLift === 'Bench') && benchCoords.map((c, i) => (
                          <circle 
                            key={`bp-${i}`} 
                            cx={c.x} 
                            cy={c.y} 
                            r="6" 
                            fill="#0E0E0E" 
                            stroke="#34C759" 
                            strokeWidth="3"
                            className="cursor-pointer transition-transform hover:scale-150"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}

                        {/* Deadlift Dots */}
                        {(selectedLift === 'All' || selectedLift === 'Deadlift') && deadCoords.map((c, i) => (
                          <circle 
                            key={`dl-${i}`} 
                            cx={c.x} 
                            cy={c.y} 
                            r="6" 
                            fill="#0E0E0E" 
                            stroke="#F5A623" 
                            strokeWidth="3"
                            className="cursor-pointer transition-transform hover:scale-150"
                            onMouseEnter={(e) => handlePointHover(e, c.data, 'e1rm')}
                            onMouseLeave={() => setHoveredPoint(null)}
                          />
                        ))}
                      </>
                    )}

                    {/* 2. Render Tonnage Column Bar Chart */}
                    {activeChart === 'tonnage' && (
                      <>
                        {barCoords.map((bar, i) => {
                          const isNegative = bar.data.delta < 0;
                          return (
                            <g key={i}>
                              {/* Background Bar track */}
                              <rect
                                x={bar.x}
                                y={paddingTop}
                                width={bar.width}
                                height={height - paddingTop - paddingBottom}
                                fill="rgba(255,255,255,0.015)"
                                rx="3"
                              />
                              {/* Main Glowing Tonnage Bar */}
                              <rect
                                x={bar.x}
                                y={bar.y}
                                width={bar.width}
                                height={bar.height}
                                fill="url(#barGradient)"
                                rx="3"
                                className="cursor-pointer transition-opacity hover:opacity-85"
                                onMouseEnter={(e) => handlePointHover(e, bar.data, 'tonnage')}
                                onMouseLeave={() => setHoveredPoint(null)}
                              />
                              
                              {/* Linear gradient mapping definition */}
                              <defs>
                                <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#007AFF" stopOpacity="0.85" />
                                  <stop offset="100%" stopColor="#007AFF" stopOpacity="0.1" />
                                </linearGradient>
                              </defs>
                            </g>
                          );
                        })}
                      </>
                    )}

                    {/* 3. Render ACWR Time-Series Chart */}
                    {activeChart === 'acwr' && (
                      <>
                        {/* Shaded Safety Zones Background Bands */}
                        {/* 1. Under-training zone (< 0.8) */}
                        {getACWRY(0.8) > getACWRY(0.0) && (
                          <rect
                            x={paddingLeft}
                            y={getACWRY(0.8)}
                            width={width - paddingLeft - paddingRight}
                            height={getACWRY(0.0) - getACWRY(0.8)}
                            fill="rgba(241, 196, 15, 0.04)"
                          />
                        )}
                        {/* 2. Optimal zone (0.8 - 1.3) */}
                        <rect
                          x={paddingLeft}
                          y={getACWRY(1.3)}
                          width={width - paddingLeft - paddingRight}
                          height={getACWRY(0.8) - getACWRY(1.3)}
                          fill="rgba(46, 204, 113, 0.08)"
                        />
                        {/* 3. Caution zone (1.3 - 1.5) */}
                        <rect
                          x={paddingLeft}
                          y={getACWRY(1.5)}
                          width={width - paddingLeft - paddingRight}
                          height={getACWRY(1.3) - getACWRY(1.5)}
                          fill="rgba(230, 126, 34, 0.08)"
                        />
                        {/* 4. Danger zone (> 1.5) */}
                        <rect
                          x={paddingLeft}
                          y={getACWRY(acwrYMax)}
                          width={width - paddingLeft - paddingRight}
                          height={getACWRY(1.5) - getACWRY(acwrYMax)}
                          fill="rgba(231, 76, 60, 0.08)"
                        />

                        {/* Zone Boundary Dotted Line Anchors */}
                        <line
                          x1={paddingLeft}
                          y1={getACWRY(0.8)}
                          x2={width - paddingRight}
                          y2={getACWRY(0.8)}
                          stroke="rgba(241, 196, 15, 0.3)"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <text
                          x={width - paddingRight - 5}
                          y={getACWRY(0.8) - 4}
                          fill="rgba(241, 196, 15, 0.6)"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="end"
                        >
                          UNDER-TRAINING THRESHOLD (0.8)
                        </text>

                        <line
                          x1={paddingLeft}
                          y1={getACWRY(1.3)}
                          x2={width - paddingRight}
                          y2={getACWRY(1.3)}
                          stroke="rgba(46, 204, 113, 0.3)"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <text
                          x={width - paddingRight - 5}
                          y={getACWRY(1.3) - 4}
                          fill="rgba(46, 204, 113, 0.6)"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="end"
                        >
                          OPTIMAL LIMIT (1.3)
                        </text>

                        <line
                          x1={paddingLeft}
                          y1={getACWRY(1.5)}
                          x2={width - paddingRight}
                          y2={getACWRY(1.5)}
                          stroke="rgba(231, 76, 60, 0.3)"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                        />
                        <text
                          x={width - paddingRight - 5}
                          y={getACWRY(1.5) - 4}
                          fill="rgba(231, 76, 60, 0.6)"
                          fontSize="9"
                          fontWeight="bold"
                          textAnchor="end"
                        >
                          DANGER ZONE (1.5)
                        </text>

                        {/* ACWR Vector Line */}
                        {acwrCoords.length > 1 && (
                          <path
                            d={getBezierPath(acwrCoords)}
                            fill="none"
                            stroke="#007AFF"
                            strokeWidth="3.5"
                            strokeLinecap="round"
                            filter="url(#glow-blue)"
                          />
                        )}

                        {/* ACWR Dots */}
                        {acwrCoords.map((c, i) => (
                          <circle
                            key={`acwr-${i}`}
                            cx={c.x}
                            cy={c.y}
                            r="5"
                            fill="#0E0E0E"
                            stroke={
                              c.data.zone === 'OPTIMAL_ZONE' ? '#2ECC71' :
                              c.data.zone === 'ELEVATED_FATIGUE' ? '#E67E22' :
                              c.data.zone === 'DANGER_ZONE' ? '#E74C3C' :
                              '#F1C40F'
                            }
                            strokeWidth="3"
                          />
                        ))}

                        {/* Interactive Crosshair & Hover marker point */}
                        {hoveredPoint && hoveredPoint.type === 'acwr' && (
                          <g>
                            <line
                              x1={hoveredPoint.x}
                              y1={paddingTop}
                              x2={hoveredPoint.x}
                              y2={height - paddingBottom}
                              stroke="rgba(255, 255, 255, 0.25)"
                              strokeWidth="1.5"
                              strokeDasharray="3 3"
                            />
                            <circle
                              cx={hoveredPoint.x}
                              cy={hoveredPoint.y}
                              r="7"
                              fill="#007AFF"
                              stroke="#FFFFFF"
                              strokeWidth="2.5"
                              className="animate-ping"
                              style={{ transformOrigin: `${hoveredPoint.x}px ${hoveredPoint.y}px` }}
                            />
                            <circle
                              cx={hoveredPoint.x}
                              cy={hoveredPoint.y}
                              r="7"
                              fill="#007AFF"
                              stroke="#FFFFFF"
                              strokeWidth="2.5"
                            />
                          </g>
                        )}
                      </>
                    )}
                  </svg>
                )}

                {/* Premium Glassmorphic Overlay Hover Tooltip */}
                <AnimatePresence>
                  {hoveredPoint && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      transition={{ duration: 0.15 }}
                      style={{ 
                        position: 'absolute', 
                        left: tooltipPos.x, 
                        top: tooltipPos.y, 
                        pointerEvents: 'none' 
                      }}
                      className="bg-black/85 border border-white/10 rounded-2xl p-4 shadow-2xl backdrop-blur-md w-56 space-y-2.5 z-30"
                    >
                      <div className="flex justify-between items-center border-b border-white/5 pb-1.5">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest font-sans">
                          {hoveredPoint.date}
                        </span>
                        {hoveredPoint.type === 'e1rm' ? (
                          <span className={`w-2.5 h-2.5 rounded-full ${
                            hoveredPoint.exercise.toLowerCase().includes('squat') ? 'bg-mac-blue' :
                            hoveredPoint.exercise.toLowerCase().includes('bench') ? 'bg-mac-green' :
                            'bg-amber-500'
                          }`} />
                        ) : hoveredPoint.type === 'acwr' ? (
                          <span className={`w-2.5 h-2.5 rounded-full ${
                            hoveredPoint.zone === 'OPTIMAL_ZONE' ? 'bg-[#2ECC71]' :
                            hoveredPoint.zone === 'ELEVATED_FATIGUE' ? 'bg-[#E67E22]' :
                            hoveredPoint.zone === 'DANGER_ZONE' ? 'bg-[#E74C3C]' :
                            'bg-[#F1C40F]'
                          }`} />
                        ) : (
                          <span className="w-2.5 h-2.5 rounded-full bg-mac-blue" />
                        )}
                      </div>

                      {hoveredPoint.type === 'e1rm' ? (
                        <>
                          <div className="space-y-0.5">
                            <h5 className="text-[13.5px] font-black text-white font-sans truncate">
                              {hoveredPoint.exercise}
                            </h5>
                            <span className="text-[10px] font-black text-mac-blue uppercase tracking-widest block font-sans">
                              {hoveredPoint.variation}
                            </span>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div>
                              <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block font-sans">Set Logged</span>
                              <span className="text-white font-extrabold text-[12.5px] font-mono leading-none">
                                {hoveredPoint.weight}kg x {hoveredPoint.reps}
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block font-sans">Calculated</span>
                              <span className="text-mac-green font-extrabold text-[13px] font-mono leading-none">
                                {Math.round(hoveredPoint.e1rm)}kg e1RM
                              </span>
                            </div>
                          </div>
                        </>
                      ) : hoveredPoint.type === 'acwr' ? (
                        <>
                          <div className="space-y-0.5">
                            <h5 className="text-[14px] font-black text-white font-sans">
                              Stress Analytics
                            </h5>
                            <span className={`text-[10px] font-black uppercase tracking-widest block font-sans ${
                              hoveredPoint.zone === 'OPTIMAL_ZONE' ? 'text-[#2ECC71]' :
                              hoveredPoint.zone === 'ELEVATED_FATIGUE' ? 'text-[#E67E22]' :
                              hoveredPoint.zone === 'DANGER_ZONE' ? 'text-[#E74C3C]' :
                              'text-[#F1C40F]'
                            }`}>
                              {hoveredPoint.zone.replace('_', ' ')}
                            </span>
                          </div>
                          
                          <div className="space-y-1.5 pt-1 text-xs">
                            <div className="flex justify-between">
                              <span className="text-gray-400 font-bold">Daily Tonnage:</span>
                              <span className="text-white font-mono font-bold">{hoveredPoint.daily_tonnage.toLocaleString()}kg</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 font-bold">Acute (7d):</span>
                              <span className="text-white font-mono font-bold">{hoveredPoint.acute_workload.toLocaleString()}kg</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-gray-400 font-bold">Chronic (28d):</span>
                              <span className="text-white font-mono font-bold">{hoveredPoint.chronic_workload.toLocaleString()}kg</span>
                            </div>
                            <div className="flex justify-between border-t border-white/5 pt-1">
                              <span className="text-gray-400 font-bold">ACWR Ratio:</span>
                              <span className="text-mac-blue font-mono font-black text-sm">{hoveredPoint.acwr}</span>
                            </div>
                          </div>
                          
                          <div className="border-t border-white/5 pt-1.5 text-[10px] text-gray-300 font-medium leading-relaxed font-sans">
                            {hoveredPoint.zone === 'UNDER_TRAINING' ? 'Stimulus is low. Esc. tonnage target by +10%.' :
                             hoveredPoint.zone === 'OPTIMAL_ZONE' ? 'Optimal training. Maintain planned layout.' :
                             hoveredPoint.zone === 'ELEVATED_FATIGUE' ? 'System fatigue elevated. Apply -5% load drop.' :
                             'WARNING: High injury risk! Cap top singles at RPE 8.0 & deload by -20%.'}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-0.5">
                            <h5 className="text-[14px] font-black text-white font-sans">
                              Total Daily Tonnage
                            </h5>
                          </div>
                          
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <div>
                              <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block font-sans">Volume</span>
                              <span className="text-white font-extrabold text-[13px] font-mono leading-none">
                                {hoveredPoint.volume.toLocaleString()}kg
                              </span>
                            </div>
                            <div>
                              <span className="text-[9px] font-black text-gray-400 uppercase tracking-wider block font-sans">Session delta</span>
                              <span className={`font-extrabold text-[12.5px] font-mono leading-none ${
                                hoveredPoint.delta > 0 ? 'text-mac-green' : hoveredPoint.delta < 0 ? 'text-orange-500' : 'text-gray-400'
                              }`}>
                                {hoveredPoint.delta > 0 ? `+${hoveredPoint.delta}kg` : `${hoveredPoint.delta}kg`}
                              </span>
                            </div>
                          </div>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Chart Legend */}
              {activeChart === 'e1rm' && (
                <div className="mt-6 border-t border-white/5 pt-4 flex flex-wrap gap-6 items-center justify-center font-sans text-xs font-bold">
                  {(selectedLift === 'All' || selectedLift === 'Squat') && (
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-1.5 rounded bg-mac-blue" />
                      <span className="text-gray-300">Squat e1RM Tracker</span>
                    </div>
                  )}
                  {(selectedLift === 'All' || selectedLift === 'Bench') && (
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-1.5 rounded bg-mac-green" />
                      <span className="text-gray-300">Bench e1RM Tracker</span>
                    </div>
                  )}
                  {(selectedLift === 'All' || selectedLift === 'Deadlift') && (
                    <div className="flex items-center gap-2">
                      <span className="w-3.5 h-1.5 rounded bg-amber-500" />
                      <span className="text-gray-300">Deadlift e1RM Tracker</span>
                    </div>
                  )}
                </div>
              )}
              {activeChart === 'acwr' && (
                <div className="mt-6 border-t border-white/5 pt-4 flex flex-wrap gap-6 items-center justify-center font-sans text-xs font-bold">
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#2ECC71]/20 border border-[#2ECC71]/30" />
                    <span className="text-gray-300">Optimal Zone (0.8 - 1.3)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#E67E22]/20 border border-[#E67E22]/30" />
                    <span className="text-gray-300">Caution Zone (1.3 - 1.5)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#E74C3C]/20 border border-[#E74C3C]/30" />
                    <span className="text-gray-300">Danger Zone (&gt; 1.5)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3.5 h-3.5 rounded bg-[#F1C40F]/20 border border-[#F1C40F]/30" />
                    <span className="text-gray-300">Under-Training (&lt; 0.8)</span>
                  </div>
                </div>
              )}
            </div>

            {/* Interactive Attempt Selection Engine */}
            <div className="glass-card rounded-[28px] border border-white/5 p-6 bg-white/[0.005] relative overflow-hidden flex flex-col font-sans">
              <h3 className="text-lg font-black text-white tracking-tight flex items-center gap-2 mb-2">
                <TrendingUp className="text-mac-blue" size={20} />
                Interactive Attempt Selection Planner
              </h3>
              <p className="text-xs text-zinc-500 mb-6">
                Calculate your competition attempts based on your peak estimated 1RM.
              </p>
              
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <label className="text-xs text-zinc-400 mb-2 block font-bold uppercase tracking-wider">Target Opener / 1st Attempt (kg):</label>
                  <input 
                    type="number" 
                    value={attemptPlannerInput}
                    onChange={(e) => setAttemptPlannerInput(parseFloat(e.target.value) || 0)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-mac-blue font-mono font-bold"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-zinc-400 mb-2 block font-bold uppercase tracking-wider">Movement Category:</label>
                  <select 
                    value={attemptPlannerProfile}
                    onChange={(e) => setAttemptPlannerProfile(e.target.value as 'squat_dl'|'bench')}
                    className="w-full bg-[#121212] border border-white/10 rounded-xl p-3 text-white focus:outline-none focus:border-mac-blue font-bold"
                  >
                    <option value="squat_dl">Squat / Deadlift</option>
                    <option value="bench">Bench Press</option>
                  </select>
                </div>
              </div>

              {(() => {
                const first = attemptPlannerInput || 0;
                const minSec = Math.round((first * 1.075) / 2.5) * 2.5;
                let maxSec = Math.round((first * 1.10) / 2.5) * 2.5;
                if (minSec >= maxSec) maxSec = minSec + 2.5;
                
                let ceiling = 0;
                if (attemptPlannerProfile === 'squat_dl') {
                  ceiling = Math.round((maxSec * 1.10) / 2.5) * 2.5;
                } else {
                  ceiling = maxSec + 10;
                }

                return (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex justify-between items-center">
                      <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Suggested 2nd Attempt Range:</span>
                      <span className="text-lg font-black text-white font-mono">{minSec}kg - {maxSec}kg</span>
                    </div>
                    <div className="bg-white/[0.02] border border-white/5 p-4 rounded-2xl flex justify-between items-center">
                      <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Statistical 3rd Attempt Ceiling:</span>
                      <span className="text-lg font-black text-mac-blue font-mono">{ceiling}kg</span>
                    </div>
                  </div>
                );
              })()}
            </div>
          </>
        )}

      </div>
    </div>
  );
}
