import { Search, Clock, History } from 'lucide-react';

export const Header = () => (
  <header className="sticky top-0 z-40 w-full bg-obsidian-950/85 backdrop-blur-md border-b border-white/10 h-16 px-10 flex justify-between items-center">
    <div className="flex items-center gap-8">
      <h2 className="text-lg font-bold text-white font-sans">Microcycle Manager</h2>
      <nav className="hidden md:flex gap-6 items-center">
        {['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Deload'].map((week, i) => (
          <a key={week} 
             href="#" 
             className={`text-[15px] font-bold transition-all pb-1 ${i === 0 ? 'text-mac-blue border-b-2 border-mac-blue' : 'text-gray-300 hover:text-white font-sans'}`}>
            {week}
          </a>
        ))}
      </nav>
    </div>
    
    <div className="flex items-center gap-4">
      <div className="relative group">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 transition-colors group-focus-within:text-mac-blue" />
        <input 
          type="text" 
          placeholder="Search data..." 
          className="bg-obsidian-900 border border-white/15 rounded-lg py-1.5 pl-10 pr-4 text-[15px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-mac-blue w-56 transition-all placeholder-gray-500 font-sans"
        />
      </div>
      <button className="text-gray-300 hover:text-white transition-colors cursor-pointer"><Clock size={20} /></button>
      <button className="text-gray-300 hover:text-white transition-colors cursor-pointer"><History size={20} /></button>
      <button className="bg-mac-blue hover:bg-blue-600 text-white px-5 py-2 rounded-lg text-[15px] font-bold transition-all active:scale-95 shadow-lg shadow-blue-500/20 cursor-pointer font-sans">
        Log Workout
      </button>
    </div>
  </header>
);
