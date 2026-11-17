import { ChevronDown, ChevronRight, Terminal, X } from 'lucide-react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { formatTime, harouApi } from '../lib/api';
import type { JobLogEntry, JobRecord, JobStatus, LogEngineTag } from '../types';
import { JobStatusLabel } from './StatusText';

interface JobsViewProps {
  jobs: JobRecord[];
  onRefresh: () => Promise<void>;
}

type EngineFilter = 'all' | 'devin' | 'ailleurs' | 'tic-tac' | 'unix';

function inferLogEngine(entry: JobLogEntry, job: JobRecord): LogEngineTag {
  if (entry.engine) return entry.engine;
  const msg = entry.message.toLowerCase();
  const prov = job.provider.toLowerCase();
  if (msg.includes('devin') || msg.includes('scénario') || msg.includes('découpage')) {
    return 'devin';
  }
  if (
    msg.includes('ailleurs') ||
    msg.includes('portrait') ||
    msg.includes('image') ||
    msg.includes('ancres visuelles')
  ) {
    return 'ailleurs';
  }
  if (
    msg.includes('tic-tac') ||
    msg.includes('personnage') ||
    msg.includes('wav') ||
    msg.includes('voix') ||
    msg.includes('mémoire')
  ) {
    return 'tic-tac';
  }
  if (
    msg.includes('unix') ||
    msg.includes('ffmpeg') ||
    msg.includes('frame=') ||
    msg.includes('séquence') ||
    msg.includes('assemblage') ||
    msg.includes('mp4')
  ) {
    return 'unix';
  }
  if (prov.includes('devin')) return 'devin';
  if (prov.includes('ailleurs')) return 'ailleurs';
  if (prov.includes('tic-tac')) return 'tic-tac';
  if (prov.includes('unix') || prov.includes('ffmpeg')) return 'unix';
  return 'orchestrator';
}

const ENGINE_META: Record<LogEngineTag, { label: string; colorClass: string }> = {
  devin: { label: 'DEVIN 2.0', colorClass: 'text-sky-400' },
  ailleurs: { label: 'AILLEURS 4.6', colorClass: 'text-violet-400' },
  'tic-tac': { label: 'TIC-TAC 3.7', colorClass: 'text-amber-400' },
  unix: { label: 'UNIX 5.8', colorClass: 'text-emerald-400' },
  orchestrator: { label: 'HAROU 2.0', colorClass: 'text-slate-400' },
};

export function JobsView({ jobs, onRefresh }: JobsViewProps) {
  const [filter, setFilter] = useState<'all' | JobStatus>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedConsoleJobId, setSelectedConsoleJobId] = useState<string | null>(null);
  const [engineFilter, setEngineFilter] = useState<EngineFilter>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const consoleEndRef = useRef<HTMLDivElement | null>(null);

  const filtered = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  const runningJob = jobs.find((j) => j.status === 'processing');
  const consoleJob =
    (selectedConsoleJobId && jobs.find((j) => j.id === selectedConsoleJobId)) ||
    runningJob ||
    jobs[0] ||
    null;

  const consoleLogs = (consoleJob?.logs || [])
    .map((entry) => ({
      entry,
      engine: inferLogEngine(entry, consoleJob!),
    }))
    .filter((item) => {
      if (engineFilter === 'all') return true;
      return item.engine === engineFilter;
    });

  useEffect(() => {
    if (autoScroll && consoleEndRef.current) {
      consoleEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [consoleJob?.id, consoleLogs.length, autoScroll]);

  async function handleCancel(id: string) {
    await harouApi.cancelJob(id);
    await onRefresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Gestion des tâches et file d’exécution</h2>
          <p className="text-xs text-slate-400 mt-1">
            Suivi temps réel via SSE des générations IA et des rendus FFmpeg.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#121824] border border-slate-800 rounded-lg overflow-x-auto">
          {(
            [
              ['all', 'Toutes'],
              ['processing', 'En cours'],
              ['queued', 'En file'],
              ['completed', 'Terminées'],
              ['failed', 'Échouées'],
            ] as const
          ).map(([val, label]) => (
            <button
              key={val}
              type="button"
              onClick={() => setFilter(val)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                filter === val ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Real-Time Production Logs Panel */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-blue-400 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-100">
                Logs de Production Temps Réel
              </h3>
              {consoleJob && (
                <span className="text-xs font-mono tabular-nums text-slate-400 truncate">
                  · {consoleJob.id} ({consoleJob.type})
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Sorties consoles détaillées de Devin 2.0, Ailleurs 4.6, Tic-Tac 3.7 et Unix 5.8
              pendant l’exécution.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {jobs.length > 0 && (
              <select
                value={consoleJob?.id || ''}
                onChange={(e) => setSelectedConsoleJobId(e.target.value || null)}
                aria-label="Sélectionner une tâche pour les logs"
                className="px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-md text-xs font-mono text-slate-200 max-w-[210px]"
              >
                {jobs.slice(0, 25).map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.id} · {j.type} ({j.progress}%)
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1 p-0.5 bg-[#0B0F17] border border-slate-800 rounded-md">
              {(
                [
                  ['all', 'Tous'],
                  ['devin', 'Devin'],
                  ['ailleurs', 'Ailleurs'],
                  ['tic-tac', 'Tic-Tac'],
                  ['unix', 'Unix'],
                ] as const
              ).map(([eng, label]) => (
                <button
                  key={eng}
                  type="button"
                  onClick={() => setEngineFilter(eng)}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded whitespace-nowrap cursor-pointer ${
                    engineFilter === eng
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setAutoScroll((prev) => !prev)}
              className={`px-2.5 py-1.5 rounded-md border text-[11px] font-medium whitespace-nowrap cursor-pointer ${
                autoScroll
                  ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
                  : 'border-slate-700 bg-[#0B0F17] text-slate-400'
              }`}
            >
              {autoScroll ? 'Défilement auto' : 'Défilement figé'}
            </button>
          </div>
        </div>

        {consoleJob && (
          <div className="px-5 py-2.5 bg-[#0E131D] border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-3 min-w-0">
              <JobStatusLabel status={consoleJob.status} />
              <span className="text-slate-300 truncate">{consoleJob.step}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <div className="w-32 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${consoleJob.progress}%` }}
                />
              </div>
              <span className="font-mono tabular-nums text-blue-400 w-9 text-right">
                {consoleJob.progress}%
              </span>
            </div>
          </div>
        )}

        <div className="bg-[#0B0F17] p-4 max-h-72 min-h-[160px] overflow-y-auto font-mono text-[11px] leading-relaxed">
          {!consoleJob ? (
            <div className="py-10 text-center text-slate-500">
              Aucune tâche exécutée pour le moment. Lancez une production ou un module pour voir le
              flux console en direct.
            </div>
          ) : consoleLogs.length === 0 ? (
            <div className="py-8 text-center text-slate-500">
              Aucune sortie console pour le filtre sélectionné ({engineFilter}).
            </div>
          ) : (
            <div className="space-y-1">
              {consoleLogs.map(({ entry, engine }, idx) => {
                const meta = ENGINE_META[engine];
                return (
                  <div key={`${entry.timestamp}-${idx}`} className="flex items-start gap-2.5">
                    <span className="text-slate-500 tabular-nums shrink-0">
                      [{formatTime(entry.timestamp)}]
                    </span>
                    <span className={`font-semibold shrink-0 w-24 ${meta.colorClass}`}>
                      [{meta.label}]
                    </span>
                    <span
                      className={
                        entry.level === 'error'
                          ? 'text-rose-400 break-words'
                          : entry.level === 'warn'
                            ? 'text-amber-300 break-words'
                            : 'text-slate-200 break-words'
                      }
                    >
                      {entry.message}
                    </span>
                  </div>
                );
              })}
              <div ref={consoleEndRef} />
            </div>
          )}
        </div>
      </section>

      {/* Jobs Queue Table */}
      <div className="border border-slate-800 bg-[#121824] rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-400">
            Aucune tâche correspondant à ce filtre.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-[11px] font-medium text-slate-400 bg-[#0B0F17]/60">
                  <th className="py-3 px-4">Tâche</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Module</th>
                  <th className="py-3 px-4">Statut</th>
                  <th className="py-3 px-4">Étape</th>
                  <th className="py-3 px-4 text-right">Progression</th>
                  <th className="py-3 px-4 text-right">Créée</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {filtered.map((job) => {
                  const isOpen = expandedId === job.id;
                  const isConsoleSelected = consoleJob?.id === job.id;
                  return (
                    <Fragment key={job.id}>
                      <tr
                        onClick={() => {
                          setSelectedConsoleJobId(job.id);
                          setExpandedId(isOpen ? null : job.id);
                        }}
                        className={`cursor-pointer transition-colors ${
                          isConsoleSelected ? 'bg-blue-600/10' : 'hover:bg-slate-800/35'
                        }`}
                      >
                        <td className="py-3 px-4 font-mono text-slate-200 whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5">
                            {isOpen ? (
                              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                            )}
                            {job.id}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-300 font-mono">{job.type}</td>
                        <td className="py-3 px-4 text-slate-400 font-mono">{job.provider}</td>
                        <td className="py-3 px-4">
                          <JobStatusLabel status={job.status} />
                        </td>
                        <td className="py-3 px-4 text-slate-300 max-w-[260px] truncate">
                          {job.step}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                          {job.progress}%
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                          {formatTime(job.createdAt)}
                        </td>
                        <td
                          className="py-3 px-4 text-right"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {job.status === 'queued' ? (
                            <button
                              type="button"
                              onClick={() => void handleCancel(job.id)}
                              className="inline-flex items-center gap-1 text-xs text-rose-400 hover:text-rose-300 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                              Annuler
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-[#0B0F17]">
                          <td colSpan={8} className="p-4 space-y-3 border-t border-slate-800/80">
                            {job.error && (
                              <div className="p-2.5 bg-rose-950/40 border border-rose-900/60 rounded text-xs text-rose-300">
                                {job.error}
                              </div>
                            )}
                            <div className="space-y-1 max-h-48 overflow-y-auto font-mono text-[11px]">
                              {job.logs.map((entry, idx) => {
                                const engMeta = ENGINE_META[inferLogEngine(entry, job)];
                                return (
                                  <div key={idx} className="flex gap-2.5">
                                    <span className="text-slate-500 tabular-nums shrink-0">
                                      {formatTime(entry.timestamp)}
                                    </span>
                                    <span className={`font-semibold shrink-0 w-24 ${engMeta.colorClass}`}>
                                      [{engMeta.label}]
                                    </span>
                                    <span
                                      className={
                                        entry.level === 'error'
                                          ? 'text-rose-400'
                                          : entry.level === 'warn'
                                            ? 'text-amber-400'
                                            : 'text-slate-300'
                                      }
                                    >
                                      {entry.message}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
