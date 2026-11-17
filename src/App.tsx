import {
  Activity,
  Clapperboard,
  FolderKanban,
  Layers,
  Menu,
  PlugZap,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiConnectView } from './components/ApiConnectView';
import { JobsView } from './components/JobsView';
import { MediaVaultView } from './components/MediaVaultView';
import { ModularStudioView } from './components/ModularStudioView';
import { ProductionView } from './components/ProductionView';
import { ensureStudioSession, harouApi } from './lib/api';
import type {
  ApiKeyInfo,
  CharacterRecord,
  EngineInfo,
  JobRecord,
  MediaAssetRecord,
  ProductionProject,
  ScenarioRecord,
} from './types';

type NavSection = 'production' | 'studio' | 'jobs' | 'media' | 'api';

export default function App() {
  const [section, setSection] = useState<NavSection>('production');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [info, setInfo] = useState<EngineInfo | null>(null);
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioRecord[]>([]);
  const [characters, setCharacters] = useState<CharacterRecord[]>([]);
  const [images, setImages] = useState<MediaAssetRecord[]>([]);
  const [audios, setAudios] = useState<MediaAssetRecord[]>([]);
  const [sequences, setSequences] = useState<MediaAssetRecord[]>([]);
  const [assemblies, setAssemblies] = useState<MediaAssetRecord[]>([]);
  const [exportsList, setExportsList] = useState<MediaAssetRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      const [
        infoRes,
        projRes,
        jobsRes,
        scenRes,
        charRes,
        imgRes,
        audRes,
        vidRes,
        asmRes,
        expRes,
        keysRes,
      ] = await Promise.all([
        harouApi.getInfo(),
        harouApi.getProjects(),
        harouApi.getJobs(),
        harouApi.getScenarios(),
        harouApi.getCharacters(),
        harouApi.getImages(),
        harouApi.getAudio(),
        harouApi.getVideos(),
        harouApi.getAssemblies(),
        harouApi.getExports(),
        harouApi.getKeys(),
      ]);
      setInfo(infoRes);
      setProjects(projRes.projects);
      setJobs(jobsRes.jobs);
      setScenarios(scenRes.scenarios);
      setCharacters(charRes.characters);
      setImages(imgRes.images);
      setAudios(audRes.audio);
      setSequences(vidRes.sequences);
      setAssemblies(asmRes.assemblies);
      setExportsList(expRes.exports);
      setApiKeys(keysRes.keys);
      setBootError(null);
    } catch (err) {
      setBootError(err instanceof Error ? err.message : 'Erreur de connexion au backend');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let es: EventSource | null = null;
    let active = true;

    async function init() {
      await ensureStudioSession();
      if (!active) return;
      await refreshAll();
      if (!active) return;

      es = new EventSource('/api/v1/events', { withCredentials: true });
      es.addEventListener('job', (ev) => {
        try {
          const updatedJob = JSON.parse((ev as MessageEvent).data) as JobRecord;
          setJobs((prev) => {
            const idx = prev.findIndex((j) => j.id === updatedJob.id);
            if (idx === -1) return [updatedJob, ...prev];
            const copy = [...prev];
            copy[idx] = updatedJob;
            return copy;
          });
          if (updatedJob.status === 'completed' || updatedJob.status === 'failed') {
            void refreshAll();
          }
        } catch {
          // ignore malformed event
        }
      });

      es.addEventListener('project', (ev) => {
        try {
          const updatedProject = JSON.parse((ev as MessageEvent).data) as ProductionProject;
          setProjects((prev) => {
            const idx = prev.findIndex((p) => p.id === updatedProject.id);
            if (idx === -1) return [updatedProject, ...prev];
            const copy = [...prev];
            copy[idx] = updatedProject;
            return copy;
          });
        } catch {
          // ignore malformed event
        }
      });
    }

    void init();

    return () => {
      active = false;
      es?.close();
    };
  }, [refreshAll]);

  const activeJobsCount = jobs.filter(
    (j) => j.status === 'processing' || j.status === 'queued'
  ).length;
  const activeProvidersCount = (info?.providers || []).filter((p) => p.available).length;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof Clapperboard;
  }> = [
    { id: 'production', label: 'Production Film', icon: Clapperboard },
    { id: 'studio', label: 'Atelier Modulaire', icon: Layers },
    { id: 'jobs', label: 'File de Tâches', icon: Activity },
    { id: 'media', label: 'Médiathèque', icon: FolderKanban },
    { id: 'api', label: 'API HAROU AI', icon: PlugZap },
  ];

  const sectionTitles: Record<NavSection, string> = {
    production: 'Production automatisée',
    studio: 'Atelier modulaire & Diagnostics',
    jobs: 'Suivi des tâches',
    media: 'Médiathèque & Exports MP4',
    api: 'Connexion HAROU AI & Modules',
  };

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col border-r border-slate-800/80 bg-[#0E131D] shrink-0">
        <div className="h-14 px-5 flex items-center border-b border-slate-800/80">
          <span className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap">
            HAROU GENERATOR 2.0
          </span>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  isActive
                    ? 'bg-blue-600/15 text-blue-300'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/50'
                }`}
              >
                <span className="inline-flex items-center gap-2.5">
                  <Icon className="w-4 h-4 shrink-0" />
                  {item.label}
                </span>
                {item.id === 'jobs' && activeJobsCount > 0 && (
                  <span className="text-xs font-mono tabular-nums text-blue-400">
                    {activeJobsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-800/80 text-xs text-slate-400 space-y-1">
          <div className="font-medium text-slate-300">Moteur REST &amp; FFmpeg</div>
          <div className="font-mono tabular-nums text-[11px] text-slate-500">
            {activeProvidersCount} modules actifs · H.264 / WAV
          </div>
        </div>
      </aside>

      {/* Mobile Sidebar Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-64 bg-[#0E131D] border-r border-slate-800 flex flex-col h-full z-10">
            <div className="h-14 px-5 flex items-center justify-between border-b border-slate-800">
              <span className="font-display text-base font-bold text-slate-100">
                HAROU GENERATOR 2.0
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = section === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setSection(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium cursor-pointer ${
                      isActive
                        ? 'bg-blue-600/15 text-blue-300'
                        : 'text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar Contract: 3 clean zones, single line */}
        <header className="h-14 px-4 sm:px-8 border-b border-slate-800/80 bg-[#0B0F17]/95 sticky top-0 z-30 flex items-center justify-between gap-8">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 text-slate-400 hover:text-slate-100"
              aria-label="Ouvrir le menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">HAROU GENERATOR 2.0</span>
              <span className="text-slate-600 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <h1 className="font-semibold text-slate-100 truncate">
                {sectionTitles[section]}
              </h1>
            </div>
          </div>

          <div className="shrink-0">
            <button
              type="button"
              onClick={() => setSection('api')}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Obtenir l’API HAROU AI
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1400px] w-full mx-auto space-y-6">
          {/* Quantitative Summary Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="border border-slate-800 bg-[#121824] rounded-xl px-4 py-3.5">
              <div className="text-xs text-slate-400">Productions</div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
                {projects.length}
              </div>
            </div>
            <div className="border border-slate-800 bg-[#121824] rounded-xl px-4 py-3.5">
              <div className="text-xs text-slate-400">Tâches en cours</div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
                {activeJobsCount}
              </div>
            </div>
            <div className="border border-slate-800 bg-[#121824] rounded-xl px-4 py-3.5">
              <div className="text-xs text-slate-400">Films MP4 exportés</div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
                {exportsList.length}
              </div>
            </div>
            <div className="border border-slate-800 bg-[#121824] rounded-xl px-4 py-3.5">
              <div className="text-xs text-slate-400">Modules actifs</div>
              <div className="text-2xl font-semibold font-mono tabular-nums text-slate-100 mt-1">
                {activeProvidersCount}
              </div>
            </div>
          </div>

          {bootError && (
            <div className="p-4 bg-rose-950/40 border border-rose-900/60 rounded-xl text-xs text-rose-300">
              {bootError}
            </div>
          )}

          {loading ? (
            <div className="border border-slate-800 bg-[#121824] rounded-xl p-12 text-center text-sm text-slate-400">
              Initialisation du moteur HAROU GENERATOR 2.0...
            </div>
          ) : (
            <>
              {section === 'production' && (
                <ProductionView projects={projects} jobs={jobs} onRefresh={refreshAll} />
              )}
              {section === 'studio' && (
                <ModularStudioView
                  providers={info?.providers || []}
                  scenarios={scenarios}
                  characters={characters}
                  images={images}
                  audios={audios}
                  sequences={sequences}
                  assemblies={assemblies}
                  exportsList={exportsList}
                  onRefresh={refreshAll}
                  onJumpToJobs={() => setSection('jobs')}
                />
              )}
              {section === 'jobs' && <JobsView jobs={jobs} onRefresh={refreshAll} />}
              {section === 'media' && (
                <MediaVaultView
                  images={images}
                  audios={audios}
                  sequences={sequences}
                  assemblies={assemblies}
                  exportsList={exportsList}
                />
              )}
              {section === 'api' && (
                <ApiConnectView info={info} apiKeys={apiKeys} onRefresh={refreshAll} />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
