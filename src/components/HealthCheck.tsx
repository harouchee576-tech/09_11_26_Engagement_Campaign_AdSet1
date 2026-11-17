import { AlertTriangle, CheckCircle2, Pause, Play, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatTime } from '../lib/api';
import type { HealthReport } from '../types';

type ProbeState = 'checking' | 'ok' | 'degraded' | 'error';

interface HealthCheckProps {
  endpoint?: string;
}

export function HealthCheck({ endpoint = '/api/v1/health' }: HealthCheckProps) {
  const [probeState, setProbeState] = useState<ProbeState>('checking');
  const [report, setReport] = useState<HealthReport | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [autoPoll, setAutoPoll] = useState(true);

  const runProbe = useCallback(
    async (signal?: AbortSignal) => {
      setChecking(true);
      const started = performance.now();
      try {
        const res = await fetch(endpoint, {
          method: 'GET',
          cache: 'no-store',
          signal,
        });
        const elapsed = Math.max(1, Math.round(performance.now() - started));
        setHttpStatus(res.status);
        setLatencyMs(elapsed);
        setLastCheckedAt(new Date().toISOString());

        const data = (await res.json().catch(() => null)) as HealthReport | null;
        if (!res.ok || !data || typeof data.ok !== 'boolean') {
          setProbeState('error');
          setReport(data);
          setErrorMessage(`Réponse HTTP ${res.status} invalide sur ${endpoint}`);
          return;
        }

        setReport(data);
        if (!data.ok) {
          setProbeState('error');
          setErrorMessage('Le serveur a signalé une indisponibilité stockage/runtime.');
        } else if (data.status === 'degraded') {
          setProbeState('degraded');
          setErrorMessage(null);
        } else {
          setProbeState('ok');
          setErrorMessage(null);
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const elapsed = Math.max(1, Math.round(performance.now() - started));
        setLatencyMs(elapsed);
        setHttpStatus(null);
        setProbeState('error');
        setLastCheckedAt(new Date().toISOString());
        setErrorMessage(
          err instanceof Error ? err.message : 'Serveur injoignable (erreur réseau)'
        );
      } finally {
        setChecking(false);
      }
    },
    [endpoint]
  );

  useEffect(() => {
    const controller = new AbortController();
    void runProbe(controller.signal);

    if (!autoPoll) {
      return () => controller.abort();
    }

    const timer = window.setInterval(() => {
      void runProbe(controller.signal);
    }, 5000);

    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [runProbe, autoPoll]);

  const statusDisplay =
    probeState === 'ok'
      ? {
          label: 'OK',
          detail: 'Serveur joignable',
          textClass: 'text-emerald-400',
          borderClass: 'border-emerald-900/60',
          bgClass: 'bg-emerald-950/20',
          Icon: CheckCircle2,
        }
      : probeState === 'degraded'
        ? {
            label: 'OK (dégradé)',
            detail: 'Serveur joignable · moteur partiel',
            textClass: 'text-amber-400',
            borderClass: 'border-amber-900/60',
            bgClass: 'bg-amber-950/20',
            Icon: AlertTriangle,
          }
        : probeState === 'error'
          ? {
              label: 'Erreur',
              detail: 'Serveur injoignable',
              textClass: 'text-rose-400',
              borderClass: 'border-rose-900/60',
              bgClass: 'bg-rose-950/20',
              Icon: AlertTriangle,
            }
          : {
              label: 'Vérification',
              detail: 'Test en cours...',
              textClass: 'text-slate-300',
              borderClass: 'border-slate-800',
              bgClass: 'bg-[#0B0F17]',
              Icon: RefreshCw,
            };

  const StatusIcon = statusDisplay.Icon;

  return (
    <section
      aria-label="Health Check"
      className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-100">Health Check</h3>
            <span className="text-xs font-mono text-slate-400">{endpoint}</span>
          </div>
          <p className="text-xs text-slate-400">
            Interrogation directe en temps réel de l’endpoint public sans authentification pour
            confirmer la disponibilité du backend.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-mono ${statusDisplay.borderClass} ${statusDisplay.bgClass} ${statusDisplay.textClass}`}
          >
            <StatusIcon
              className={`w-3.5 h-3.5 shrink-0 ${
                probeState === 'checking' ? 'animate-spin' : ''
              }`}
            />
            <span className="font-semibold">{statusDisplay.label}</span>
            <span aria-hidden="true" className="text-slate-600">
              ·
            </span>
            <span className="text-slate-300">{statusDisplay.detail}</span>
          </div>

          <button
            type="button"
            onClick={() => setAutoPoll((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            {autoPoll ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {autoPoll ? 'Temps réel (5s)' : 'En pause'}
          </button>

          <button
            type="button"
            onClick={() => void runProbe()}
            disabled={checking}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
            Tester
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="px-3.5 py-2.5 bg-rose-950/25 border border-rose-900/60 rounded-lg text-xs text-rose-300 font-mono">
          {errorMessage}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
          <div className="text-slate-400">Réponse &amp; Latence</div>
          <div className="font-mono tabular-nums text-slate-200 mt-1">
            {httpStatus ? `HTTP ${httpStatus}` : 'Aucune réponse'}
            {latencyMs !== null ? ` · ${latencyMs} ms` : ''}
          </div>
        </div>

        <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
          <div className="text-slate-400">Moteurs &amp; FFmpeg</div>
          <div className="font-mono tabular-nums text-slate-200 mt-1">
            {report
              ? `${report.checks.operationalEngines}/${report.checks.totalEngines} actifs · FFmpeg ${
                  report.checks.ffmpegAvailable ? 'OK' : 'KO'
                }`
              : '—'}
          </div>
        </div>

        <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
          <div className="text-slate-400">Disque &amp; File active</div>
          <div className="font-mono tabular-nums text-slate-200 mt-1">
            {report
              ? `Disque ${report.checks.storageWritable ? 'OK' : 'KO'} · ${
                  report.checks.activeJobs
                } tâche(s)`
              : '—'}
          </div>
        </div>

        <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
          <div className="text-slate-400">Uptime &amp; Dernier contrôle</div>
          <div className="font-mono tabular-nums text-slate-200 mt-1">
            {report ? `${report.uptimeSec}s · ` : ''}
            {formatTime(lastCheckedAt)}
          </div>
        </div>
      </div>
    </section>
  );
}
