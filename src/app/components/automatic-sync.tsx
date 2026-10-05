"use client";
import { useEffect, useState } from "react";
import { request } from "@/lib/client";
import type { AutomaticSyncStatus } from "@/lib/sync-status";
export function AutomaticSync({ revision }: { revision: number }) {
  const [run, setRun] = useState<AutomaticSyncStatus | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const data = await request("/api/account/sync-status", {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setRun(data.run);
          setFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 60_000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [revision]);
  return (
    <aside
      className="automatic-sync"
      aria-label="Dernière synchronisation automatique"
    >
      <strong>Dernière synchronisation automatique</strong>
      {failed ? (
        <span>Statut momentanément indisponible.</span>
      ) : !run ? (
        <span>Aucun passage enregistré.</span>
      ) : (
        <>
          <span>
            {new Intl.DateTimeFormat("fr-BE", {
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(run.startedAt))}{" "}
            ·{" "}
            {run.phase === "syncing"
              ? run.running
                ? "En cours"
                : "Interrompue · reprise attendue"
              : run.phase === "complete"
                ? "Terminée"
                : "Synchronisation terminée · emails en attente ou en échec"}
          </span>
          <small>
            Pour ton compte : {run.synced} source(s) actualisée(s) ·{" "}
            {run.failed} en échec · {run.imported} nouveauté(s) ·{" "}
            {run.emailsSent} email(s) envoyé(s)
            {run.emailsFailed ? ` · ${run.emailsFailed} email(s) en échec` : ""}
            {run.pending ? ` · ${run.pending} source(s) reportée(s)` : ""}
          </small>
        </>
      )}
    </aside>
  );
}
