// src/hooks/useBlockOrchestrator.tsx
import { useState, useEffect } from 'react';
import React from 'react';
import layoutData from '../blocks-layout.json';

export interface Block {
  id: string;
  title: string;
  content: React.ReactNode;
  x: number;
  y: number;
  w: number;
  h: number;
}

function getBlockTitle(id: string): string {
  switch (id) {
    case 'lock-banner': return 'Workout Lock Status Banner';
    case 'month-grid': return 'Coach Month Periodization Calendar';
    case 'athlete-simulator': return 'Telegram Athlete WebApp Simulator';
    case 'sessions-view': return 'Athlete Sessions Timeline';
    case 'accessory-ledger': return 'Accessory Ledger';
    case 'conflict-review': return 'Database Sync Conflict Review';
    default: return id;
  }
}

/**
 * Hook that maps block positions from blocks-layout.json to active UI components.
 */
export function useBlockOrchestrator(components: Record<string, React.ReactNode>) {
  const [blocks, setBlocks] = useState<Block[]>([]);

  useEffect(() => {
    const mapped = layoutData.map(pos => {
      return {
        id: pos.id,
        title: getBlockTitle(pos.id),
        content: components[pos.id] || <div className="text-gray-500 text-xs">Missing Component</div>,
        ...pos
      };
    });
    setBlocks(mapped);
  }, [layoutData, components]);

  return { blocks, setBlocks };
}
