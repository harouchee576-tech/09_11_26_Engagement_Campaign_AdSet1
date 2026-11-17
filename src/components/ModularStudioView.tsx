import { Activity, Download, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { formatBytes, formatTime, harouApi } from '../lib/api';
import type {
  CharacterRecord,
  EnginesReport,
  ExportProfile,
  MediaAssetRecord,
  MotionPreset,
  ProviderDescriptor,
  ScenarioRecord,
  TransitionPreset,
} from '../types';

type ModuleTab =
  | 'scenario'
  | 'character'
  | 'image'
  | 'audio'
  | 'video'
  | 'assembly'
  | 'export'
  | 'diagnostics';

interface ModularStudioViewProps {
  providers: ProviderDescriptor[];
  scenarios: ScenarioRecord[];
  characters: CharacterRecord[];
  images: MediaAssetRecord[];
  audios: MediaAssetRecord[];
  sequences: MediaAssetRecord[];
  assemblies: MediaAssetRecord[];
  exportsList: MediaAssetRecord[];
  onRefresh: () => Promise<void>;
  onJumpToJobs: () => void;
}

export function ModularStudioView({
  providers,
  scenarios,
  characters,
  images,
  audios,
  sequences,
  assemblies,
  exportsList,
  onRefresh,
  onJumpToJobs,
}: ModularStudioViewProps) {
  const [tab, setTab] = useState<ModuleTab>('scenario');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // 1. Scenario state
  const [scPrompt, setScPrompt] = useState('');
  const [scGenre, setScGenre] = useState('Cinéma');
  const [scCount, setScCount] = useState(3);
  const [scProvider, setScProvider] = useState('auto');

  // 2. Character state
  const [chName, setChName] = useState('');
  const [chConcept, setChConcept] = useState('');
  const [chRole, setChRole] = useState('Protagoniste');
  const [chPortrait, setChPortrait] = useState(true);

  // 3. Image state
  const [imgPrompt, setImgPrompt] = useState('');
  const [imgProvider, setImgProvider] = useState('auto');
  const [imgSize, setImgSize] = useState<'1280x720' | '1024x1024' | '768x1024'>('1280x720');

  // 4. Audio state
  const [audMode, setAudMode] = useState<'single' | 'dialogue'>('single');
  const [audText, setAudText] = useState('');
  const [audVoice, setAudVoice] = useState('Kore');
  const [audStyle, setAudStyle] = useState('Narration claire et posée');
  const [dlgSpk1, setDlgSpk1] = useState('Amina');
  const [dlgText1, setDlgText1] = useState('');
  const [dlgVoice1, setDlgVoice1] = useState('Kore');
  const [dlgSpk2, setDlgSpk2] = useState('Idriss');
  const [dlgText2, setDlgText2] = useState('');
  const [dlgVoice2, setDlgVoice2] = useState('Puck');

  // 5. Video sequence state
  const [vidImageId, setVidImageId] = useState('');
  const [vidPrompt, setVidPrompt] = useState('');
  const [vidAudioId, setVidAudioId] = useState('');
  const [vidMotion, setVidMotion] = useState<MotionPreset>('ken_burns_in');
  const [vidDuration, setVidDuration] = useState(6);

  // 6. Assembly state
  const [selectedSeqIds, setSelectedSeqIds] = useState<string[]>([]);
  const [asmTransition, setAsmTransition] = useState<TransitionPreset>('fade');

  // 7. Export state
  const [expSourceId, setExpSourceId] = useState('');
  const [expProfile, setExpProfile] = useState<ExportProfile>('720p');
  const [expTitle, setExpTitle] = useState('');

  // 8. System Diagnostics live state
  const [diagReport, setDiagReport] = useState<EnginesReport | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);
  const [livePolling, setLivePolling] = useState(true);

  const fetchDiagnostics = useCallback(async (showSpinner = false) => {
    if (showSpinner) setDiagLoading(true);
    try {
      const report = await harouApi.getEngines();
      setDiagReport(report);
      setDiagError(null);
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Erreur lors du relevé système');
    } finally {
      if (showSpinner) setDiagLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== 'diagnostics') return;
    void fetchDiagnostics(diagReport === null);
    if (!livePolling) return;
    const timer = setInterval(() => {
      void fetchDiagnostics(false);
    }, 2500);
    return () => clearInterval(timer);
  }, [tab, livePolling, fetchDiagnostics]);

  async function runAction(fn: () => Promise<void>, successMessage: string) {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      setFeedback({ type: 'ok', text: successMessage });
      await onRefresh();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Erreur lors de l’appel API',
      });
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<{ id: ModuleTab; label: string }> = [
    { id: 'scenario', label: 'Scénarios' },
    { id: 'character', label: 'Personnages' },
    { id: 'image', label: 'Images' },
    { id: 'audio', label: 'Voix & Dialogues' },
    { id: 'video', label: 'Séquences Vidéo' },
    { id: 'assembly', label: 'Assemblage' },
    { id: 'export', label: 'Export MP4' },
    { id: 'diagnostics', label: 'Diagnostics Systèmes' },
  ];

  const scenarioProviders = providers.filter((p) => p.capability === 'scenario');
  const imageProviders = providers.filter((p) => p.capability === 'image');

  const exportCandidates = [...assemblies, ...sequences];

  return (
    <div className="space-y-6">
      {/* Segmented Navigation Bar */}
      <div className="flex items-center gap-1 p-1 bg-[#121824] border border-slate-800 rounded-xl overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setFeedback(null);
            }}
            className={`px-3.5 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              tab === t.id
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-800/60'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          className={`px-4 py-3 rounded-lg border text-xs flex items-center justify-between gap-4 ${
            feedback.type === 'ok'
              ? 'bg-emerald-950/30 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <span>{feedback.text}</span>
          {feedback.type === 'ok' && (
            <button
              type="button"
              onClick={onJumpToJobs}
              className="text-emerald-200 underline whitespace-nowrap cursor-pointer"
            >
              Voir la file de tâches
            </button>
          )}
        </div>
      )}

      {/* 1. SCENARIO */}
      {tab === 'scenario' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await harouApi.generateScenario({
                  prompt: scPrompt,
                  genre: scGenre,
                  sceneCount: scCount,
                  provider: scProvider,
                  language: 'fr',
                });
                setScPrompt('');
              }, 'Tâche de génération de scénario ajoutée à la file.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Génération de scénario</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /scenarios/generate</code>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Modèle modulaire</label>
              <select
                value={scProvider}
                onChange={(e) => setScProvider(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="auto">Auto (meilleur moteur open-source disponible)</option>
                {scenarioProviders.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.name} {!p.available ? '(non installé — repli auto)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Genre</label>
                <input
                  type="text"
                  value={scGenre}
                  onChange={(e) => setScGenre(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Nombre de scènes</label>
                <input
                  type="number"
                  min={2}
                  max={8}
                  value={scCount}
                  onChange={(e) => setScCount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100 font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Sujet / Pitch</label>
              <textarea
                rows={4}
                required
                value={scPrompt}
                onChange={(e) => setScPrompt(e.target.value)}
                placeholder="Ex : Un court-métrage documentaire sur l'architecture bioclimatique en Afrique de l'Ouest..."
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !scPrompt.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Générer le scénario
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">
              Scénarios générés ({scenarios.length})
            </h3>
            {scenarios.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                Aucun scénario enregistré pour le moment.
              </p>
            ) : (
              <div className="space-y-4 max-h-[540px] overflow-y-auto pr-1">
                {scenarios.map((s) => (
                  <div key={s.id} className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold text-slate-100">{s.title}</h4>
                      <span className="text-xs font-mono tabular-nums text-slate-400">
                        {s.scenes.length} scènes · {s.totalDurationSec}s · {s.provider}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{s.logline}</p>
                    <div className="divide-y divide-slate-800/70 pt-2">
                      {s.scenes.map((sc) => (
                        <div key={sc.sceneNumber} className="py-2 text-xs">
                          <div className="font-medium text-slate-200">
                            Scène {sc.sceneNumber} — {sc.title}{' '}
                            <span className="text-slate-500 font-mono">
                              ({sc.cameraMovement} · {sc.durationSec}s)
                            </span>
                          </div>
                          <p className="text-slate-400 mt-0.5">{sc.narrationOrDialogue}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 2. CHARACTER */}
      {tab === 'character' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await harouApi.createCharacter({
                  name: chName.trim() || undefined,
                  concept: chConcept,
                  role: chRole,
                  generatePortrait: chPortrait,
                  language: 'fr',
                });
                setChConcept('');
                setChName('');
              }, 'Création du personnage lancée.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Création de personnage</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /characters/create</code>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Nom (optionnel)</label>
                <input
                  type="text"
                  value={chName}
                  onChange={(e) => setChName(e.target.value)}
                  placeholder="Ex : Kenza"
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Rôle</label>
                <input
                  type="text"
                  value={chRole}
                  onChange={(e) => setChRole(e.target.value)}
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Description & Univers</label>
              <textarea
                rows={4}
                required
                value={chConcept}
                onChange={(e) => setChConcept(e.target.value)}
                placeholder="Ex : Ingénieure aérospatiale charismatique, manteau technique bleu nuit, lunettes holographiques discrètes..."
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={chPortrait}
                onChange={(e) => setChPortrait(e.target.checked)}
                className="rounded border-slate-700 bg-[#0B0F17]"
              />
              <span>Générer le portrait de référence (FLUX open-source)</span>
            </label>

            <button
              type="submit"
              disabled={busy || !chConcept.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Créer le personnage
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">
              Personnages enregistrés ({characters.length})
            </h3>
            {characters.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">
                Aucun personnage créé pour le moment.
              </p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[540px] overflow-y-auto">
                {characters.map((ch) => (
                  <div key={ch.id} className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                    <div className="flex gap-3">
                      {ch.portraitUrl && (
                        <img
                          src={ch.portraitUrl}
                          alt={ch.name}
                          referrerPolicy="no-referrer"
                          className="w-16 h-20 object-cover rounded-md border border-slate-800 shrink-0"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-100">{ch.name}</div>
                        <div className="text-xs text-slate-400">
                          {ch.role} · {ch.age}
                        </div>
                        <div className="text-[11px] font-mono text-blue-400 mt-1">
                          Voix : {ch.recommendedVoice}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-300">{ch.physicalDescription}</p>
                    <p className="text-[11px] text-slate-400">Tenue : {ch.wardrobe}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 3. IMAGE */}
      {tab === 'image' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const [w, h] = imgSize.split('x').map(Number);
              void runAction(async () => {
                await harouApi.generateImage({
                  prompt: imgPrompt,
                  provider: imgProvider,
                  width: w,
                  height: h,
                });
                setImgPrompt('');
              }, 'Génération d’image open-source démarrée.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Génération d’images</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /images/generate</code>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Provider open-source</label>
              <select
                value={imgProvider}
                onChange={(e) => setImgProvider(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="auto">Auto (meilleur moteur open-source disponible)</option>
                {imageProviders.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.available}>
                    {p.name} {!p.available ? '(non installé — repli auto)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Format</label>
              <select
                value={imgSize}
                onChange={(e) => setImgSize(e.target.value as '1280x720' | '1024x1024' | '768x1024')}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
              >
                <option value="1280x720">1280×720 (Paysage 16:9)</option>
                <option value="1024x1024">1024×1024 (Carré 1:1)</option>
                <option value="768x1024">768×1024 (Portrait 3:4)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Prompt visuel (recommandé en anglais)</label>
              <textarea
                rows={4}
                required
                value={imgPrompt}
                onChange={(e) => setImgPrompt(e.target.value)}
                placeholder="Wide cinematic shot of a futuristic solar observatory in the Sahara at golden hour, architectural lines, 35mm film grain..."
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !imgPrompt.trim()}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Générer l’image
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Images générées ({images.length})</h3>
            {images.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Aucune image générée.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[540px] overflow-y-auto">
                {images.map((img) => (
                  <div key={img.id} className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden">
                    <img
                      src={img.url}
                      alt={img.prompt || img.filename}
                      referrerPolicy="no-referrer"
                      className="w-full h-40 object-cover"
                    />
                    <div className="p-3 space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
                        <span>{img.id}</span>
                        <span>
                          {img.width}×{img.height} · {formatBytes(img.sizeBytes)}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-2">{img.prompt}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. AUDIO */}
      {tab === 'audio' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                if (audMode === 'single') {
                  await harouApi.generateAudio({
                    text: audText,
                    voiceName: audVoice,
                    style: audStyle,
                  });
                  setAudText('');
                } else {
                  await harouApi.generateAudio({
                    speakers: [
                      { speaker: dlgSpk1, voiceName: dlgVoice1, text: dlgText1 },
                      { speaker: dlgSpk2, voiceName: dlgVoice2, text: dlgText2 },
                    ],
                  });
                  setDlgText1('');
                  setDlgText2('');
                }
              }, 'Synthèse vocale WAV mise en file.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Voix &amp; Dialogues WAV</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /audio/generate</code>
            </div>

            <div className="flex gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
              <button
                type="button"
                onClick={() => setAudMode('single')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  audMode === 'single' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                Voix Solo
              </button>
              <button
                type="button"
                onClick={() => setAudMode('dialogue')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
                  audMode === 'dialogue' ? 'bg-slate-800 text-white' : 'text-slate-400'
                }`}
              >
                Dialogue 2 Locuteurs
              </button>
            </div>

            {audMode === 'single' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Voix</label>
                    <select
                      value={audVoice}
                      onChange={(e) => setAudVoice(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                    >
                      <option value="Kore">Kore</option>
                      <option value="Puck">Puck</option>
                      <option value="Charon">Charon</option>
                      <option value="Fenrir">Fenrir</option>
                      <option value="Zephyr">Zephyr</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-slate-300 mb-1.5">Direction vocale</label>
                    <input
                      type="text"
                      value={audStyle}
                      onChange={(e) => setAudStyle(e.target.value)}
                      className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-300 mb-1.5">Texte à prononcer</label>
                  <textarea
                    rows={4}
                    required
                    value={audText}
                    onChange={(e) => setAudText(e.target.value)}
                    placeholder="Bienvenue dans le moteur de production multimédia HAROU GENERATOR."
                    className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-sm text-slate-100 placeholder:text-slate-500"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={dlgSpk1}
                      onChange={(e) => setDlgSpk1(e.target.value)}
                      placeholder="Locuteur 1"
                      className="px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                    />
                    <select
                      value={dlgVoice1}
                      onChange={(e) => setDlgVoice1(e.target.value)}
                      className="px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                    >
                      <option value="Kore">Kore</option>
                      <option value="Zephyr">Zephyr</option>
                      <option value="Puck">Puck</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    required
                    value={dlgText1}
                    onChange={(e) => setDlgText1(e.target.value)}
                    placeholder="Réplique du locuteur 1..."
                    className="w-full px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                  />
                </div>

                <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={dlgSpk2}
                      onChange={(e) => setDlgSpk2(e.target.value)}
                      placeholder="Locuteur 2"
                      className="px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                    />
                    <select
                      value={dlgVoice2}
                      onChange={(e) => setDlgVoice2(e.target.value)}
                      className="px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                    >
                      <option value="Puck">Puck</option>
                      <option value="Charon">Charon</option>
                      <option value="Fenrir">Fenrir</option>
                    </select>
                  </div>
                  <input
                    type="text"
                    required
                    value={dlgText2}
                    onChange={(e) => setDlgText2(e.target.value)}
                    placeholder="Réplique du locuteur 2..."
                    className="w-full px-2.5 py-1.5 bg-[#121824] border border-slate-800 rounded text-xs text-slate-100"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Générer la piste audio WAV
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Pistes audio ({audios.length})</h3>
            {audios.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Aucune piste audio générée.</p>
            ) : (
              <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg bg-[#0B0F17] max-h-[540px] overflow-y-auto">
                {audios.map((a) => (
                  <div key={a.id} className="p-4 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-300">{a.id}</span>
                      <span className="font-mono tabular-nums text-slate-400">
                        {a.durationSec}s · {formatBytes(a.sizeBytes)} · {a.provider}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300">{a.prompt}</p>
                    <audio controls src={a.url} className="w-full h-8" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. VIDEO SEQUENCE */}
      {tab === 'video' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await harouApi.generateVideo({
                  imageAssetId: vidImageId || undefined,
                  prompt: vidImageId ? undefined : vidPrompt,
                  audioAssetId: vidAudioId || undefined,
                  motion: vidMotion,
                  durationSec: vidDuration,
                  width: 1280,
                  height: 720,
                  fps: 24,
                });
                setVidPrompt('');
              }, 'Rendu de séquence vidéo FFmpeg mis en file.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Séquence vidéo FFmpeg H.264</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /videos/generate</code>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Image source existante</label>
              <select
                value={vidImageId}
                onChange={(e) => setVidImageId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="">-- Générer une nouvelle image depuis un prompt --</option>
                {images.map((img) => (
                  <option key={img.id} value={img.id}>
                    {img.id} — {(img.prompt || img.filename).slice(0, 48)}
                  </option>
                ))}
              </select>
            </div>

            {!vidImageId && (
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Prompt visuel (si aucune image sélectionnée)</label>
                <textarea
                  rows={2}
                  required
                  value={vidPrompt}
                  onChange={(e) => setVidPrompt(e.target.value)}
                  placeholder="Cinematic aerial drone view over mist-covered mountains at dawn..."
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                />
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Piste audio associée (optionnel)</label>
              <select
                value={vidAudioId}
                onChange={(e) => setVidAudioId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="">Aucune piste audio (piste stéréo silencieuse)</option>
                {audios.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.id} ({a.durationSec}s) — {(a.prompt || '').slice(0, 40)}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Mouvement caméra</label>
                <select
                  value={vidMotion}
                  onChange={(e) => setVidMotion(e.target.value as MotionPreset)}
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
                >
                  <option value="ken_burns_in">Zoom avant (ken_burns_in)</option>
                  <option value="ken_burns_out">Zoom arrière (ken_burns_out)</option>
                  <option value="pan_left">Panoramique gauche</option>
                  <option value="pan_right">Panoramique droite</option>
                  <option value="tilt_up">Inclinaison haute</option>
                  <option value="static_hold">Plan fixe</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-300 mb-1.5">Durée min (s)</label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={vidDuration}
                  onChange={(e) => setVidDuration(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100 font-mono tabular-nums"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={busy || (!vidImageId && !vidPrompt.trim())}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Rendre la séquence MP4
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Séquences vidéo ({sequences.length})</h3>
            {sequences.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Aucune séquence vidéo rendue.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[540px] overflow-y-auto">
                {sequences.map((seq) => (
                  <div key={seq.id} className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden">
                    <video src={seq.url} controls className="w-full h-40 bg-black" />
                    <div className="p-3 text-xs space-y-1">
                      <div className="flex items-center justify-between font-mono tabular-nums text-slate-300">
                        <span>{seq.id}</span>
                        <span>
                          {seq.durationSec}s · {formatBytes(seq.sizeBytes)}
                        </span>
                      </div>
                      <div className="text-slate-500 font-mono text-[11px]">
                        {seq.width}×{seq.height} · {seq.codec} · {String(seq.metadata?.motion || '')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. ASSEMBLY */}
      {tab === 'assembly' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await harouApi.createAssembly({
                  sequenceAssetIds: selectedSeqIds,
                  transition: asmTransition,
                  transitionDurationSec: 0.6,
                });
              }, 'Assemblage automatique FFmpeg lancé.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Assemblage des scènes</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /assemblies/create</code>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">
                Séquences à monter ({selectedSeqIds.length} sélectionnées)
              </label>
              <div className="max-h-48 overflow-y-auto divide-y divide-slate-800 border border-slate-800 rounded-lg bg-[#0B0F17]">
                {sequences.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500">Aucune séquence disponible.</p>
                ) : (
                  sequences.map((seq) => {
                    const checked = selectedSeqIds.includes(seq.id);
                    return (
                      <label
                        key={seq.id}
                        className="flex items-center gap-3 px-3 py-2 text-xs text-slate-200 cursor-pointer hover:bg-slate-800/40"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedSeqIds((prev) => [...prev, seq.id]);
                            } else {
                              setSelectedSeqIds((prev) => prev.filter((id) => id !== seq.id));
                            }
                          }}
                        />
                        <span className="font-mono">{seq.id}</span>
                        <span className="text-slate-400 truncate flex-1">{seq.prompt}</span>
                        <span className="font-mono tabular-nums text-slate-500">{seq.durationSec}s</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Transition entre scènes</label>
              <select
                value={asmTransition}
                onChange={(e) => setAsmTransition(e.target.value as TransitionPreset)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="fade">Fondu noir (fade)</option>
                <option value="dissolve">Fondu enchaîné (dissolve)</option>
                <option value="wipeleft">Balayage gauche (wipeleft)</option>
                <option value="slideleft">Glissement (slideleft)</option>
                <option value="cut">Coupe franche (cut)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={busy || selectedSeqIds.length === 0}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Assembler les scènes
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Assemblages ({assemblies.length})</h3>
            {assemblies.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Aucun assemblage créé.</p>
            ) : (
              <div className="space-y-4 max-h-[540px] overflow-y-auto">
                {assemblies.map((asm) => (
                  <div key={asm.id} className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden">
                    <video src={asm.url} controls className="w-full max-h-60 bg-black" />
                    <div className="p-3 flex items-center justify-between text-xs font-mono tabular-nums text-slate-300">
                      <span>{asm.id}</span>
                      <span>
                        {asm.width}×{asm.height} · {asm.durationSec}s · {formatBytes(asm.sizeBytes)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 7. EXPORT MP4 */}
      {tab === 'export' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runAction(async () => {
                await harouApi.exportMp4({
                  sourceAssetId: expSourceId,
                  profile: expProfile,
                  title: expTitle.trim() || undefined,
                });
              }, 'Exportation MP4 faststart démarrée.');
            }}
            className="lg:col-span-5 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-semibold text-slate-100">Exportation film MP4</h3>
              <code className="text-[11px] font-mono text-slate-400">POST /exports/mp4</code>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Source (assemblage ou séquence)</label>
              <select
                required
                value={expSourceId}
                onChange={(e) => setExpSourceId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              >
                <option value="">Sélectionner une source...</option>
                {exportCandidates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.id} ({item.category} · {item.durationSec}s)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Profil d’exportation</label>
              <select
                value={expProfile}
                onChange={(e) => setExpProfile(e.target.value as ExportProfile)}
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100 font-mono"
              >
                <option value="1080p">1080p Full HD (1920×1080 · 4.5 Mbps)</option>
                <option value="720p">720p HD (1280×720 · 2.5 Mbps)</option>
                <option value="vertical_9_16">Vertical 9:16 (1080×1920 · 3.5 Mbps)</option>
                <option value="square_1_1">Carré 1:1 (1080×1080 · 3.0 Mbps)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-slate-300 mb-1.5">Titre métadonnée MP4</label>
              <input
                type="text"
                value={expTitle}
                onChange={(e) => setExpTitle(e.target.value)}
                placeholder="Ex : Film HAROU Master"
                className="w-full px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100"
              />
            </div>

            <button
              type="submit"
              disabled={busy || !expSourceId}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg cursor-pointer"
            >
              {busy && <Loader2 className="w-4 h-4 animate-spin" />}
              Exporter en MP4
            </button>
          </form>

          <div className="lg:col-span-7 border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
            <h3 className="text-sm font-semibold text-slate-100">Films MP4 exportés ({exportsList.length})</h3>
            {exportsList.length === 0 ? (
              <p className="text-xs text-slate-400 py-8 text-center">Aucun export MP4 disponible.</p>
            ) : (
              <div className="space-y-4 max-h-[540px] overflow-y-auto">
                {exportsList.map((exp) => (
                  <div key={exp.id} className="bg-[#0B0F17] border border-slate-800 rounded-lg overflow-hidden">
                    <video src={exp.url} controls className="w-full max-h-60 bg-black" />
                    <div className="p-3.5 flex items-center justify-between gap-3">
                      <div className="text-xs font-mono tabular-nums text-slate-300">
                        {exp.filename} · {exp.width}×{exp.height} · {exp.durationSec}s ·{' '}
                        {formatBytes(exp.sizeBytes)}
                      </div>
                      <a
                        href={`${exp.url}?download=1`}
                        download={exp.filename}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md whitespace-nowrap shrink-0"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Télécharger
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 8. SYSTEM DIAGNOSTICS */}
      {tab === 'diagnostics' && (
        <div className="space-y-6">
          {/* Header & Live Controls */}
          <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2.5">
                  <Activity className="w-4 h-4 text-blue-400 shrink-0" />
                  <h3 className="text-sm font-semibold text-slate-100">
                    Diagnostics Systèmes en Temps Réel
                  </h3>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Sondes réelles de charge CPU, mémoire vive, disponibilité des bibliothèques
                  locales et état de connexion des quatre moteurs HAROU GENERATOR 2.0.
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap">
                  {diagReport?.timestamp ? `Sonde ${formatTime(diagReport.timestamp)}` : 'En attente...'}
                </span>
                <button
                  type="button"
                  onClick={() => setLivePolling((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-md border text-xs font-medium whitespace-nowrap cursor-pointer ${
                    livePolling
                      ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300'
                      : 'border-slate-700 bg-[#0B0F17] text-slate-300'
                  }`}
                >
                  {livePolling ? 'Temps réel actif (2,5s)' : 'Temps réel en pause'}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchDiagnostics(true)}
                  disabled={diagLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-md whitespace-nowrap cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${diagLoading ? 'animate-spin' : ''}`} />
                  Actualiser
                </button>
              </div>
            </div>

            {diagError && (
              <div className="p-3.5 bg-rose-950/40 border border-rose-900/60 rounded-lg text-xs text-rose-300">
                {diagError}
              </div>
            )}

            {diagLoading && !diagReport ? (
              <div className="py-10 text-center text-xs text-slate-400">
                Exécution des sondes système en cours...
              </div>
            ) : diagReport ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* CPU Real-time Load */}
                <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span>Charge CPU ({diagReport.hardware.cpuCores} cœurs)</span>
                    <span className="font-mono tabular-nums text-slate-200 font-semibold">
                      {diagReport.hardware.cpuUsagePercent ?? 0}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.max(2, diagReport.hardware.cpuUsagePercent ?? 0))}%`,
                      }}
                    />
                  </div>
                  <div className="text-[11px] font-mono tabular-nums text-slate-500 truncate">
                    Load avg 1m : {diagReport.hardware.loadAverage1m} · {diagReport.hardware.arch}
                  </div>
                </div>

                {/* RAM Usage */}
                {(() => {
                  const usedMb = Math.max(
                    0,
                    diagReport.hardware.memoryTotalMb - diagReport.hardware.memoryFreeMb
                  );
                  const ramPct = diagReport.hardware.memoryTotalMb
                    ? Math.round((usedMb / diagReport.hardware.memoryTotalMb) * 100)
                    : 0;
                  return (
                    <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>Mémoire RAM</span>
                        <span className="font-mono tabular-nums text-slate-200 font-semibold">
                          {ramPct}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-500 transition-all duration-300"
                          style={{ width: `${Math.min(100, Math.max(2, ramPct))}%` }}
                        />
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500">
                        {diagReport.hardware.memoryFreeMb} Mo libres / {diagReport.hardware.memoryTotalMb} Mo
                      </div>
                    </div>
                  );
                })()}

                {/* Disk Space */}
                <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs text-slate-400">Stockage média disponible</div>
                  <div className="text-lg font-semibold font-mono tabular-nums text-slate-100">
                    {diagReport.hardware.diskFreeGb} Go
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    Répertoire /storage actif
                  </div>
                </div>

                {/* Host Runtime */}
                <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2">
                  <div className="text-xs text-slate-400">Environnement Serveur</div>
                  <div className="text-sm font-semibold font-mono text-slate-100 truncate">
                    Node {diagReport.hardware.nodeVersion}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 truncate">
                    {diagReport.hardware.platform}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          {/* 4 Engines Connection Status */}
          {diagReport && (
            <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-sm font-semibold text-slate-100">
                  Statut de connexion des moteurs (Devin, Ailleurs, Tic-Tac, Unix)
                </h3>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {diagReport.engines.filter((e) => e.operational).length} / {diagReport.engines.length}{' '}
                  connectés
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {diagReport.engines.map((eng) => (
                  <div
                    key={eng.id}
                    className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-slate-100">{eng.name}</div>
                        <div className="text-[11px] font-mono text-slate-500">{eng.id}</div>
                      </div>
                      <span
                        className={`text-xs font-medium ${
                          eng.operational ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {eng.operational ? 'Connecté · Opérationnel' : 'Déconnecté'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">{eng.role}</p>
                    <div className="text-[11px] font-mono text-slate-300">
                      Modèle principal : {eng.preferredFreeModel}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Providers actifs :{' '}
                      <span className="font-mono text-slate-400">
                        {eng.activeProviders.length > 0 ? eng.activeProviders.join(', ') : 'aucun'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Dépendances : {eng.dependencies.join(' · ')}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Libraries & External Tools Availability */}
          {diagReport && (
            <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-100">
                    Disponibilité des bibliothèques et services open-source
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Vérification directe des binaires système (FFmpeg, FFprobe, Piper, eSpeak-NG,
                    Python) et des services locaux ou gratuits.
                  </p>
                </div>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  {(diagReport.hardware.libraries || []).filter((l) => l.available).length} /{' '}
                  {(diagReport.hardware.libraries || []).length} disponibles
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3">Bibliothèque / Service</th>
                      <th className="py-2.5 px-3">Catégorie</th>
                      <th className="py-2.5 px-3">Disponibilité</th>
                      <th className="py-2.5 px-3">Détail sonde système</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {(diagReport.hardware.libraries || []).map((lib) => (
                      <tr key={lib.id}>
                        <td className="py-2.5 px-3 font-medium text-slate-200">{lib.name}</td>
                        <td className="py-2.5 px-3 font-mono text-slate-400">{lib.category}</td>
                        <td className="py-2.5 px-3">
                          {lib.available ? (
                            <span className="text-emerald-400 font-medium">Disponible</span>
                          ) : (
                            <span className="text-slate-400">Absent / Optionnel</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                          {lib.detail}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
