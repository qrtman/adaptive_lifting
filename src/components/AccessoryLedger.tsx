import React from 'react';
import { CheckSquare, Square, Trash2, Plus } from 'lucide-react';
import type { AccessoryData } from '../types';

interface AccessoryLedgerProps {
  accessories: AccessoryData[];
  onUpdateAccessories: (accessories: AccessoryData[]) => void;
}

export function AccessoryLedger({
  accessories,
  onUpdateAccessories,
}: AccessoryLedgerProps) {
  const handleToggleStatus = (idx: number) => {
    const updated = [...accessories];
    updated[idx] = {
      ...updated[idx],
      status: updated[idx].status === 'Done' ? 'Pending' : 'Done',
    };
    onUpdateAccessories(updated);
  };

  const handleFieldChange = (idx: number, key: 'weight' | 'reps' | 'executedRpe' | 'name', val: string) => {
    const updated = [...accessories];
    updated[idx] = {
      ...updated[idx],
      [key]: val,
    };
    onUpdateAccessories(updated);
  };

  const handleAddAccessory = () => {
    const newAcc: AccessoryData = {
      id: `acc-new-${Date.now()}-${accessories.length}`,
      name: 'Accessory Movement',
      prescribedSets: '3',
      targetReps: '10-12',
      targetRpe: '7',
      weight: '',
      reps: '',
      executedRpe: '',
      status: 'Pending',
    };
    onUpdateAccessories([...accessories, newAcc]);
  };

  const handleRemoveAccessory = (idx: number) => {
    onUpdateAccessories(accessories.filter((_, i) => i !== idx));
  };

  return (
    <div className="bg-transparent p-4 font-sans relative flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
        <div>
          <h3 className="text-sm font-black text-white uppercase tracking-wider">Accessory Ledger</h3>
          <span className="text-[10px] font-mono text-[#AEAEB2] tracking-widest uppercase block mt-0.5">
            SUPPLEMENTAL WORK & ISOLATIONS
          </span>
        </div>
        <button
          onClick={handleAddAccessory}
          className="px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/15 hover:border-white/30 text-white rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-all"
        >
          <Plus size={12} /> Add accessory
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-collapse text-left text-xs font-mono">
          <thead>
            <tr className="border-b border-white/10 text-zinc-500 text-[10px] uppercase tracking-wider">
              <th className="pb-2 w-8 text-center">Done</th>
              <th className="pb-2 text-left">Exercise</th>
              <th className="pb-2 text-center w-24">Prescription</th>
              <th className="pb-2 text-center w-24">Weight</th>
              <th className="pb-2 text-center w-16">Reps</th>
              <th className="pb-2 text-center w-16">RPE</th>
              <th className="pb-2 text-center w-12">Delete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {accessories.map((acc, idx) => {
              const isDone = acc.status === 'Done';
              return (
                <tr key={acc.id} className={`hover:bg-white/2 align-middle ${isDone ? 'opacity-60' : ''}`}>
                  {/* Status Checkbox */}
                  <td className="py-2.5 text-center">
                    <button
                      onClick={() => handleToggleStatus(idx)}
                      className="text-gray-400 hover:text-white cursor-pointer"
                    >
                      {isDone ? (
                        <CheckSquare className="text-mac-blue" size={16} />
                      ) : (
                        <Square size={16} />
                      )}
                    </button>
                  </td>

                  {/* Name field */}
                  <td className="py-2 px-1">
                    <input
                      type="text"
                      value={acc.name}
                      onChange={(e) => handleFieldChange(idx, 'name', e.target.value)}
                      className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-full text-white text-xs focus:outline-none focus:border-mac-blue"
                    />
                  </td>

                  {/* Prescription column */}
                  <td className="py-2 px-1 text-center text-zinc-500 text-xs">
                    {acc.prescribedSets}x{acc.targetReps} @ {acc.targetRpe}
                  </td>

                  {/* Weight column */}
                  <td className="py-2 px-1">
                    <input
                      type="text"
                      placeholder="Load"
                      value={acc.weight}
                      onChange={(e) => handleFieldChange(idx, 'weight', e.target.value)}
                      className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-full text-center text-white text-xs focus:outline-none focus:border-mac-blue tabular-nums"
                    />
                  </td>

                  {/* Reps column */}
                  <td className="py-2 px-1">
                    <input
                      type="text"
                      placeholder="Reps"
                      value={acc.reps}
                      onChange={(e) => handleFieldChange(idx, 'reps', e.target.value)}
                      className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-full text-center text-white text-xs focus:outline-none focus:border-mac-blue tabular-nums"
                    />
                  </td>

                  {/* Executed RPE */}
                  <td className="py-2 px-1">
                    <input
                      type="text"
                      placeholder="RPE"
                      value={acc.executedRpe}
                      onChange={(e) => handleFieldChange(idx, 'executedRpe', e.target.value)}
                      className="bg-[#1C1C1E]/50 border border-white/5 rounded px-2 py-1 w-full text-center text-white text-xs focus:outline-none focus:border-mac-blue tabular-nums"
                    />
                  </td>

                  {/* Delete row */}
                  <td className="py-2.5 text-center">
                    <button
                      onClick={() => handleRemoveAccessory(idx)}
                      className="text-zinc-500 hover:text-[#FF453A] p-1 rounded hover:bg-white/5 cursor-pointer transition-colors"
                      title="Remove Accessory"
                    >
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {accessories.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-zinc-500">
                  No accessories scheduled for this session.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
