export function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ['Arrows', 'Move day or grid selection'],
    ['Enter', 'Open day popover / start cell edit'],
    ['n', 'New session on focused day'],
    ['[ ]', 'Previous / next month'],
    ['t', 'Today'],
    ['Esc', 'Close popover or cancel edit'],
    ['Tab / Shift+Tab', 'Commit cell and move'],
    ['Ctrl/Cmd+D', 'Fill down'],
    ['Delete', 'Clear actuals (planned if coach)'],
    ['Alt+↑/↓', 'Reorder exercise'],
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close shortcuts" className="absolute inset-0 bg-canvas/80" onClick={onClose} />
      <div role="dialog" aria-label="Keyboard shortcuts" data-testid="shortcuts-overlay" className="relative z-10 w-full max-w-md bg-inspector border border-border rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-ui text-fg-strong">Shortcuts</h2>
          <button type="button" onClick={onClose} className="text-caption text-fg-muted hover:text-fg-strong">Close</button>
        </div>
        <table className="w-full text-caption">
          <tbody>
            {rows.map(([key, action]) => (
              <tr key={key} className="border-b border-border-subtle">
                <td className="py-1 font-mono text-fg-strong">{key}</td>
                <td className="py-1 text-fg-muted">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
