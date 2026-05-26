import React, { useState, useEffect, useRef } from 'react';
import { MicrocycleData, WorkoutData, ExerciseData, SetData, AccessoryData } from '../../types';
import { apiService, calculateE1RM } from '../../services/api';

interface TelegramSessionTerminalProps {
  microcycles: MicrocycleData[];
  onUpdate: (data: MicrocycleData[]) => void;
}

interface SetBuffer {
  reps: number;
  rpe: number;
  weight: number;
  note?: string;
  velocity?: string;
  readiness?: string;
  hrv?: string;
}

export default function TelegramSessionTerminal({ microcycles, onUpdate }: TelegramSessionTerminalProps) {
  // --- Find Today's Workout ---
  const todayWorkout = React.useMemo(() => {
    for (const mc of microcycles) {
      const today = mc.workouts.find((w) => w.status === 'Today');
      if (today) return today;
    }
    // Fallback: use first planned or completed workout in active microcycle
    const activeMc = microcycles.find(mc => mc.active) || microcycles[0];
    return activeMc?.workouts[0] || null;
  }, [microcycles]);

  // --- UI Tabs and Navigation State ---
  const exercises = todayWorkout?.exercises || [];
  const hasAccessories = todayWorkout?.accessories && todayWorkout.accessories.length > 0;
  
  // Tabs: index 0 to (exercises.length - 1) represent exercises, index (exercises.length) represents accessories
  const [activeTabIdx, setActiveTabIdx] = useState(0);
  const [activeSetId, setActiveSetId] = useState<string | null>(null);
  const [expandedSetId, setExpandedSetId] = useState<string | null>(null);

  // Buffer values for active exercise sets to avoid redundant API saves
  const [setBuffers, setSetBuffers] = useState<Record<string, SetBuffer>>({});

  // Active Keypad Drawer Sheet State
  const [activeInput, setActiveInput] = useState<'weight' | 'reps' | 'rpe' | null>(null);
  const [activeInputSetId, setActiveInputSetId] = useState<string | null>(null);
  const [numpadValueString, setNumpadValueString] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Advanced Metrics Toggle State
  const [expandedMetrics, setExpandedMetrics] = useState<Record<string, boolean>>({});

  const activeExercise = activeTabIdx < exercises.length ? exercises[activeTabIdx] : null;

  // --- Auto-detect / Reset Buffers and Set Selection ---
  useEffect(() => {
    if (activeExercise) {
      const newBuffers: Record<string, SetBuffer> = {};
      activeExercise.sets.forEach((s) => {
        newBuffers[s.id] = {
          reps: parseInt(s.reps || s.plannedReps || '5') || 5,
          rpe: parseFloat(s.executedRpe || s.plannedRpe || '7.0') || 7.0,
          weight: parseFloat(s.actual || s.plannedWeight || '0') || 0,
          note: s.note || '',
          velocity: s.velocity || '',
          readiness: s.readiness || '',
          hrv: s.hrv || ''
        };
      });
      setSetBuffers(newBuffers);

      // Detect first unlogged set
      const firstUnlogged = activeExercise.sets.find((s) => !s.actual);
      if (firstUnlogged) {
        setActiveSetId(firstUnlogged.id);
      } else if (activeExercise.sets.length > 0) {
        // Fallback to last set if all are logged
        setActiveSetId(activeExercise.sets[activeExercise.sets.length - 1].id);
      }
    } else {
      setSetBuffers({});
      setActiveSetId(null);
    }
  }, [activeTabIdx, activeExercise]);

  if (!todayWorkout) {
    return (
      <div className="flex h-screen items-center justify-center bg-black p-6 text-center text-zinc-400">
        <div>
          <span className="material-symbols-outlined text-4xl text-zinc-600 mb-2">error</span>
          <p>No active workout found for today.</p>
        </div>
      </div>
    );
  }

  // --- Safe Buffer Reader ---
  const getSetBuffer = (setId: string, fallbackSet: SetData): SetBuffer => {
    return setBuffers[setId] || {
      reps: parseInt(fallbackSet.reps || fallbackSet.plannedReps || '5') || 5,
      rpe: parseFloat(fallbackSet.executedRpe || fallbackSet.plannedRpe || '7.0') || 7.0,
      weight: parseFloat(fallbackSet.actual || fallbackSet.plannedWeight || '0') || 0,
      note: fallbackSet.note || '',
      velocity: fallbackSet.velocity || '',
      readiness: fallbackSet.readiness || '',
      hrv: fallbackSet.hrv || ''
    };
  };

  // --- Haptic Feedback Fallback ---
  const triggerHaptic = (type: 'light' | 'medium' | 'heavy' | 'success' | 'error' = 'medium') => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.HapticFeedback) {
      if (type === 'success' || type === 'error') {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred(type === 'heavy' ? 'heavy' : type === 'light' ? 'light' : 'medium');
      }
    } else {
      // Browser fallback vibration API
      if (navigator.vibrate) {
        if (type === 'success') {
          navigator.vibrate([40, 40, 40]);
        } else if (type === 'error') {
          navigator.vibrate([100, 50, 100]);
        } else if (type === 'heavy') {
          navigator.vibrate(24);
        } else {
          navigator.vibrate(10);
        }
      }
    }
  };

  // --- Stepper Step Handler ---
  const handleStep = (setId: string, key: 'reps' | 'rpe' | 'weight', delta: number, fallbackSet: SetData) => {
    triggerHaptic('light');
    const buf = getSetBuffer(setId, fallbackSet);
    let val = buf[key] + delta;
    
    if (key === 'reps') {
      val = Math.max(1, Math.min(25, Math.round(val)));
    } else if (key === 'rpe') {
      val = Math.max(5.0, Math.min(10.0, parseFloat(val.toFixed(2))));
    } else if (key === 'weight') {
      val = Math.max(0, parseFloat(val.toFixed(2)));
    }

    setSetBuffers((prev) => ({
      ...prev,
      [setId]: {
        ...buf,
        [key]: val
      }
    }));
  };

  // --- Open Input Numpad Sheets ---
  const openNumpad = (setId: string, context: 'weight' | 'reps' | 'rpe', fallbackSet: SetData) => {
    triggerHaptic('medium');
    setActiveInput(context);
    setActiveInputSetId(setId);
    const buf = getSetBuffer(setId, fallbackSet);
    setNumpadValueString(buf[context].toString());
  };

  // --- Numpad Matrix Operators ---
  const handleNumpadPress = (key: string) => {
    triggerHaptic('medium');
    if (key === 'BACK') {
      setNumpadValueString((prev) => prev.slice(0, -1));
    } else if (key === 'RESET') {
      const activeSet = activeExercise?.sets.find(s => s.id === activeInputSetId);
      if (activeSet) {
        if (activeInput === 'weight') setNumpadValueString(activeSet.plannedWeight || '');
        if (activeInput === 'reps') setNumpadValueString(activeSet.plannedReps || '');
        if (activeInput === 'rpe') setNumpadValueString(activeSet.plannedRpe || '');
      }
    } else {
      if (key === '.' && numpadValueString.includes('.')) return;
      if (key === '.' && activeInput === 'reps') return;
      if (numpadValueString.length >= 6) return;
      setNumpadValueString((prev) => prev + key);
    }
  };

  const handleNumpadConfirm = () => {
    if (!activeInputSetId || !activeInput) return;
    triggerHaptic('success');
    
    let val = parseFloat(numpadValueString) || 0;
    if (activeInput === 'reps') val = Math.max(1, Math.round(val));
    if (activeInput === 'rpe') val = Math.max(5.0, Math.min(10.0, val));
    if (activeInput === 'weight') val = Math.max(0, val);

    setSetBuffers((prev) => ({
      ...prev,
      [activeInputSetId]: {
        ...prev[activeInputSetId],
        [activeInput]: val
      }
    }));

    setActiveInput(null);
    setActiveInputSetId(null);
  };

  const handleNumpadInput = (char: string) => {
    handleNumpadPress(char);
  };

  const handleNumpadBackspace = () => {
    handleNumpadPress('BACK');
  };

  const clearNumpad = () => {
    triggerHaptic('medium');
    setNumpadValueString('');
  };

  // --- Telegram WebApp SDK Integration ---
  const confirmHandlersRef = useRef({ handleNumpadConfirm });
  useEffect(() => {
    confirmHandlersRef.current = { handleNumpadConfirm };
  });

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg?.initData) return;

    const handleMainButton = () => {
      confirmHandlersRef.current.handleNumpadConfirm();
    };

    const handleBackButton = () => {
      setActiveInput(null);
      setActiveInputSetId(null);
    };

    if (activeInput !== null) {
      tg.BackButton.show();
      tg.BackButton.onClick(handleBackButton);

      tg.MainButton.show();
      tg.MainButton.color = '#75ff9e';
      tg.MainButton.textColor = '#000000';
      tg.MainButton.text = 'CONFIRM';
      tg.MainButton.onClick(handleMainButton);
    } else {
      tg.BackButton.hide();
      tg.BackButton.offClick(handleBackButton);
      tg.MainButton.hide();
      tg.MainButton.offClick(handleMainButton);
    }

    return () => {
      tg.BackButton.offClick(handleBackButton);
      tg.MainButton.offClick(handleMainButton);
    };
  }, [activeInput]);

  // --- Log / Save Active Set ---
  const handleLogSet = async (setId: string, fallbackSet: SetData) => {
    if (!activeExercise || isSubmitting) return;
    
    setIsSubmitting(true);
    triggerHaptic('heavy');
    const buf = getSetBuffer(setId, fallbackSet);

    try {
      const updatedData = await apiService.logSet(
        todayWorkout.id,
        activeExercise.id,
        setId,
        buf.weight.toString(),
        buf.reps.toString(),
        buf.rpe.toFixed(1),
        buf.note,
        buf.velocity,
        buf.readiness,
        buf.hrv
      );
      
      onUpdate(updatedData);
      triggerHaptic('success');

      // Auto-advance logic
      const currentSets = activeExercise.sets;
      const currentSetIdx = currentSets.findIndex((s) => s.id === setId);
      
      if (currentSetIdx !== -1 && currentSetIdx < currentSets.length - 1) {
        setActiveSetId(currentSets[currentSetIdx + 1].id);
      } else {
        // Exercise completed, advance tabs
        if (activeTabIdx < exercises.length - 1) {
          setActiveTabIdx((prev) => prev + 1);
        } else if (hasAccessories) {
          setActiveTabIdx(exercises.length);
        }
      }
    } catch (err) {
      console.error(err);
      triggerHaptic('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Update Completed Set ---
  const handleUpdateSet = async (setId: string, fallbackSet: SetData) => {
    if (!activeExercise || isSubmitting) return;

    setIsSubmitting(true);
    triggerHaptic('heavy');
    const buf = getSetBuffer(setId, fallbackSet);

    try {
      const updatedData = await apiService.logSet(
        todayWorkout.id,
        activeExercise.id,
        setId,
        buf.weight.toString(),
        buf.reps.toString(),
        buf.rpe.toFixed(1),
        buf.note,
        buf.velocity,
        buf.readiness,
        buf.hrv
      );

      onUpdate(updatedData);
      triggerHaptic('success');
      setExpandedSetId(null);
    } catch (err) {
      console.error(err);
      triggerHaptic('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- Skip Set Logic ---
  const handleSkipSet = async (setId: string) => {
    if (!activeExercise || isSubmitting) return;

    if (window.confirm("Skip this prescribed set?")) {
      setIsSubmitting(true);
      triggerHaptic('heavy');

      try {
        const updatedData = await apiService.logSet(
          todayWorkout.id,
          activeExercise.id,
          setId,
          '0', // weight = 0 marks skipped
          '0', // reps = 0 marks skipped
          '0', // rpe = 0
          'Skipped'
        );

        onUpdate(updatedData);
        triggerHaptic('success');

        // Auto-advance logic
        const currentSets = activeExercise.sets;
        const currentSetIdx = currentSets.findIndex((s) => s.id === setId);

        if (currentSetIdx !== -1 && currentSetIdx < currentSets.length - 1) {
          setActiveSetId(currentSets[currentSetIdx + 1].id);
        } else {
          if (activeTabIdx < exercises.length - 1) {
            setActiveTabIdx((prev) => prev + 1);
          } else if (hasAccessories) {
            setActiveTabIdx(exercises.length);
          }
        }
      } catch (err) {
        console.error(err);
        triggerHaptic('error');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  // --- Accessory Log Handler ---
  const handleLogAccessory = async (accId: string, isChecked: boolean) => {
    triggerHaptic('medium');
    const acc = todayWorkout.accessories?.find(a => a.id === accId);
    if (!acc) return;

    const newStatus = isChecked ? 'Done' : 'Pending';
    const defaultWeight = acc.weight || '0';
    const defaultReps = acc.reps || acc.targetReps.split('-')[0] || '10';
    const defaultRpe = acc.executedRpe || acc.targetRpe || '8';

    try {
      const updatedData = await apiService.logAccessory(
        todayWorkout.id,
        accId,
        defaultWeight,
        defaultReps,
        defaultRpe,
        newStatus
      );
      onUpdate(updatedData);
      if (isChecked) triggerHaptic('success');
    } catch (err) {
      console.error(err);
      triggerHaptic('error');
    }
  };

  const handleUpdateAccessoryData = (accId: string, field: 'weight' | 'reps' | 'executedRpe', value: string) => {
    const acc = todayWorkout.accessories?.find(a => a.id === accId);
    if (!acc) return;

    const weight = field === 'weight' ? value : (acc.weight || '0');
    const reps = field === 'reps' ? value : (acc.reps || '10');
    const rpe = field === 'executedRpe' ? value : (acc.executedRpe || '8');
    const status = acc.status;

    apiService.logAccessory(
      todayWorkout.id,
      accId,
      weight,
      reps,
      rpe,
      status
    ).then(data => onUpdate(data));
  };

  const handleToggleExpandSet = (setId: string) => {
    triggerHaptic('medium');
    if (expandedSetId === setId) {
      setExpandedSetId(null);
    } else {
      setExpandedSetId(setId);
    }
  };

  return (
    <div className="relative flex flex-col h-screen bg-black font-sans text-white overflow-hidden pb-10">
      
      {/* --- Obsidian Top Glass Header --- */}
      <div className="sticky top-0 z-40 bg-[#0C0F0F]/80 backdrop-blur-xl border-b border-zinc-900 px-4 pt-4 pb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#75ff9e] animate-pulse"></span>
            <span className="text-xs uppercase tracking-widest text-[#75ff9e] font-semibold">Active Session</span>
          </div>
          <span className="text-xs text-zinc-500 font-mono">{todayWorkout.dayLabel} • {todayWorkout.date}</span>
        </div>
        
        <div>
          <h1 className="text-lg font-bold tracking-tight">{todayWorkout.title}</h1>
          <p className="text-xs text-zinc-400">Tonnage Logged: <strong className="text-white">{(todayWorkout.tonnage || 0).toLocaleString()}kg</strong></p>
        </div>

        {/* Swipable Jade Navigation Tabs */}
        <div className="flex gap-2 overflow-x-auto tab-bar-hide-scrollbar mt-2 pt-1">
          {exercises.map((ex, idx) => (
            <button
              key={ex.id}
              onClick={() => { triggerHaptic('medium'); setActiveTabIdx(idx); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-all duration-200 ${
                activeTabIdx === idx
                  ? 'bg-[#75ff9e] text-black border-[#75ff9e] font-extrabold shadow-[0_0_12px_rgba(117,255,158,0.3)]'
                  : 'bg-[#121414] text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              {ex.title}
            </button>
          ))}
          
          {hasAccessories && (
            <button
              onClick={() => { triggerHaptic('medium'); setActiveTabIdx(exercises.length); }}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold tracking-wide border transition-all duration-200 ${
                activeTabIdx === exercises.length
                  ? 'bg-[#75ff9e] text-black border-[#75ff9e] font-extrabold shadow-[0_0_12px_rgba(117,255,158,0.3)]'
                  : 'bg-[#121414] text-zinc-400 border-zinc-800 hover:text-white'
              }`}
            >
              Accessories
            </button>
          )}
        </div>
      </div>

      {/* --- Scrolling Workout Arena --- */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-28">
        
        {/* VIEW 1: EXERCISE VIEW */}
        {activeExercise && (
          <div className="space-y-4">
            
            {/* Dual-Line Header Layout */}
            <div className="mb-6" id="header-info">
              <h2 className="text-2xl font-extrabold text-white">{activeExercise.title}</h2>
              <div className="flex gap-2 mt-2">
                <span className="h-[24px] px-3 bg-[#75ff9e]/10 text-[#75ff9e] text-[10px] tracking-wider uppercase rounded-full flex items-center border border-[#75ff9e]/20 font-semibold">
                  {activeExercise.variation}
                </span>
                <span className="h-[24px] px-3 bg-[#1e2020] text-[#bacbb9] text-[10px] tracking-wider uppercase rounded-full flex items-center border border-white/5 font-semibold">
                  {activeExercise.sets.length} Sets
                </span>
              </div>
            </div>

            {/* Set Lists Feed */}
            <div className="space-y-3">
              {activeExercise.sets.map((set, index) => {
                const isLogged = !!set.actual;
                const isSkipped = set.reps === '0' && set.actual === '0';
                const isActive = set.id === activeSetId;
                const isExpanded = set.id === expandedSetId;

                // Render active set in its dedicated spotlight portal layout
                if (isActive) {
                  const buf = getSetBuffer(set.id, set);
                  const activeE1RM = calculateE1RM(buf.weight, buf.reps, buf.rpe);

                  return (
                    <div key={set.id} className="relative transition-transform duration-300" id="active-set-portal">
                      <div className="bg-[#121212] border border-[#75ff9e]/40 ring-2 ring-[#75ff9e]/20 shadow-2xl shadow-[#75ff9e]/10 rounded-2xl overflow-hidden" id="active-set-card">
                        
                        {/* Row 1: Status Metadata & Skip Button */}
                        <div className="flex items-center justify-between px-4 py-3 bg-[#75ff9e]/[0.02]">
                          <div className="flex items-center gap-2">
                            <div className="bg-[#10b981] px-2 py-0.5 rounded-[4px] shrink-0">
                              <span className="text-[11px] font-black text-black tracking-tighter uppercase">Active</span>
                            </div>
                            <span className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">Set {index + 1}</span>
                          </div>
                          <button 
                            className="text-[#10b981] font-black text-[11px] tracking-widest hover:opacity-80 active:scale-95 transition-all"
                            onClick={() => handleSkipSet(set.id)}
                          >
                            SKIP
                          </button>
                        </div>

                        {/* Row 2: Target & Derived e1RM Metrics */}
                        <div className="flex items-center justify-between px-4 py-3 border-t border-zinc-900/50 bg-[#121212]">
                          <p className="text-sm font-medium text-[#a1a1aa]" id="target-label">
                            Target: <span className="text-[#f59e0b] font-bold">{set.planned}</span>
                          </p>
                          <p className="text-[10px] font-mono text-[#a1a1aa] tracking-tight" id="active-e1rm">
                            e1rm: <span className="text-white font-semibold">{activeE1RM ? `${activeE1RM} kg` : '—'}</span>
                          </p>
                        </div>

                        {/* Core Interactive Steppers */}
                        <div className="p-4 space-y-4 border-t border-zinc-900/50">
                          <div className="grid grid-cols-1 gap-3">
                            <div className="grid grid-cols-2 gap-3">
                              
                              {/* Reps Stepper */}
                              <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                                <div 
                                  onClick={() => handleStep(set.id, 'reps', -1, set)}
                                  className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                                >
                                  <span className="material-symbols-outlined text-lg">remove</span>
                                </div>
                                <div 
                                  onClick={() => openNumpad(set.id, 'reps', set)}
                                  className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                                >
                                  <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">Reps</span>
                                  <span className="text-3xl font-black text-white">{buf.reps}</span>
                                </div>
                                <div 
                                  onClick={() => handleStep(set.id, 'reps', 1, set)}
                                  className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                                >
                                  <span className="material-symbols-outlined text-lg">add</span>
                                </div>
                              </div>

                              {/* RPE Stepper */}
                              <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                                <div 
                                  onClick={() => handleStep(set.id, 'rpe', -0.5, set)}
                                  className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                                >
                                  <span className="material-symbols-outlined text-lg">remove</span>
                                </div>
                                <div 
                                  onClick={() => openNumpad(set.id, 'rpe', set)}
                                  className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                                >
                                  <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">RPE</span>
                                  <span className="text-3xl font-black text-white">{buf.rpe.toFixed(1)}</span>
                                </div>
                                <div 
                                  onClick={() => handleStep(set.id, 'rpe', 0.5, set)}
                                  className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                                >
                                  <span className="material-symbols-outlined text-lg">add</span>
                                </div>
                              </div>

                            </div>

                            {/* Weight Stepper */}
                            <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                              <div 
                                onClick={() => handleStep(set.id, 'weight', -2.5, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                  <span className="material-symbols-outlined text-lg">remove</span>
                              </div>
                              <div 
                                onClick={() => openNumpad(set.id, 'weight', set)}
                                className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                              >
                                <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">Weight</span>
                                <span className="text-4xl font-black text-white leading-none">{buf.weight ? buf.weight.toFixed(1) : '0.0'}</span>
                              </div>
                              <div 
                                onClick={() => handleStep(set.id, 'weight', 2.5, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                <span className="material-symbols-outlined text-lg">add</span>
                              </div>
                            </div>

                          </div>

                          {/* Notes field */}
                          <input
                            type="text"
                            placeholder="Add micro-note (e.g. 'Paused, felt clean')"
                            value={buf.note || ''}
                            onChange={(e) => {
                              const noteText = e.target.value;
                              setSetBuffers((prev) => ({
                                ...prev,
                                [set.id]: { ...buf, note: noteText }
                              }));
                            }}
                            className="w-full text-xs bg-zinc-950/80 border border-zinc-900 rounded-xl px-3.5 py-2.5 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-zinc-800"
                          />

                          {/* Advanced metrics expanding list */}
                          <div className="flex flex-col gap-2">
                            <button
                              onClick={() => setExpandedMetrics(prev => ({ ...prev, [set.id]: !prev[set.id] }))}
                              className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider flex items-center gap-1 hover:text-white transition-colors self-start"
                            >
                              <span className="material-symbols-outlined text-[14px]">
                                {expandedMetrics[set.id] ? 'expand_less' : 'expand_more'}
                              </span>
                              Advanced Metrics
                            </button>
                            
                            {expandedMetrics[set.id] && (
                              <div className="grid grid-cols-3 gap-2">
                                <input
                                  type="text"
                                  placeholder="Vel (m/s)"
                                  value={buf.velocity || ''}
                                  onChange={(e) => {
                                    setSetBuffers(prev => ({ ...prev, [set.id]: { ...buf, velocity: e.target.value } }));
                                  }}
                                  className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700 focus:outline-none focus:border-zinc-800"
                                />
                                <input
                                  type="text"
                                  placeholder="Readiness (1-10)"
                                  value={buf.readiness || ''}
                                  onChange={(e) => {
                                    setSetBuffers(prev => ({ ...prev, [set.id]: { ...buf, readiness: e.target.value } }));
                                  }}
                                  className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700 focus:outline-none focus:border-zinc-800"
                                />
                                <input
                                  type="text"
                                  placeholder="HRV (ms)"
                                  value={buf.hrv || ''}
                                  onChange={(e) => {
                                    setSetBuffers(prev => ({ ...prev, [set.id]: { ...buf, hrv: e.target.value } }));
                                  }}
                                  className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700 focus:outline-none focus:border-zinc-800"
                                />
                              </div>
                            )}
                          </div>

                          {/* Action log button */}
                          <button
                            disabled={isSubmitting}
                            onClick={() => handleLogSet(set.id, set)}
                            className="w-full h-16 bg-[#75ff9e] text-black font-extrabold text-headline-md rounded-xl uppercase tracking-[0.2em] shadow-lg shadow-[#75ff9e]/20 flex items-center justify-center gap-3 transition-transform active:scale-95"
                          >
                            {isSubmitting ? (
                              <span className="h-5 w-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                            ) : (
                              <>
                                <span className="material-symbols-outlined font-black">done_all</span>
                                LOG SET
                              </>
                            )}
                          </button>

                        </div>

                      </div>
                    </div>
                  );
                }

                // Render Completed / Inactive Sets
                const completedBuf = getSetBuffer(set.id, set);
                const completedE1RM = isLogged ? calculateE1RM(completedBuf.weight, completedBuf.reps, completedBuf.rpe) : 0;

                return (
                  <div 
                    key={set.id} 
                    className={`bg-[#121212] border border-[#2D2D2D] rounded-lg overflow-hidden transition-all duration-300 relative ${
                      isSkipped ? 'opacity-50 border-zinc-800' : ''
                    }`}
                  >
                    
                    {/* Collapsed Card Preview Bar */}
                    <div 
                      className="flex items-center justify-between p-4 h-14 cursor-pointer"
                      onClick={() => handleToggleExpandSet(set.id)}
                    >
                      <div className="flex items-center gap-3">
                        {isSkipped ? (
                          <>
                            <span className="material-symbols-outlined text-zinc-500">block</span>
                            <p className="font-label-bold text-label-bold text-zinc-500 italic">SET {index + 1}: Skipped</p>
                          </>
                        ) : isLogged ? (
                          <>
                            <span className="material-symbols-outlined text-[#75ff9e]" style={{ fontVariationSettings: '"FILL" 1' }}>check_circle</span>
                            <div className="flex items-center justify-between flex-1 min-w-[240px]">
                              <p className="font-label-bold text-label-bold text-[#75ff9e]">
                                SET {index + 1}: {completedBuf.reps} @ {completedBuf.rpe} | {completedBuf.weight.toFixed(1)}
                              </p>
                              <p className="text-[10px] text-zinc-400 font-medium tracking-wider">
                                e1rm: {completedE1RM ? `${completedE1RM.toFixed(1)} kg` : '—'}
                              </p>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-outlined text-zinc-600">radio_button_unchecked</span>
                            <p className="font-label-bold text-label-bold text-zinc-400">SET {index + 1}: Planned {set.planned}</p>
                          </>
                        )}
                      </div>
                      <span className={`material-symbols-outlined text-zinc-500 text-sm transition-transform duration-300 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}>
                        expand_more
                      </span>
                    </div>

                    {/* Expandable Editable Steppers for completed set adjustments */}
                    {isExpanded && (
                      <div className="border-t border-white/5 bg-[#121212] p-4 space-y-4 animate-slide-up">
                        
                        <div className="flex items-center justify-between">
                          <p className="text-[11px] font-medium text-zinc-400">Modify Completed Set</p>
                          <p className="text-[10px] text-zinc-500 font-mono">e1rm: {completedE1RM ? `${completedE1RM.toFixed(1)} kg` : '—'}</p>
                        </div>

                        {/* On-Card Stepper Grid */}
                        <div className="grid grid-cols-1 gap-3">
                          <div className="grid grid-cols-2 gap-3">
                            
                            {/* Reps Stepper */}
                            <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                              <div 
                                onClick={() => handleStep(set.id, 'reps', -1, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                <span className="material-symbols-outlined text-lg">remove</span>
                              </div>
                              <div 
                                onClick={() => openNumpad(set.id, 'reps', set)}
                                className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                              >
                                <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">Reps</span>
                                <span className="text-3xl font-black text-white">{completedBuf.reps}</span>
                              </div>
                              <div 
                                onClick={() => handleStep(set.id, 'reps', 1, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                <span className="material-symbols-outlined text-lg">add</span>
                              </div>
                            </div>

                            {/* RPE Stepper */}
                            <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                              <div 
                                onClick={() => handleStep(set.id, 'rpe', -0.5, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                <span className="material-symbols-outlined text-lg">remove</span>
                              </div>
                              <div 
                                onClick={() => openNumpad(set.id, 'rpe', set)}
                                className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                              >
                                <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">RPE</span>
                                <span className="text-3xl font-black text-white">{completedBuf.rpe.toFixed(1)}</span>
                              </div>
                              <div 
                                onClick={() => handleStep(set.id, 'rpe', 0.5, set)}
                                className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                              >
                                <span className="material-symbols-outlined text-lg">add</span>
                              </div>
                            </div>

                          </div>

                          {/* Weight Stepper */}
                          <div className="flex h-[110px] bg-[#0c0f0f] border border-[#3b4a3d] rounded-xl overflow-hidden select-none">
                            <div 
                              onClick={() => handleStep(set.id, 'weight', -2.5, set)}
                              className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-r border-white/5 text-[#75ff9e]/40 font-bold"
                            >
                                <span className="material-symbols-outlined text-lg">remove</span>
                            </div>
                            <div 
                              onClick={() => openNumpad(set.id, 'weight', set)}
                              className="w-1/3 h-full flex flex-col items-center justify-center cursor-pointer active:bg-white/5"
                            >
                              <span className="text-[10px] font-black text-[#bacbb9]/40 uppercase tracking-widest mb-1">Weight</span>
                              <span className="text-4xl font-black text-white leading-none">{completedBuf.weight.toFixed(1)}</span>
                            </div>
                            <div 
                              onClick={() => handleStep(set.id, 'weight', 2.5, set)}
                              className="w-1/3 h-full flex items-center justify-center cursor-pointer active:bg-white/5 border-l border-white/5 text-[#75ff9e]/40 font-bold"
                            >
                              <span className="material-symbols-outlined text-lg">add</span>
                            </div>
                          </div>

                        </div>

                        {/* Action buttons */}
                        <div className="space-y-3 mt-4">
                          <button 
                            onClick={() => handleUpdateSet(set.id, set)}
                            disabled={isSubmitting}
                            className="w-full h-14 bg-[#75ff9e] text-black font-extrabold text-headline-sm rounded-xl uppercase tracking-[0.2em] shadow-lg shadow-[#75ff9e]/20 flex items-center justify-center gap-3 transition-transform active:scale-95"
                          >
                            <span className="material-symbols-outlined font-bold">update</span> UPDATE
                          </button>
                        </div>

                      </div>
                    )}

                  </div>
                );
              })}
            </div>

          </div>
        )}

        {/* VIEW 2: ACCESSORIES VIEW */}
        {!activeExercise && todayWorkout.accessories && (
          <div className="space-y-4">
            <h3 className="text-sm font-bold tracking-tight text-zinc-400 mb-2">Accessory Exercises</h3>
            
            <div className="space-y-3">
              {todayWorkout.accessories.map((acc) => {
                const isCompleted = acc.status === 'Done';
                
                return (
                  <div 
                    key={acc.id}
                    className={`border rounded-2xl p-4 transition-all duration-300 ${
                      isCompleted 
                        ? 'bg-[#141a16]/30 border-emerald-950/40' 
                        : 'bg-[#0C0F0F] border-zinc-900'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <h4 className="text-sm font-bold text-white">{acc.name}</h4>
                        <p className="text-[10px] text-zinc-500">
                          Prescribed: {acc.prescribedSets} Sets x {acc.targetReps} Reps @ RPE {acc.targetRpe}
                        </p>
                      </div>
                      
                      <input
                        type="checkbox"
                        checked={isCompleted}
                        onChange={(e) => handleLogAccessory(acc.id, e.target.checked)}
                        className="h-5 w-5 rounded border-zinc-800 bg-zinc-900 text-[#75ff9e] focus:ring-[#75ff9e]/50 cursor-pointer"
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 mt-2">
                      <div>
                        <span className="text-[9px] text-zinc-500 uppercase block mb-1">Weight</span>
                        <input
                          type="text"
                          value={acc.weight || ''}
                          placeholder={`${acc.weight || '—'} kg`}
                          onChange={(e) => handleUpdateAccessoryData(acc.id, 'weight', e.target.value)}
                          className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-zinc-500 uppercase block mb-1">Reps</span>
                        <input
                          type="text"
                          value={acc.reps || ''}
                          placeholder={acc.targetReps}
                          onChange={(e) => handleUpdateAccessoryData(acc.id, 'reps', e.target.value)}
                          className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700"
                        />
                      </div>
                      <div>
                        <span className="text-[9px] text-zinc-500 uppercase block mb-1">RPE</span>
                        <input
                          type="text"
                          value={acc.executedRpe || ''}
                          placeholder={`@ ${acc.targetRpe}`}
                          onChange={(e) => handleUpdateAccessoryData(acc.id, 'executedRpe', e.target.value)}
                          className="w-full text-center bg-zinc-950/60 border border-zinc-900 rounded-lg py-1.5 text-xs text-white font-mono placeholder-zinc-700"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* --- Consolidated bottom sheet unified keypad --- */}
      {activeInput !== null && (
        <>
          <div 
            onClick={() => { setActiveInput(null); setActiveInputSetId(null); }} 
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          <div 
            className="fixed bottom-0 left-0 right-0 z-50 rounded-t-3xl border-t border-zinc-800 bg-[#121212] flex flex-col shadow-[0_-10px_40px_rgba(0,0,0,0.8)] touch-none"
            style={{ height: '48dvh' }}
          >
            
            {/* Utility Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
              <span className="text-xs font-black text-[#75ff9e]/60 uppercase tracking-widest">
                EDITING {activeInput.toUpperCase()}
              </span>
              
              <div className="bg-black/40 border border-zinc-900 rounded-lg px-4 py-1.5 min-w-[80px] text-center">
                <span className="text-base font-mono font-black text-white">
                  {numpadValueString || '0'}
                </span>
                <span className="text-[10px] text-[#75ff9e] font-bold uppercase ml-1">
                  {activeInput === 'weight' ? 'kg' : activeInput === 'rpe' ? 'rpe' : 'reps'}
                </span>
              </div>

              <div className="flex items-center gap-4">
                <button 
                  className="text-xs font-bold text-[#bacbb9]/80 uppercase tracking-widest active:opacity-50 px-2 py-2"
                  onClick={clearNumpad}
                >
                  CLEAR
                </button>
                <button 
                  className="text-xs font-black text-black bg-[#75ff9e] px-4 py-2 rounded-full uppercase tracking-widest flex items-center gap-1 active:scale-95 transition-transform"
                  onClick={handleNumpadConfirm}
                >
                  CONFIRM <span className="material-symbols-outlined text-[14px]">check</span>
                </button>
              </div>
            </div>

            {/* 10-Key Matrix */}
            <div className="flex-1 p-3 grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  onClick={() => handleNumpadInput(digit)}
                  className="numpad-key rounded-xl flex items-center justify-center text-3xl font-bold text-white bg-[#1a1a1a] border border-white/5 active:bg-[#2d2d2d]"
                >
                  {digit}
                </button>
              ))}

              <button
                disabled={activeInput === 'reps'}
                onClick={() => handleNumpadInput('.')}
                className={`numpad-key rounded-xl flex items-center justify-center text-3xl font-bold text-white bg-[#1a1a1a] border border-white/5 active:bg-[#2d2d2d] ${
                  activeInput === 'reps' ? 'opacity-30 cursor-not-allowed' : ''
                }`}
              >
                .
              </button>

              <button
                onClick={() => handleNumpadInput('0')}
                className="numpad-key rounded-xl flex items-center justify-center text-3xl font-bold text-white bg-[#1a1a1a] border border-white/5 active:bg-[#2d2d2d]"
              >
                0
              </button>

              <button
                onClick={handleNumpadBackspace}
                className="numpad-key rounded-xl flex items-center justify-center text-white bg-[#1a1a1a] border border-white/5 active:bg-[#2d2d2d]"
              >
                <span className="material-symbols-outlined text-2xl">backspace</span>
              </button>
            </div>

          </div>
        </>
      )}

    </div>
  );
}
