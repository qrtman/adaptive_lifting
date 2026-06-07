import React, { createContext, useContext, useEffect, useState } from 'react';

export type AgentStyleMap = Record<string, React.CSSProperties>;

interface AgentContextValue {
  styles: AgentStyleMap;
}

const AgentContext = createContext<AgentContextValue>({ styles: {} });

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [styles, setStyles] = useState<AgentStyleMap>({});

  useEffect(() => {
    // Poll the public JSON file every 1.5 seconds to bypass HMR delays
    const fetchMutations = async () => {
      try {
        const res = await fetch('/agent-mutations.json?t=' + Date.now());
        if (res.ok) {
          const data = await res.json();
          setStyles(data);
        }
      } catch (err) {
        // Silently ignore fetch errors (e.g. if file is being written)
      }
    };

    fetchMutations();
    const interval = setInterval(fetchMutations, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <AgentContext.Provider value={{ styles }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgentMutation = (componentId: string): React.CSSProperties => {
  const { styles } = useContext(AgentContext);
  return styles[componentId] || {};
};
