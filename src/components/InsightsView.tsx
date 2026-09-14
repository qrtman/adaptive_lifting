import { useCallback, useEffect, useState } from 'react';
import { apiService } from '../services/api';
import { getSnapshot, saveSnapshot } from '../services/db';
import { queueInsightCardMutation } from '../services/sync_engine';
import { usePeriodization } from '../contexts/PeriodizationContext';
import { useSync } from '../contexts/SyncContext';
import { ChartFor } from '../insights/charts';
import { CardBuilder } from '../insights/CardBuilder';
import type { AnalyticsCatalog, CardConfig, CachedResult, SavedCard } from '../insights/types';
import { insightResultIsStale } from '../insights/types';

const blankConfig = (): CardConfig => ({
  metrics: ['tonnage'],
  scopes: [{ kind: 'all', ids: [] }],
  time_grain: 'week',
  range: { n: 12, grain: 'week' },
  visualization: 'line',
});

function resultKey(cardId: string) {
  return `insight_result:${cardId}`;
}

export function InsightsView() {
  const { planAthleteId } = usePeriodization();
  const { isOnline } = useSync();
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [catalog, setCatalog] = useState<AnalyticsCatalog | null>(null);
  const [results, setResults] = useState<Record<string, CachedResult>>({});
  const [staleIds, setStaleIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<SavedCard | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftConfig, setDraftConfig] = useState<CardConfig>(blankConfig());

  const loadCards = useCallback(async () => {
    try {
      const data = await apiService.fetchInsightCards();
      const sorted = [...data].sort((a, b) => a.layout.order - b.layout.order);
      setCards(sorted);
      await saveSnapshot('insight_cards', sorted);
    } catch (err) {
      const cached = await getSnapshot('insight_cards');
      if (Array.isArray(cached)) setCards(cached);
      else setError(err instanceof Error ? err.message : 'Failed to load cards');
    }
  }, []);

  const loadResult = useCallback(async (card: SavedCard) => {
    const cacheId = resultKey(card.id);
    const applyCache = async () => {
      const cached = await getSnapshot(cacheId) as CachedResult | undefined;
      if (cached?.result) {
        setResults((prev) => ({ ...prev, [card.id]: cached }));
        setStaleIds((prev) => ({ ...prev, [card.id]: true }));
      }
    };
    if (!planAthleteId) {
      await applyCache();
      return;
    }
    try {
      const payload = await apiService.queryInsightCard(card.config, planAthleteId);
      const cached: CachedResult = { result: payload, fetchedAt: new Date().toISOString() };
      setResults((prev) => ({ ...prev, [card.id]: cached }));
      setStaleIds((prev) => ({ ...prev, [card.id]: false }));
      await saveSnapshot(cacheId, cached);
    } catch {
      await applyCache();
    }
  }, [planAthleteId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const cat = await apiService.fetchAnalyticsCatalog();
        if (!cancelled) setCatalog(cat);
      } catch {
        /* catalog optional offline */
      }
      await loadCards();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [loadCards]);

  useEffect(() => {
    cards.forEach((card) => { void loadResult(card); });
  }, [cards, loadResult]);

  const openNew = () => {
    setEditing({ id: `card-${Date.now()}`, name: 'New card', config: blankConfig(), layout: { order: cards.length, col_span: 1 } });
    setDraftName('New card');
    setDraftConfig(blankConfig());
  };

  const persistList = async (next: SavedCard[], changed: SavedCard[], deleted?: SavedCard) => {
    const ordered = [...next].sort((a, b) => a.layout.order - b.layout.order);
    setCards(ordered);
    await saveSnapshot('insight_cards', ordered);
    for (const card of changed) {
      await queueInsightCardMutation(card.id, {
        name: card.name,
        config: card.config,
        layout: card.layout,
      });
      if (isOnline) {
        try {
          await apiService.saveInsightCard(card);
        } catch {
          /* queued */
        }
      }
    }
    if (deleted) {
      await queueInsightCardMutation(deleted.id, { deleted: true });
      if (isOnline) {
        try { await apiService.deleteInsightCard(deleted.id); } catch { /* queued */ }
      }
    }
  };

  const persistCard = async (card: SavedCard, deleted = false) => {
    if (deleted) {
      await persistList(cards.filter((c) => c.id !== card.id), [], card);
      return;
    }
    const next = [...cards.filter((c) => c.id !== card.id), card];
    await persistList(next, [card]);
  };

  const moveCard = (cardId: string, delta: number) => {
    const idx = cards.findIndex((c) => c.id === cardId);
    const target = idx + delta;
    if (idx < 0 || target < 0 || target >= cards.length) return;
    const next = [...cards];
    const [item] = next.splice(idx, 1);
    next.splice(target, 0, item);
    const ordered = next.map((card, order) => ({ ...card, layout: { ...card.layout, order } }));
    void persistList(ordered, ordered);
  };

  return (
    <div className="flex-1 overflow-hidden bg-canvas flex">
      <div className="flex-1 overflow-y-auto p-3">
        <div className="h-7 flex items-center justify-between mb-2">
          <h2 className="text-ui text-fg-strong">Insights</h2>
          <button type="button" data-testid="insights-add-card" onClick={openNew} className="h-7 px-2 text-mini text-fg-strong bg-accent/20 rounded">
            Add card
          </button>
        </div>
        {loading && <p className="text-caption text-fg-muted">Loading…</p>}
        {error && <p className="text-caption text-error">{error}</p>}
        {!loading && cards.length === 0 && (
          <p className="text-caption text-fg-muted">No cards yet. Add one or wait for presets to sync.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {cards.map((card) => {
            const cached = results[card.id];
            const stale = insightResultIsStale(isOnline, Boolean(staleIds[card.id]));
            return (
              <article
                key={card.id}
                data-testid={`insight-card-${card.id}`}
                className={`border border-border rounded p-2 ${card.layout.col_span === 2 ? 'col-span-2' : 'col-span-1'}`}
              >
                <div className="h-7 flex items-center justify-between gap-2">
                  <h3 className="text-caption text-fg-strong truncate">{card.name}</h3>
                  <div className="flex items-center gap-1">
                    {stale && cached && <span data-testid={`insight-stale-${card.id}`} className="text-micro text-stale">Stale</span>}
                    <button type="button" className="text-micro text-fg-muted" onClick={() => moveCard(card.id, -1)}>Up</button>
                    <button type="button" className="text-micro text-fg-muted" onClick={() => moveCard(card.id, 1)}>Down</button>
                    <button type="button" className="text-micro text-fg-muted" onClick={() => {
                      const next = { ...card, layout: { ...card.layout, col_span: card.layout.col_span === 2 ? 1 : 2 as 1 | 2 } };
                      void persistCard(next);
                    }}>{card.layout.col_span === 2 ? 'Narrow' : 'Wide'}</button>
                    <button type="button" className="text-micro text-fg-muted" onClick={() => {
                      const copy = { ...card, id: `card-${Date.now()}`, name: `${card.name} copy`, layout: { ...card.layout, order: cards.length } };
                      void persistCard(copy);
                    }}>Dup</button>
                    <button type="button" className="text-micro text-fg-muted" onClick={() => {
                      setEditing(card);
                      setDraftName(card.name);
                      setDraftConfig(card.config);
                    }}>Edit</button>
                    <button type="button" className="text-micro text-error" onClick={() => void persistCard(card, true)}>Del</button>
                  </div>
                </div>
                {cached?.result ? (
                  <ChartFor visualization={card.config.visualization} result={cached.result} />
                ) : (
                  <p className="text-mini text-fg-muted py-6">No points in range</p>
                )}
              </article>
            );
          })}
        </div>
      </div>
      {editing && (
        <CardBuilder
          name={draftName}
          config={draftConfig}
          catalog={catalog}
          onName={setDraftName}
          onChange={setDraftConfig}
          onCancel={() => setEditing(null)}
          onSave={() => {
            const next = { ...editing, name: draftName, config: draftConfig };
            void persistCard(next);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
