import { ReactNode } from 'react';
import { LayoutDashboard, BarChart3, Dumbbell, MessageSquare, Settings } from 'lucide-react';

const NavItem = ({ icon, label, active = false }: { icon: ReactNode, label: string, active?: boolean }) => (
  <a href="#" className={`
    group px-3 py-2 rounded-lg flex items-center gap-3 transition-all duration-200
    ${active ? 'bg-white/10 text-white font-semibold' : 'text-gray-300 hover:bg-white/5 hover:text-gray-200'}
  `}>
    <span className={`${active ? 'text-mac-blue' : 'text-gray-400 group-hover:text-gray-200'} transition-colors`}>
      {icon}
    </span>
    <span className="text-[15px] font-sans">{label}</span>
  </a>
);

export const Sidebar = () => (
  <aside className="fixed left-0 top-0 h-screen w-64 glass-sidebar border-r border-white/10 flex flex-col p-4 space-y-2 z-50">
    <div className="mb-8 px-3">
      <h1 className="text-lg font-bold text-white tracking-tight">Elite Performance</h1>
      <p className="text-[15px] font-bold text-gray-200 font-sans">Macrocycle Phase: Hypertrophy</p>
    </div>
    
    <nav className="flex-1 space-y-3">
      <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest px-3">Primary Workspaces</div>
      
      <NavItem icon={<LayoutDashboard size={20} />} label="Calendar Grid" />
      
      <div className="relative">
        <NavItem icon={<Dumbbell size={20} />} label="Athletes Roster" active />
        <span className="absolute right-3 top-2 px-1.5 py-0.5 text-[10px] bg-amber-500/20 text-amber-400 font-bold rounded border border-amber-500/30">
          3 Alerts
        </span>
      </div>
      
      <NavItem icon={<BarChart3 size={20} />} label="Analytics Engine" />

      <div className="pt-2 text-[11px] font-bold text-zinc-500 uppercase tracking-widest px-3">Operations & Links</div>
      <NavItem icon={<MessageSquare size={20} />} label="Sheets Publisher" />
      <NavItem icon={<Settings size={20} />} label="Security & Audit" />
    </nav>
    
    <div className="pt-4 border-t border-white/10 flex items-center gap-3 px-3">
      <div className="w-10 h-10 rounded-full border border-white/20 bg-gradient-to-br from-gray-700 to-gray-900 overflow-hidden flex items-center justify-center">
        <span className="text-[15px] font-bold text-white font-sans">AM</span>
      </div>
      <div>
        <p className="text-sm font-semibold text-white">Alex Mercer</p>
        <p className="text-[15px] text-amber-400 uppercase tracking-wider font-bold font-sans">Pro Athlete</p>
      </div>
    </div>
  </aside>
);
