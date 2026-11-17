import { Download, Film, Loader2, Play, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatBytes, formatTime, harouApi } from '../lib/api';
import type {
  CharacterRecord,
  ExportProfile,
  JobRecord,
  MediaAssetRecord,
  ProductionProject,
  ScenarioRecord,
  TransitionPreset,
} from '../types';
import { JobStatusLabel } from './StatusText';
import { UnixTimeline } from './UnixTimeline';

interface ProductionViewProps {
  projects: ProductionProject[];
  jobs: JobRecord[];
  onRefresh: () => Promise<void>;
}

export function ProductionView({ projects, jobs, onRefresh }: ProductionViewProps) {
  const [projectName, setProjectName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [genre, setGenre] = useState('Science-fiction');
  const [visualStyle, setVisualStyle] = useState('Cinéma réaliste 35mm, éclairage contrasté');
  const [sceneCount, setSceneCount] = useState(3);
  const [transition, setTransition] = useState<TransitionPreset>('fade');
  const [exportProfile, setExportProfile] = useState<ExportProfile>('720p');
  const [withVoice, setWithVoice] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{
    project: ProductionProject;
    scenario?: ScenarioRecord;
    characters: CharacterRecord[];
    assets: MediaAssetRecord[];
    jobs: JobRecord[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const activeId = selectedProjectId || projects[0]?.id || null;

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoadingDetail(true);
    harouApi
      .getProjectDetail(activeId)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        // Keep current detail if transient
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, projects, jobs]);

  async function handleStartPipeline(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await harouApi.producePipeline({
        projectName: projectName.trim() || prompt.trim().slice(0, 44),
        prompt: prompt.trim(),
        genre,
        visualStyle,
        sceneCount,
        transition,
        exportProfile,
        withVoice,
        language: 'fr',
      });
      setSelectedProjectId(res.project.id);
      setProjectName('');
      setPrompt('');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors du lancement du pipeline');
    } finally {
      setSubmitting(false);
    }
  }

  const activeJob = detail?.project.activeJobId
    ? jobs.find((j) => j.id === detail.project.activeJobId) ||
      detail.jobs.find((j) => j.id === detail.project.activeJobId)
    : detail?.jobs[0];

  const exportAsset = detail?.assets.find((a) => a.id === detail.project.exportAssetId);
  const assemblyAsset = detail?.assets.find((a) => a.id === detail.project.assemblyAssetId);
  const playableVideo = exportAsset || assemblyAsset;

  const orderAssetsByIds = (list: MediaAssetRecord[], orderedIds: string[]) => {
    const byId = new Map(list.map((a) => [a.id, a]));
    const ordered = orderedIds.map((id) => byId.get(id)).filter((a): a is MediaAssetRecord => Boolean(a));
    const seen = new Set(ordered.map((a) => a.id));
    return [...ordered, ...list.filter((a) => !seen.has(a.id))];
  };

  const sequenceAssets = detail
    ? orderAssetsByIds(
        detail.assets.filter((a) => a.category === 'sequences'),
        detail.project.sequenceAssetIds
      )
    : [];
  const imageAssets = detail
    ? orderAssetsByIds(
        detail.assets.filter((a) => a.category === 'images'),
        detail.project.imageAssetIds
      )
    : [];
  const audioAssets = detail
    ? orderAssetsByIds(
        detail.assets.filter((a) => a.category === 'audio'),
        detail.project.audioAssetIds
      )
    : [];

  return (
    <div className="space-y-8">
      {/* Primary Focal Anchor: Automated Production Launcher */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-5 border-b border-slate-800/80">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Pipeline complet de production automatisée
            </h2>
            <p className="text-sm text-slate-400 mt-1 max-w-2xl">
              Orchestre en chaîne réelle : scénario structuré, fiches personnages, images open-source,
              voix WAV, séquences H.264 FFmpeg, assemblage par fondu et export MP4 prêt pour HAROU AI.
            </p>
          </div>
          <div className="text-xs font-mono text-slate-400 whitespace-nowrap">
            POST /api/v1/pipeline/produce
          </div>
        </div>

        <form onSubmit={handleStartPipeline} className="mt-5 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Titre de la production
              </label>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Ex : Les Sentinelles de Dakar 2090"
                className="w-full px-3.5 py-2.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Genre cinématographique
              </label>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              >
                <option value="Science-fiction">Science-fiction</option>
                <option value="Documentaire">Documentaire</option>
                <option value="Thriller">Thriller</option>
                <option value="Animation / Conte">Animation / Conte</option>
                <option value="Drame historique">Drame historique</option>
                <option value="Publicité / Brand Film">Publicité / Brand Film</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Direction artistique
              </label>
              <input
                type="text"
                value={visualStyle}
                onChange={(e) => setVisualStyle(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Idée ou synopsis de départ
            </label>
            <textarea
              rows={3}
              required
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Décrivez votre film : une architecte solaire découvre une cité enfouie sous les dunes et active un ancien réseau énergétique..."
              className="w-full px-3.5 py-2.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span>Scènes</span>
                <select
                  value={sceneCount}
                  onChange={(e) => setSceneCount(Number(e.target.value))}
                  className="px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-md text-xs text-slate-100 font-mono tabular-nums"
                >
                  <option value={2}>2</option>
                  <option value={3}>3</option>
                  <option value={4}>4</option>
                  <option value={5}>5</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span>Transition</span>
                <select
                  value={transition}
                  onChange={(e) => setTransition(e.target.value as TransitionPreset)}
                  className="px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-md text-xs text-slate-100"
                >
                  <option value="fade">Fondu noir (fade)</option>
                  <option value="dissolve">Fondu enchaîné (dissolve)</option>
                  <option value="wipeleft">Balayage (wipe)</option>
                  <option value="cut">Coupe franche (cut)</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <span>Export MP4</span>
                <select
                  value={exportProfile}
                  onChange={(e) => setExportProfile(e.target.value as ExportProfile)}
                  className="px-2.5 py-1.5 bg-[#0B0F17] border border-slate-800 rounded-md text-xs text-slate-100 font-mono"
                >
                  <option value="720p">720p HD (1280×720)</option>
                  <option value="1080p">1080p Full HD (1920×1080)</option>
                  <option value="vertical_9_16">Vertical 9:16 (1080×1920)</option>
                  <option value="square_1_1">Carré 1:1 (1080×1080)</option>
                </select>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={withVoice}
                  onChange={(e) => setWithVoice(e.target.checked)}
                  className="rounded border-slate-700 bg-[#0B0F17] text-blue-600 focus:ring-blue-500"
                />
                <span>Synthèse voix off</span>
              </label>
            </div>

            <button
              type="submit"
              disabled={submitting || !prompt.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              Lancer la production
            </button>
          </div>

          {error && (
            <div className="p-3 bg-rose-950/40 border border-rose-900/60 rounded-lg text-xs text-rose-300">
              {error}
            </div>
          )}
        </form>
      </section>

      {/* Productions List + Active Film Inspector */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left List */}
        <section className="xl:col-span-4 border border-slate-800 bg-[#121824] rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Productions</h3>
            <span className="text-xs font-mono tabular-nums text-slate-400">
              {projects.length} total
            </span>
          </div>

          {projects.length === 0 ? (
            <div className="p-6 text-center space-y-2">
              <Film className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-300 font-medium">Aucune production lancée</p>
              <p className="text-xs text-slate-400">
                Démarrez une production ci-dessus ou envoyez une requête POST vers{' '}
                <code className="text-slate-300">/api/v1/pipeline/produce</code> depuis HAROU AI.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-800/80 max-h-[540px] overflow-y-auto">
              {projects.map((p) => {
                const isSelected = p.id === activeId;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProjectId(p.id)}
                    className={`w-full text-left px-5 py-3.5 transition-colors cursor-pointer ${
                      isSelected ? 'bg-blue-600/10' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-100 truncate">{p.name}</span>
                      <JobStatusLabel status={p.status} />
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-1">{p.prompt}</p>
                    <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-500 mt-1.5">
                      <span>{p.id}</span>
                      <span aria-hidden="true">·</span>
                      <span>{p.sequenceAssetIds.length} séq.</span>
                      <span aria-hidden="true">·</span>
                      <span>{formatTime(p.updatedAt)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Right Inspector */}
        <section className="xl:col-span-8 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-6">
          {!detail && !loadingDetail ? (
            <div className="py-16 text-center space-y-2">
              <Sparkles className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-sm text-slate-300">Sélectionnez ou lancez une production</p>
              <p className="text-xs text-slate-400">
                Les scènes, personnages, pistes audio WAV, séquences H.264 et le film MP4 final
                s’afficheront ici en temps réel.
              </p>
            </div>
          ) : detail ? (
            <>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800">
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="text-base font-semibold text-slate-100 truncate">
                      {detail.scenario?.title || detail.project.name}
                    </h3>
                    <JobStatusLabel status={detail.project.status} />
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    {detail.scenario?.logline || detail.project.prompt}
                  </p>
                </div>
                {exportAsset && (
                  <a
                    href={`${exportAsset.url}?download=1`}
                    download={exportAsset.filename}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Télécharger MP4
                  </a>
                )}
              </div>

              {/* Active Pipeline Progress Bar */}
              {activeJob && (activeJob.status === 'processing' || activeJob.status === 'queued') && (
                <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-200">{activeJob.step}</span>
                    <span className="font-mono tabular-nums text-blue-400">
                      {activeJob.progress}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{ width: `${activeJob.progress}%` }}
                    />
                  </div>
                  {activeJob.logs.length > 0 && (
                    <p className="text-[11px] font-mono text-slate-400 truncate">
                      {activeJob.logs[activeJob.logs.length - 1]?.message}
                    </p>
                  )}
                </div>
              )}

              {activeJob?.status === 'failed' && activeJob.error && (
                <div className="p-3.5 bg-rose-950/40 border border-rose-900/60 rounded-lg text-xs text-rose-300">
                  {activeJob.error}
                </div>
              )}

              {/* Final Video Player */}
              {playableVideo && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium text-slate-200">
                      {exportAsset ? 'Master MP4 exporté' : 'Assemblage des scènes'}
                    </span>
                    <span className="font-mono tabular-nums">
                      {playableVideo.width}×{playableVideo.height} · {playableVideo.durationSec}s ·{' '}
                      {formatBytes(playableVideo.sizeBytes)}
                    </span>
                  </div>
                  <video
                    key={playableVideo.url}
                    src={playableVideo.url}
                    controls
                    className="w-full max-h-[380px] bg-black rounded-lg border border-slate-800"
                  />
                </div>
              )}

              {/* HAROU UNIX 5.8 Visual Timeline */}
              {(sequenceAssets.length > 0 || assemblyAsset) && (
                <UnixTimeline
                  project={detail.project}
                  scenario={detail.scenario}
                  sequences={sequenceAssets}
                  images={imageAssets}
                  audios={audioAssets}
                  assemblyAsset={assemblyAsset}
                  exportAsset={exportAsset}
                />
              )}

              {/* Generated Characters */}
              {detail.characters.length > 0 && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-300">
                    Personnages générés ({detail.characters.length})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {detail.characters.map((ch) => (
                      <div
                        key={ch.id}
                        className="flex items-start gap-3 p-3 bg-[#0B0F17] border border-slate-800 rounded-lg"
                      >
                        {ch.portraitUrl ? (
                          <img
                            src={ch.portraitUrl}
                            alt={ch.name}
                            referrerPolicy="no-referrer"
                            className="w-14 h-16 object-cover rounded-md border border-slate-800 shrink-0"
                          />
                        ) : null}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-100 truncate">{ch.name}</div>
                          <div className="text-xs text-slate-400">
                            {ch.role} · Voix {ch.recommendedVoice}
                          </div>
                          <p className="text-xs text-slate-500 line-clamp-2 mt-1">
                            {ch.physicalDescription}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Scenario Scenes & Assets Breakdown */}
              {detail.scenario && (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-slate-300">
                    Découpage des scènes ({detail.scenario.scenes.length})
                  </h4>
                  <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg bg-[#0B0F17]">
                    {detail.scenario.scenes.map((scene, idx) => {
                      const img = imageAssets[idx];
                      const aud = audioAssets[idx];
                      const seq = sequenceAssets[idx];
                      return (
                        <div key={scene.sceneNumber} className="p-4 flex flex-col sm:flex-row gap-4">
                          {img ? (
                            <img
                              src={img.url}
                              alt={scene.title}
                              referrerPolicy="no-referrer"
                              className="w-full sm:w-36 h-24 object-cover rounded-md border border-slate-800 shrink-0"
                            />
                          ) : null}
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium text-slate-100">
                                Scène {scene.sceneNumber}. {scene.title}
                              </span>
                              <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap">
                                {scene.cameraMovement} · {scene.durationSec}s
                              </span>
                            </div>
                            <p className="text-xs text-slate-300">
                              <span className="text-slate-500">{scene.speaker} :</span>{' '}
                              {scene.narrationOrDialogue}
                            </p>
                            <div className="flex flex-wrap items-center gap-3 pt-1">
                              {aud && (
                                <audio controls src={aud.url} className="h-7 max-w-[240px]" />
                              )}
                              {seq && (
                                <a
                                  href={seq.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-xs text-blue-400 hover:underline font-mono"
                                >
                                  Séquence MP4 ({seq.durationSec}s)
                                </a>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
