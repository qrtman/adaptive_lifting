import React, { useRef, useState } from 'react';
import { Share2, Copy, Check, Download, Image as ImageIcon } from 'lucide-react';
import { audioService } from '../../services/audioService';

interface ShareCardGeneratorProps {
  workoutTitle: string;
  exerciseTitle: string;
  variation: string;
  topSetText: string;
  e1rm: number;
  tensionToon?: string;
  onClose?: () => void;
}

export const ShareCardGenerator: React.FC<ShareCardGeneratorProps> = ({
  workoutTitle,
  exerciseTitle,
  variation,
  topSetText,
  e1rm,
  tensionToon = 'Q:0|G:0|H:0|C:0|B:0',
  onClose
}) => {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Parse TOON values for display
  const parseToon = (toon: string) => {
    const mapping: Record<string, string> = { Q: 'Quads', G: 'Glutes', H: 'Hamstrings', C: 'Chest', B: 'Back' };
    return toon.split('|').map(p => {
      const [k, v] = p.split(':');
      return { label: mapping[k] || k, val: parseInt(v) || 0 };
    });
  };

  const muscleTensions = parseToon(tensionToon);
  const totalTension = muscleTensions.reduce((acc, m) => acc + m.val, 0);

  const getShareText = () => {
    const tensionStr = muscleTensions
      .filter(m => m.val > 0)
      .map(m => `${m.label}: ${m.val} U`)
      .join(', ');
    return `⚡ IRON BOX TERMINAL SUMMARY\n🏋️ Workout: ${workoutTitle}\n💪 Lift: ${exerciseTitle} (${variation})\n🔥 Top Set: ${topSetText} (e1RM: ${e1rm}kg)\n🧬 Tension: ${tensionStr || '0 units'}\n#IronBoxTerminal #Powerlifting`;
  };

  const handleCopyText = async () => {
    audioService.playClick();
    try {
      await navigator.clipboard.writeText(getShareText());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy share text:', err);
    }
  };

  const handleExportImage = () => {
    audioService.playClick();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw high quality card
    const width = 600;
    const height = 400;
    canvas.width = width;
    canvas.height = height;

    // Background Gradient (Obsidian Obsidian/Slate)
    const bgGrad = ctx.createLinearGradient(0, 0, width, height);
    bgGrad.addColorStop(0, '#0B0F19');
    bgGrad.addColorStop(1, '#1E293B');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, width, height);

    // Grid details
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < width; i += 40) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, height); ctx.stroke();
    }
    for (let j = 0; j < height; j += 40) {
      ctx.beginPath(); ctx.moveTo(0, j); ctx.lineTo(width, j); ctx.stroke();
    }

    // Border glowing neon jade
    ctx.strokeStyle = '#10B981';
    ctx.lineWidth = 4;
    ctx.strokeRect(10, 10, width - 20, height - 20);

    // Title Header
    ctx.fillStyle = '#10B981';
    ctx.font = '900 18px monospace';
    ctx.fillText('⚡ IRON BOX TERMINAL // PERFORMANCE RECORD', 30, 45);

    // Workout title
    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 14px sans-serif';
    ctx.fillText(`SESSION: ${workoutTitle.toUpperCase()}`, 30, 80);

    // Exercise details
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(exerciseTitle, 30, 120);

    ctx.fillStyle = '#34D399';
    ctx.font = '500 16px monospace';
    ctx.fillText(variation, 30, 145);

    // STATS
    ctx.fillStyle = '#64748B';
    ctx.font = '900 12px monospace';
    ctx.fillText('RECORDED EFFORT', 30, 195);

    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(topSetText, 30, 225);

    ctx.fillStyle = '#34D399';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`e1RM ${e1rm}kg`, 30, 255);

    // Biomechanics Bar Graph side
    const startX = 320;
    const startY = 170;
    ctx.fillStyle = '#64748B';
    ctx.font = '900 12px monospace';
    ctx.fillText('BIOMECHANICAL TENSION', startX, 150);

    muscleTensions.forEach((m, idx) => {
      const y = startY + idx * 40;
      ctx.fillStyle = '#AEAEB2';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(m.label.toUpperCase(), startX, y);

      // Draw tension value text
      ctx.fillStyle = '#10B981';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${m.val} U`, startX + 180, y);

      // Draw bar outline
      ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.fillRect(startX, y + 6, 220, 8);

      // Draw active neon bar
      const maxVal = Math.max(100, ...muscleTensions.map(mt => mt.val));
      const barWidth = (m.val / maxVal) * 220;
      ctx.fillStyle = '#10B981';
      ctx.fillRect(startX, y + 6, barWidth, 8);
    });

    // Branding Footer
    ctx.fillStyle = '#64748B';
    ctx.font = '500 11px monospace';
    ctx.fillText('SYSTEM CODE: IB-3.5-TOON', 30, 365);
    ctx.fillText('ADAPTIVE BIO-LIFTING PLATFORM', 30, 380);

    // Download URL image
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `ironbox_${exerciseTitle.toLowerCase().replace(/\s+/g, '_')}_share.png`;
    link.href = dataUrl;
    link.click();
  };

  return (
    <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 shadow-2xl relative overflow-hidden">
      {/* Decorative Neon Jade Glow */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

      <div className="flex justify-between items-center mb-5 border-b border-white/10 pb-4">
        <div>
          <span className="text-[10px] font-mono tracking-widest text-emerald-400 font-bold uppercase">Ready to Share</span>
          <h4 className="text-lg font-bold text-white font-sans">Workout Card Generator</h4>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xs font-mono"
          >
            [CLOSE]
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Live Card Preview */}
        <div className="bg-[#0B0F19] border-2 border-emerald-500/30 rounded-xl p-5 shadow-[0_0_20px_rgba(16,185,129,0.05)] relative">
          <span className="absolute top-3 right-3 text-[9px] font-mono text-emerald-500/50 bg-emerald-500/10 px-2 py-0.5 rounded uppercase tracking-wider">PREVIEW</span>
          <div className="text-[11px] font-mono text-emerald-400 font-bold mb-2">⚡ IRON BOX TERMINAL</div>
          <div className="text-[10px] text-gray-500 mb-4">SESSION: {workoutTitle.toUpperCase()}</div>
          <div className="text-xl font-black text-white">{exerciseTitle}</div>
          <div className="text-xs text-emerald-400 font-mono mb-4">{variation}</div>

          <div className="mt-6 pt-4 border-t border-white/5 grid grid-cols-2 gap-4">
            <div>
              <span className="text-[9px] font-mono text-gray-500 uppercase block">Recorded Lift</span>
              <span className="text-sm font-bold text-white block">{topSetText}</span>
              <span className="text-[11px] font-mono text-emerald-400 font-bold uppercase">e1RM {e1rm}kg</span>
            </div>
            <div>
              <span className="text-[9px] font-mono text-gray-500 uppercase block">Total Tension</span>
              <span className="text-sm font-bold text-white block">{totalTension} Units</span>
              <span className="text-[10px] font-mono text-emerald-500/70 block uppercase">TOON ACTIVE</span>
            </div>
          </div>
        </div>

        {/* Biomechanical breakdown details */}
        <div className="flex flex-col justify-between">
          <div className="space-y-3">
            <span className="text-[10px] font-mono text-gray-400 uppercase tracking-widest block mb-1">Muscle Recruitment</span>
            {muscleTensions.map((m, idx) => (
              <div key={idx} className="flex justify-between items-center text-xs">
                <span className="text-gray-400 font-mono uppercase">{m.label}</span>
                <div className="flex items-center gap-3">
                  <div className="w-24 bg-white/5 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full rounded-full"
                      style={{ width: `${Math.min(100, (m.val / (totalTension || 100)) * 100)}%` }}
                    />
                  </div>
                  <span className="text-emerald-400 font-mono font-bold w-12 text-right">{m.val} U</span>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button 
              onClick={handleCopyText}
              className="flex-1 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 hover:border-emerald-500/50 rounded-xl text-emerald-300 font-black text-xs uppercase tracking-widest font-sans flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
            >
              {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy Post'}
            </button>
            <button 
              onClick={handleExportImage}
              className="flex-1 px-4 py-2.5 bg-emerald-500 text-black hover:bg-emerald-400 font-black text-xs uppercase tracking-widest font-sans flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95 shadow-[0_4px_12px_rgba(16,185,129,0.2)]"
            >
              <Download size={14} />
              Export Image
            </button>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} style={{ display: 'none' }} />
    </div>
  );
};
