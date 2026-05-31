import { Dumbbell } from 'lucide-react';
import { EditablePerformanceCell } from './EditablePerformanceCell';

export const AccessoryLedger = ({
  accessories,
  onUpdateAccessories
}: {
  accessories: any[],
  onUpdateAccessories: (accs: any[]) => void
}) => {
  const updateAccessory = (index: number, updates: any) => {
    const newAcc = [...accessories];
    newAcc[index] = { ...newAcc[index], ...updates };
    onUpdateAccessories(newAcc);
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden mb-10 border border-white/5">
      <div className="px-8 py-5 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Dumbbell size={20} className="text-mac-blue" />
          <h2 className="text-[18px] font-black uppercase tracking-[0.2em] text-white font-sans">Accessories & Isolation</h2>
        </div>
        <span className="text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">{accessories?.filter(a => a.status !== 'Done').length || 0} Pending</span>
      </div>

      <table className="w-full text-left border-collapse">
        <thead className="bg-black/40">
          <tr>
            <th className="px-8 py-5 text-[20px] font-black text-white uppercase tracking-[0.2em] font-sans">Exercise</th>
            <th className="px-8 py-5 border-r border-white/5 bg-white/[0.01]">
              <span className="text-[20px] font-black text-white uppercase tracking-[0.2em] block mb-2 font-sans">Prescription</span>
              <div className="flex items-center gap-4">
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">Reps</span>
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">RPE</span>
              </div>
            </th>
            <th className="px-8 py-5">
              <span className="text-[20px] font-black text-white uppercase tracking-[0.2em] block mb-2 font-sans">Log Performance</span>
              <div className="flex items-center gap-4">
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">Reps</span>
                <span className="w-16 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">RPE</span>
                <span className="w-24 text-center text-[15px] font-black text-amber-400 uppercase tracking-widest font-sans">Weight (kg)</span>
              </div>
            </th>
            <th className="px-8 py-5 text-[20px] font-black text-white uppercase tracking-[0.2em] text-right font-sans">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {accessories?.map((acc, i) => (
            <tr key={acc.id || i} className="group hover:bg-white/[0.02] transition-colors">
              <td className="px-8 py-6">
                <div className="flex flex-col">
                  <span className="text-[16px] font-bold text-white transition-colors group-hover:text-mac-blue font-sans">{acc.name}</span>
                  <span className="text-[15px] font-black text-gray-300 uppercase tracking-widest mt-1 font-sans">{acc.prescribedSets} Sets</span>
                </div>
              </td>
              <td className="px-8 py-6 border-r border-white/5 bg-white/[0.01]">
                <div className="flex items-center gap-4">
                  <div className="w-16 py-3 bg-white/[0.01] border border-white/5 rounded-xl text-center text-xl font-bold font-sans text-gray-300 tabular-nums">
                    {acc.targetReps}
                  </div>
                  <div className="w-16 py-3 bg-white/[0.01] border border-white/5 rounded-xl text-center text-xl font-bold font-sans text-gray-300 tabular-nums">
                    {acc.targetRpe}
                  </div>
                </div>
              </td>
              <td className="px-8 py-6">
                <div className="flex items-center gap-4">
                  <EditablePerformanceCell
                    value={acc.reps || ""}
                    onChange={(val) => updateAccessory(i, { reps: val })}
                    placeholder="—"
                    fieldKey="accessory-reps"
                    label="Log Reps"
                    widthClass="w-16"
                    isLogged={true}
                    step={1}
                    rowIndex={i}
                  />
                  <EditablePerformanceCell
                    value={acc.executedRpe || ""}
                    onChange={(val) => updateAccessory(i, { executedRpe: val })}
                    placeholder="—"
                    fieldKey="accessory-executedRpe"
                    label="Log RPE"
                    widthClass="w-16"
                    isLogged={true}
                    step={0.5}
                    rowIndex={i}
                  />
                  <EditablePerformanceCell
                    value={acc.weight || ""}
                    onChange={(val) => updateAccessory(i, { weight: val })}
                    placeholder="—"
                    fieldKey="accessory-weight"
                    label="Log Weight"
                    widthClass="w-24"
                    isLogged={true}
                    step={2.5}
                    rowIndex={i}
                  />
                </div>
              </td>
              <td className="px-8 py-6 text-right">
                <button 
                  onClick={() => updateAccessory(i, { status: acc.status === 'Done' ? 'Pending' : 'Done' })}
                  className={`px-5 py-2.5 rounded-full text-[15px] font-black uppercase tracking-widest border transition-all cursor-pointer ${
                    acc.status === 'Done'
                      ? 'bg-mac-green/10 border-mac-green/30 text-mac-green shadow-[0_0_15px_rgba(52,199,89,0.1)]'
                      : 'bg-white/10 border-white/10 text-gray-300 hover:border-white/20'
                  }`}
                >
                  {acc.status}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
