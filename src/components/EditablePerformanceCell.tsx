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
  variant = "default",
  rowIndex
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
  rowIndex?: number;
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
              if (rowIndex !== undefined) {
                setTimeout(() => {
                  const nextCell = document.getElementById(`cell-${fieldKey}-${rowIndex + 1}`);
                  if (nextCell) nextCell.click();
                }, 50);
              }
            } else if (e.key === 'ArrowDown') {
              onChange((e.target as HTMLInputElement).value);
              setIsEditing(false);
              if (rowIndex !== undefined) {
                setTimeout(() => {
                  const nextCell = document.getElementById(`cell-${fieldKey}-${rowIndex + 1}`);
                  if (nextCell) nextCell.click();
                }, 50);
              }
            } else if (e.key === 'ArrowUp') {
              onChange((e.target as HTMLInputElement).value);
              setIsEditing(false);
              if (rowIndex !== undefined && rowIndex > 0) {
                setTimeout(() => {
                  const nextCell = document.getElementById(`cell-${fieldKey}-${rowIndex - 1}`);
                  if (nextCell) nextCell.click();
                }, 50);
              }
            } else if (e.key === 'Escape') {
              setIsEditing(false);
            }
          }}
          className={`${variant === "transparent" ? "w-12 py-0 text-center text-xs" : `${widthClass} py-0 h-6 text-center text-xs`} bg-[#161616] border ${
            isLogged ? 'border-[#34C759] text-[#34C759]' : 'border-[#007AFF] text-white'
          } rounded-sm font-mono tabular-nums focus:outline-none`}
        />
      ) : variant === "transparent" ? (
        <div 
          onClick={handleCellClick}
          id={rowIndex !== undefined ? `cell-${fieldKey}-${rowIndex}` : undefined}
          className={`${widthClass} h-6 flex items-center justify-center cursor-pointer select-none`}
        >
          <span className={`text-xs font-mono tabular-nums ${value ? 'text-white' : 'text-[#636366]'}`}>
            {value ? value : placeholder}
          </span>
        </div>
      ) : (
        <div 
          onClick={handleCellClick}
          id={rowIndex !== undefined ? `cell-${fieldKey}-${rowIndex}` : undefined}
          className={`${widthClass} h-6 rounded-sm text-center text-xs font-mono tabular-nums cursor-pointer border flex items-center justify-center ${
            isLogged 
              ? value 
                ? 'border-[#34C759]/40 text-[#34C759]' 
                : 'border-white/10 text-[#636366]'
              : value
                ? 'border-white/10 text-white'
                : isAuto && suggestedValue
                  ? 'border-dashed border-[#007AFF]/40 text-[#007AFF]/70'
                  : 'border-white/10 text-[#636366]'
          }`}
        >
          {value 
            ? value 
            : isAuto && suggestedValue
              ? suggestedValue
              : placeholder}
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
