import React, { useState } from 'react';
import { 
  LayoutGrid, 
  Dumbbell, 
  BarChart3, 
  MessageSquare, 
  Shield, 
  ChevronLeft, 
  ChevronRight,
  CloudOff,
  RefreshCw
} from 'lucide-react';
import { useSync } from '../contexts/SyncContext';
import { useAgentMutation } from '../contexts/AgentProvider';

interface AppShellProps {
  children: React.ReactNode;
  roleMode: 'coach' | 'athlete';
  setRoleMode: (role: 'coach' | 'athlete') => void;
  dashboardMode: 'month' | 'sessions' | 'week' | 'agent' | 'visual-grid';
  setDashboardMode: (mode: 'month' | 'sessions' | 'week' | 'agent' | 'visual-grid') => void;
}

export function AppShell({ 
  children, 
  roleMode, 
  setRoleMode, 
  dashboardMode, 
  setDashboardMode 
}: AppShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { isOnline, pendingCount } = useSync();
  const navStyle = useAgentMutation('app-shell-nav');
  const shellStyle = useAgentMutation('app-shell');
  
  const navItems = [
    { id: 'month', label: 'Month Grid', icon: <LayoutGrid size={18} /> },
    { id: 'week', label: 'Week Grid', icon: <LayoutGrid size={18} /> },
    { id: 'sessions', label: 'My Sessions', icon: <Dumbbell size={18} /> },
    { id: 'agent', label: 'Agent Workspace', icon: <MessageSquare size={18} /> },
    { id: 'telegram', label: 'Telegram Simulator', icon: <MessageSquare size={18} /> }
  ] as const;

  return (
    <div 
      className="flex min-h-screen bg-[#0A0A0A] text-gray-200 relative overflow-hidden font-sans"
      style={shellStyle}
    >
      {/* Background glow */}
      <div className="absolute top-[-25%] left-[-20%] w-[90vw] h-[90vh] rounded-full bg-mac-blue/2 opacity-[0.03] blur-[150px] pointer-events-none" />
      <div className="absolute bottom-[-25%] right-[-10%] w-[90vw] h-[90vh] rounded-full bg-[#54e083]/2 opacity-[0.02] blur-[150px] pointer-events-none" />

      {/* Persistent Left Sidebar */}
      <aside 
        style={{ width: isCollapsed ? '72px' : '260px' }}
        className="fixed left-0 top-0 h-screen bg-[#111111]/85 border-r border-white/10 flex flex-col p-4 z-50 backdrop-blur-md transition-all duration-300"
      >
        {/* Title / Logo */}
        <div className="flex items-center gap-3 mb-8 px-2 relative h-10 overflow-hidden">
          <div className="w-8 h-8 rounded-[6px] bg-mac-blue flex items-center justify-center text-white font-black shrink-0 shadow-[0_0_15px_rgba(0,122,255,0.4)]">
            Ω
          </div>
          {!isCollapsed && (
            <div className="transition-opacity duration-200">
              <h1 className="text-sm font-black text-white tracking-wider uppercase">Obsidian Kinetic</h1>
              <span className="text-[10px] font-mono text-[#AEAEB2] tracking-widest uppercase block">PRO ATOM STACK</span>
            </div>
          )}
        </div>

        {/* Navigation Section */}
        <nav className="flex-1 space-y-1.5 flex flex-col pt-4" style={navStyle}>
          {navItems.map((item) => {
            const isActive = dashboardMode === item.id;
            return (
              <button
                key={item.id}
                onClick={() => { setDashboardMode(item.id as any); } }
                className={`w-full group px-3 py-2 rounded-lg flex items-center gap-3 transition-all cursor-pointer ${
                  isActive 
                    ? 'bg-white/10 text-white font-bold' 
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
                title={isCollapsed ? item.label : undefined}
              >
                <span className={`${isActive ? 'text-mac-blue' : 'text-gray-400 group-hover:text-white'} transition-colors shrink-0`}>
                  {item.icon}
                </span>
                {!isCollapsed && <span className="text-xs tracking-wide">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Sidebar Footer: Collapsible Button & Role Mode Toggle & Avatar */}
        <div className="pt-4 border-t border-white/5 space-y-4">
          {/* Collapse Trigger */}
          <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-full py-1.5 hover:bg-white/5 border border-white/15 hover:border-white/30 text-gray-400 hover:text-white rounded-[6px] transition-all flex items-center justify-center cursor-pointer"
          >
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>

          {/* Profile Card & Dual Switcher */}
          <div className="flex items-center gap-3 px-1 overflow-hidden h-10">
            <div className="w-8 h-8 rounded-full border border-white/20 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center font-bold text-xs text-white shrink-0">
              AM
            </div>
            {!isCollapsed && (
              <div className="flex-1 min-w-0 transition-opacity">
                <p className="text-xs font-bold text-white truncate">Alex Mercer</p>
                <button 
                  onClick={() => setRoleMode(roleMode === 'coach' ? 'athlete' : 'coach')}
                  className={`text-[9px] font-black uppercase tracking-widest border rounded px-1.5 py-0.5 mt-0.5 transition-colors cursor-pointer block ${
                    roleMode === 'coach' 
                      ? 'border-[#54e083]/40 bg-[#54e083]/10 text-[#54e083] hover:bg-[#54e083]/20'
                      : 'border-mac-blue/40 bg-mac-blue/10 text-mac-blue hover:bg-mac-blue/20'
                  }`}
                >
                  {roleMode === 'coach' ? 'Coach' : 'Athlete'}
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Workspace Frame */}
      <main 
        style={{ marginLeft: isCollapsed ? '72px' : '260px' }}
        className="flex-1 flex flex-col h-screen overflow-hidden relative transition-all duration-300"
      >
        {/* Global Offline/Sync status strip */}
        {(!isOnline || pendingCount > 0) && (
          <div className={`h-7 flex items-center justify-center text-[10px] font-bold uppercase tracking-widest shrink-0 ${
            !isOnline ? 'bg-red-500/20 text-red-500 border-b border-red-500/30' : 'bg-mac-blue/20 text-mac-blue border-b border-mac-blue/30'
          }`}>
            {!isOnline ? (
              <div className="flex items-center gap-2">
                <CloudOff size={12} />
                <span>Offline - Changes will sync when reconnected</span>
              </div>
            ) : pendingCount > 0 ? (
              <div className="flex items-center gap-2">
                <RefreshCw size={12} className="animate-spin" />
                <span>Syncing {pendingCount} changes...</span>
              </div>
            ) : null}
          </div>
        )}

        {/* Inner Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden relative z-10">
          {children}
        </div>
      </main>
    </div>
  );
}

// Sample preview component
export const SampleDefault = () => (
  <AppShell 
    roleMode="coach" 
    setRoleMode={() => {}} 
    dashboardMode="month" 
    setDashboardMode={() => {}}
  >
    <div className="p-6">AppShell preview content</div>
  </AppShell>
);
