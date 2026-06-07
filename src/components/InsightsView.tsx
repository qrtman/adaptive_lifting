import React, { useState } from 'react';
import { BarChart3, Heart, Download } from 'lucide-react';

export function InsightsView() {
  const [timeRange, setTimeRange] = useState<'1M' | '3M' | '6M'>('3M');
  const [activeTab, setActiveTab] = useState<'cns' | 'peaks' | 'volume'>('cns');

  // Hardcoded data points for the SVG charts
  const weeks = ['Wk 01', 'Wk 02', 'Wk 03', 'Wk 04', 'Wk 05', 'Wk 06', 'Wk 07', 'Wk 08'];
  
  // ACWR fatigue wave points
  const acwrPoints = [0.92, 1.15, 0.85, 1.28, 1.45, 1.10, 0.98, 1.05];
  
  // e1RM peaks trajectories
  const squatPeaks = [172.5, 175.0, 175.0, 177.5, 180.0, 180.0, 182.5, 185.0];
  const benchPeaks = [125.0, 127.5, 127.5, 127.5, 130.0, 130.0, 132.5, 132.5];
  const deadPeaks = [220.0, 222.5, 225.0, 225.0, 230.0, 230.0, 232.5, 235.0];

  // Map numbers to SVG viewBox coordinates (width: 600, height: 180)
  const getSvgCoords = (data: number[], minVal: number, maxVal: number) => {
    const width = 540;
    const height = 120;
    const paddingX = 30;
    const paddingY = 20;

    return data.map((val, idx) => {
      const x = paddingX + (idx / (data.length - 1)) * width;
      // invert y since SVG 0 is top
      const yPercent = (val - minVal) / (maxVal - minVal);
      const y = paddingY + (1 - yPercent) * height;
      return { x, y, val };
    });
  };

  const acwrCoords = getSvgCoords(acwrPoints, 0.5, 2.0);
  const squatCoords = getSvgCoords(squatPeaks, 100, 250);
  const benchCoords = getSvgCoords(benchPeaks, 100, 250);
  const deadCoords = getSvgCoords(deadPeaks, 100, 250);

  // Generate SVG path string
  const getPathString = (coords: { x: number; y: number }[]) => {
    if (coords.length === 0) return '';
    return `M ${coords[0].x} ${coords[0].y} ` + coords.slice(1).map(c => `L ${c.x} ${c.y}`).join(' ');
  };

  return (
    <div className="p-6 font-sans space-y-6 overflow-y-auto h-full text-sm text-gray-200">
      {/* View Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4">
        <div>
          <h2 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="text-mac-blue" size={18} />
            <span>Diagnostics & Analytics Engine</span>
          </h2>
          <p className="text-[10px] font-mono text-[#AEAEB2] tracking-widest uppercase mt-0.5">
            CNS Stress Waves & Progressive Overload Tracking
          </p>
        </div>
        
        {/* Time Range Selector */}
        <div className="flex bg-white/5 border border-white/10 rounded p-1 text-[11px] font-bold uppercase font-mono">
          {(['1M', '3M', '6M'] as const).map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                timeRange === range ? 'bg-mac-blue text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-2 text-xs font-mono">
        <button
          onClick={() => setActiveTab('cns')}
          className={`pb-2.5 px-1 font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'cns' ? 'border-mac-blue text-white' : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          [ CNS Stress Wave ]
        </button>
        <button
          onClick={() => setActiveTab('peaks')}
          className={`pb-2.5 px-1 font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'peaks' ? 'border-mac-blue text-white' : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          [ Strength Peaks (e1RM) ]
        </button>
        <button
          onClick={() => setActiveTab('volume')}
          className={`pb-2.5 px-1 font-bold border-b-2 transition-all cursor-pointer ${
            activeTab === 'volume' ? 'border-mac-blue text-white' : 'border-transparent text-gray-400 hover:text-white'
          }`}
        >
          [ Tonnage & Load Dist ]
        </button>
      </div>

      {/* Main Plot Panel + KPI Column Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Plot panel */}
        <div className="lg:col-span-2 bg-[#111] border border-white/10 rounded-lg p-5 flex flex-col justify-between min-h-[350px]">
          {activeTab === 'cns' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider">CNS Stress & ACWR adaptivity curve</span>
                <span className="text-[10px] text-green-400 font-mono flex items-center gap-1"><Heart size={12}/> Target Zone: 0.8 - 1.3</span>
              </div>
              
              <div className="w-full bg-[#0A0A0A] border border-white/5 rounded p-3 relative h-48">
                <svg className="w-full h-full" viewBox="0 0 600 160">
                  {/* Grid Lines */}
                  {/* Danger Zone line at 1.5 */}
                  <line x1="30" y1="40" x2="570" y2="40" stroke="#FF453A" strokeDasharray="3,3" opacity="0.4" />
                  <text x="530" y="35" fill="#FF453A" className="text-[9px] font-mono font-bold">1.5 Caution Limit</text>
                  
                  {/* Optimal base boundary at 0.8 */}
                  <line x1="30" y1="110" x2="570" y2="110" stroke="#34C759" strokeDasharray="3,3" opacity="0.3" />
                  <text x="530" y="125" fill="#34C759" className="text-[9px] font-mono font-bold">0.8 Base</text>

                  {/* Draw curve path */}
                  <path
                    d={getPathString(acwrCoords)}
                    fill="none"
                    stroke="#007AFF"
                    strokeWidth="2.5"
                  />

                  {/* Plot Dots and Labels */}
                  {acwrCoords.map((pt, idx) => (
                    <g key={idx}>
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r="4.5"
                        fill="#007AFF"
                        className="hover:r-6 cursor-pointer"
                      />
                      <text
                        x={pt.x}
                        y={pt.y - 10}
                        textAnchor="middle"
                        fill="#AEAEB2"
                        className="text-[9px] font-mono font-bold"
                      >
                        {pt.val.toFixed(2)}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>
            </div>
          )}

          {activeTab === 'peaks' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider">Estimated 1RM Progressive overload curves (kg)</span>
                <div className="flex items-center gap-3 text-[9px] font-mono">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 block"/> SQ</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 block"/> BP</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400 block"/> DL</span>
                </div>
              </div>
              
              <div className="w-full bg-[#0A0A0A] border border-white/5 rounded p-3 relative h-48">
                <svg className="w-full h-full" viewBox="0 0 600 160">
                  {/* Squat path */}
                  <path d={getPathString(squatCoords)} fill="none" stroke="#FF453A" strokeWidth="2" />
                  {squatCoords.map((pt, idx) => <circle key={`sq-${idx}`} cx={pt.x} cy={pt.y} r="3" fill="#FF453A" />)}
                  
                  {/* Bench path */}
                  <path d={getPathString(benchCoords)} fill="none" stroke="#007AFF" strokeWidth="2" />
                  {benchCoords.map((pt, idx) => <circle key={`bp-${idx}`} cx={pt.x} cy={pt.y} r="3" fill="#007AFF" />)}
                  
                  {/* Deadlift path */}
                  <path d={getPathString(deadCoords)} fill="none" stroke="#34C759" strokeWidth="2" />
                  {deadCoords.map((pt, idx) => <circle key={`dl-${idx}`} cx={pt.x} cy={pt.y} r="3" fill="#34C759" />)}
                </svg>
              </div>
            </div>
          )}

          {activeTab === 'volume' && (
            <div>
              <div className="flex justify-between items-center mb-4">
                <span className="text-[10px] uppercase font-bold text-zinc-500 font-mono tracking-wider">Microcycle Tonnage Volume Distribution</span>
                <span className="text-[10px] text-zinc-500 font-mono">Total Volume: 138,550 kg</span>
              </div>
              
              <div className="grid grid-cols-8 gap-1.5 items-end h-40 bg-[#0A0A0A] border border-white/5 rounded p-4 font-mono text-[9px]">
                {[22000, 24500, 18200, 28100, 31000, 15000, 22400, 26900].map((tonnage, idx) => (
                  <div key={idx} className="flex flex-col items-center gap-1.5 h-full justify-end">
                    <span className="text-zinc-500 font-bold">{(tonnage/1000).toFixed(1)}k</span>
                    <div 
                      style={{ height: `${(tonnage / 35000) * 100}%` }}
                      className="w-full bg-mac-blue/20 hover:bg-mac-blue/30 border border-mac-blue/40 rounded-t transition-all"
                    />
                    <span className="text-zinc-400">Wk 0{idx+1}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* X Axis Labels */}
          <div className="flex justify-between px-8 border-t border-white/5 pt-2 text-[10px] font-mono text-zinc-500 uppercase">
            {weeks.map((w, idx) => (
              <span key={idx}>{w}</span>
            ))}
          </div>
        </div>

        {/* Diagnostics KPI Column */}
        <div className="bg-[#111] border border-white/10 rounded-lg p-5 space-y-4">
          <h3 className="text-xs font-black text-white uppercase tracking-wider font-mono">Diagnostic Benchmarks</h3>
          
          <div className="divide-y divide-white/5 font-mono text-xs">
            <div className="py-2.5 flex justify-between">
              <span className="text-zinc-500">Rolling 7d Vol:</span>
              <span className="text-white font-bold tabular-nums">28,450.0 kg</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-zinc-500">Rolling 28d Vol:</span>
              <span className="text-white font-bold tabular-nums">98,200.0 kg</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-zinc-500">Current ACWR:</span>
              <span className="text-[#34C759] font-bold tabular-nums">1.12 (Optimal)</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-zinc-500">Current INOL SQ:</span>
              <span className="text-[#34C759] font-bold tabular-nums">0.82 (Optimal)</span>
            </div>
            <div className="py-2.5 flex justify-between">
              <span className="text-zinc-500">Current INOL BP:</span>
              <span className="text-[#FF9500] font-bold tabular-nums">1.14 (Caution)</span>
            </div>
            <div className="py-2.5 flex justify-between font-bold border-t border-white/10 pt-3">
              <span className="text-white">Peak e1RM:</span>
            </div>
            <div className="py-2 flex justify-between pl-3">
              <span className="text-zinc-500">Squat:</span>
              <span className="text-white tabular-nums">185.0 kg</span>
            </div>
            <div className="py-2 flex justify-between pl-3">
              <span className="text-zinc-500">Bench:</span>
              <span className="text-white tabular-nums">132.5 kg</span>
            </div>
            <div className="py-2 flex justify-between pl-3">
              <span className="text-zinc-500">Deadlift:</span>
              <span className="text-white tabular-nums">235.0 kg</span>
            </div>
          </div>

          <button
            onClick={() => console.log('Exporting metrics...')}
            className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            <Download size={14} />
            <span>Export Analytics (CSV)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
