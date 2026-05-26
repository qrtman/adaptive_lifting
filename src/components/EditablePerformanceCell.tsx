import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Minus, Plus, X } from 'lucide-react';

export const EditablePerformanceCell = ({
  value: rawValue,
  onChange,
  placeholder = "—",
  fieldKey,
  label,
  widthClass = "w-16",
  isLogged = false,
  isAuto = false,
  suggestedValue = null,
  step = 1,
  variant = "default"
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  fieldKey: string;
  label: string;
  widthClass?: string;
  isLogged?: boolean;
  isAuto?: boolean;
  suggestedValue?: string | null;
  step?: number;
  variant?: "default" | "transparent";
}) => {
  const value = rawValue === "---" ? "" : rawValue;
  const [activeCell, setActiveCell] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || navigator.maxTouchPoints > 0);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleCellClick = () => {
    if (isMobile) {
      setActiveCell(true);
    } else {
      setIsEditing(true);
    }
  };

  const handlePickerPreset = (presetValue: number | string) => {
    onChange(presetValue.toString());
  };

  const handlePickerStep = (isIncrement: boolean) => {
    const currentVal = parseFloat(value) || 0;
    let newVal;
    if (isIncrement) {
      newVal = currentVal + step;
    } else {
      newVal = Math.max(0, currentVal - step);
    }
    onChange(newVal.toString());
  };

  const getPresetsForField = () => {
    if (fieldKey.toLowerCase().includes('reps')) {
      return [1, 2, 3, 4, 5, 6, 8, 10];
    }
    if (fieldKey.toLowerCase().includes('rpe')) {
      return [6, 7, 7.5, 8, 8.5, 9, 9.5, 10];
    }
    return [40, 60, 80, 100, 120, 140, 150, 160];
  };

  return (
    <>
      {isEditing ? (
        <input
          autoFocus
          type="text"
          defaultValue={value}
          onBlur={(e) => {
            onChange(e.target.value);
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onChange((e.target as HTMLInputElement).value);
              setIsEditing(false);
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
          className={`${variant === "transparent" ? "w-20 py-2.5 text-center text-xl" : `${widthClass} py-3 text-center text-xl`} bg-[rgba(255,255,255,0.06)] border ${
            isLogged ? 'border-mac-green text-mac-green' : 'border-mac-blue text-white'
          } rounded-xl font-black font-sans focus:outline-none focus:ring-1 focus:ring-mac-blue shadow-[0_0_10px_rgba(0,122,255,0.25)] tabular-nums`}
        />
      ) : variant === "transparent" ? (
        <div 
          onClick={handleCellClick}
          className={`${widthClass} py-1 flex flex-col items-center justify-center cursor-pointer transition-all active:scale-95 select-none relative group/cell`}
        >
          <span className={`text-[24px] font-black font-sans tabular-nums tracking-tighter leading-none ${value ? 'text-white' : 'text-gray-600'}`}>
            {value ? value : placeholder}
          </span>
          <span className="text-[12px] font-black text-gray-400 uppercase tracking-widest mt-1.5 font-sans leading-none group-hover/cell:text-mac-blue transition-colors">
            Anchor
          </span>
        </div>
      ) : (
        <div 
          onClick={handleCellClick}
          className={`${widthClass} py-3 rounded-xl text-center text-xl transition-all cursor-pointer font-sans tabular-nums select-none active:scale-95 border relative group/cell ${
            isLogged 
              ? value 
                ? 'bg-mac-green/5 hover:bg-mac-green/10 border-mac-green/20 text-mac-green font-black text-2xl drop-shadow-[0_0_8px_rgba(52,199,89,0.25)]' 
                : 'bg-white/[0.02] hover:bg-white/[0.08] border-white/5 hover:border-white/15 text-gray-500 font-bold'
              : value
                ? 'bg-white/[0.02] hover:bg-white/[0.08] border-white/5 hover:border-white/15 text-gray-200 font-bold'
                : isAuto && suggestedValue
                  ? 'bg-mac-blue/5 hover:bg-mac-blue/10 border-dashed border-mac-blue/30 text-mac-blue/50 font-normal text-lg'
                  : 'bg-white/[0.02] hover:bg-white/[0.08] border-white/5 hover:border-white/15 text-gray-500 font-bold'
          }`}
        >
          {value 
            ? value 
            : isAuto && suggestedValue
              ? suggestedValue
              : placeholder}
          
          {isAuto && suggestedValue && !value && (
            <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-mac-blue/90 border border-mac-blue text-[10px] font-black uppercase text-white px-1.5 py-0.5 rounded opacity-0 group-hover/cell:opacity-100 transition-opacity whitespace-nowrap z-20 shadow">
              Auto Suggest
            </span>
          )}
        </div>
      )}

      <AnimatePresence>
        {activeCell && (
          <div className="fixed inset-0 z-50 flex items-end justify-center select-none">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setActiveCell(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            
            <motion.div 
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="relative w-full max-w-md bg-zinc-950 border-t border-white/10 rounded-t-3xl shadow-2xl p-6 pb-12 z-10 flex flex-col space-y-6"
            >
              <div className="w-12 h-1 bg-white/15 rounded-full mx-auto" />
              
              <div className="flex justify-between items-center">
                <div className="flex flex-col">
                  <span className="text-gray-400 text-xs font-bold uppercase tracking-widest">
                    Quick Adjuster
                  </span>
                  <h3 className="text-xl font-black text-white uppercase tracking-wider">
                    {label}
                  </h3>
                </div>
                <button 
                  onClick={() => setActiveCell(false)}
                  className="p-2 rounded-full hover:bg-white/5 text-gray-400 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex flex-col items-center justify-center py-4 relative bg-white/[0.02] rounded-2xl border border-white/5 mx-2">
                <span className={`text-6xl font-black tracking-widest font-mono select-none tabular-nums ${
                  isLogged ? 'text-mac-green' : 'text-mac-blue'
                }`}>
                  {value || suggestedValue || "—"}
                </span>
                {fieldKey.toLowerCase().includes('weight') && (
                  <span className="text-[12px] font-black text-mac-blue/80 uppercase tracking-widest mt-2">
                    KILOGRAMS (kg)
                  </span>
                )}
              </div>
              
              <div className="flex flex-col space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <button
                    type="button"
                    onClick={() => handlePickerStep(false)}
                    className="flex-1 py-5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/5 hover:border-white/10 rounded-2xl flex items-center justify-center text-white transition-all cursor-pointer shadow-lg"
                  >
                    <Minus size={24} className="stroke-[3]" />
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => handlePickerStep(true)}
                    className="flex-1 py-5 bg-white/5 hover:bg-white/10 active:scale-95 border border-white/5 hover:border-white/10 rounded-2xl flex items-center justify-center text-white transition-all cursor-pointer shadow-lg"
                  >
                    <Plus size={24} className="stroke-[3]" />
                  </button>
                </div>
                
                <div className="space-y-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    Tap Preset
                  </span>
                  <div className="grid grid-cols-4 gap-2">
                    {getPresetsForField().map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handlePickerPreset(preset)}
                        className={`py-3 rounded-xl text-center text-lg font-black transition-all cursor-pointer border ${
                          value === preset.toString()
                            ? isLogged 
                              ? 'bg-mac-green border-mac-green text-black shadow-[0_0_15px_rgba(52,199,89,0.3)]'
                              : 'bg-mac-blue border-mac-blue text-white shadow-[0_0_15px_rgba(0,122,255,0.3)]'
                            : 'bg-white/5 border-white/5 text-gray-300 hover:bg-white/10 hover:border-white/10'
                        }`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => setActiveCell(false)}
                className="w-full py-4 bg-white/10 hover:bg-white/15 text-white font-black uppercase text-center rounded-2xl transition-all tracking-widest cursor-pointer text-[14px] font-sans border border-white/5"
              >
                Let's Lift
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
