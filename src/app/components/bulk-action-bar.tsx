"use client";

export function BulkActionBar({ count, seenView, changing, onSeen, onSave, onUnsave, onClear }: {
  count: number;
  seenView: boolean;
  changing: boolean;
  onSeen(read: boolean): void;
  onSave(saved: boolean): void;
  onUnsave(saved: boolean): void;
  onClear(): void;
}) {
  if (!count) return null;
  return <div className="selection-bar" role="region" aria-label="Actions sur la sélection"><b>{count} sélectionné{count > 1 ? "s" : ""}</b><div><button disabled={changing} onClick={() => onSeen(!seenView)}>{seenView ? "Marquer comme nouveaux" : "Marquer comme vus"}</button><button disabled={changing} onClick={() => onSave(true)}>Enregistrer</button><button disabled={changing} onClick={() => onUnsave(false)}>Désenregistrer</button><button className="quiet-button" onClick={onClear}>Effacer</button></div></div>;
}
