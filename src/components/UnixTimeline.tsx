import { Film, Scissors, Volume2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatBytes } from '../lib/api';
import type { MediaAssetRecord, ProductionProject, ScenarioRecord } from '../types';

interface UnixTimelineProps {
  project: ProductionProject;
  scenario?: ScenarioRecord;
  sequences: MediaAssetRecord[];
  images: MediaAssetRecord[];
  audios: MediaAssetRecord[];
  assemblyAsset?: MediaAssetRecord;
  exportAsset?: MediaAssetRecord;
}

interface TimelineClip {
  index: number;
  sequence: MediaAssetRecord;
  image?: MediaAssetRecord;
  audio?: MediaAssetRecord;
  title: string;
  speaker?: string;
  motion: string;
  durationSec: number;
  startSec: number;
  endSec: number;
}

function formatTimecode(sec: number): string {
  const safe = Math.max(0, sec);
  const mins = Math.floor(safe / 60);
  const rem = safe - mins * 60;
  const whole = Math.floor(rem);
  const tenths = Math.floor((rem - whole) * 10);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${tenths}`;
}

export function UnixTimeline({
  project,
  scenario,
  sequences,
  images,
  audios,
  assemblyAsset,
  exportAsset,
}: UnixTimelineProps) {
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);

  const orderedSequences = useMemo(() => {
    const map = new Map(sequences.map((s) => [s.id, s]));
    const metaIds = Array.isArray(assemblyAsset?.metadata?.sequenceAssetIds)
      ? (assemblyAsset.metadata.sequenceAssetIds as string[])
      : project.sequenceAssetIds;
    const fromIds = metaIds.map((id) => map.get(id)).filter((s): s is MediaAssetRecord => Boolean(s));
    const seen = new Set(fromIds.map((s) => s.id));
    const remaining = sequences.filter((s) => !seen.has(s.id));
    return [...fromIds, ...remaining];
  }, [sequences, assemblyAsset, project.sequenceAssetIds]);

  const transition =
    typeof assemblyAsset?.metadata?.transition === 'string'
      ? assemblyAsset.metadata.transition
      : 'fade';

  const rawTransitionDur =
    typeof assemblyAsset?.metadata?.transitionDurationSec === 'number'
      ? assemblyAsset.metadata.transitionDurationSec
      : 0.6;

  const { clips, totalDurationSec, effectiveOverlapSec } = useMemo(() => {
    const imgMap = new Map(images.map((i) => [i.id, i]));
    const audMap = new Map(audios.map((a) => [a.id, a]));

    const minDur =
      orderedSequences.length > 0
        ? Math.min(...orderedSequences.map((s) => Math.max(1, s.durationSec || 6)))
        : 6;
    const overlap =
      orderedSequences.length > 1 && transition !== 'cut'
        ? Math.min(rawTransitionDur, Math.max(0.2, minDur * 0.35))
        : 0;

    let cursor = 0;
    const computed: TimelineClip[] = orderedSequences.map((seq, idx) => {
      const dur = Math.max(1, seq.durationSec || scenario?.scenes[idx]?.durationSec || 6);
      const startSec = idx === 0 ? 0 : Math.max(0, Number((cursor - overlap).toFixed(2)));
      const endSec = Number((startSec + dur).toFixed(2));
      cursor = endSec;

      const imageId = typeof seq.metadata?.imageAssetId === 'string' ? seq.metadata.imageAssetId : undefined;
      const audioId = typeof seq.metadata?.audioAssetId === 'string' ? seq.metadata.audioAssetId : undefined;
      const motion =
        typeof seq.metadata?.motion === 'string'
          ? seq.metadata.motion
          : scenario?.scenes[idx]?.cameraMovement || 'ken_burns_in';

      return {
        index: idx,
        sequence: seq,
        image: (imageId ? imgMap.get(imageId) : undefined) || images[idx],
        audio: (audioId ? audMap.get(audioId) : undefined) || audios[idx],
        title: scenario?.scenes[idx]?.title || `Séquence ${idx + 1}`,
        speaker: scenario?.scenes[idx]?.speaker,
        motion,
        durationSec: dur,
        startSec,
        endSec,
      };
    });

    const computedTotal = computed.length > 0 ? computed[computed.length - 1].endSec : 0;
    return {
      clips: computed,
      totalDurationSec: assemblyAsset?.durationSec || computedTotal,
      effectiveOverlapSec: overlap,
    };
  }, [orderedSequences, images, audios, scenario, transition, rawTransitionDur, assemblyAsset]);

  if (clips.length === 0 && !assemblyAsset) {
    return null;
  }

  const activeClip = clips.find((c) => c.sequence.id === selectedSeqId) || clips[0] || null;
  const masterAsset = exportAsset || assemblyAsset;
  const sumClipDurations = clips.reduce((acc, c) => acc + c.durationSec, 0) || 1;
  const rulerTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="border border-slate-800 bg-[#0B0F17] rounded-lg overflow-hidden">
      {/* Timeline Header */}
      <div className="px-4 py-3 border-b border-slate-800 bg-[#101622] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <Scissors className="w-4 h-4 text-emerald-400 shrink-0" />
          <h4 className="text-xs font-semibold text-slate-100 truncate">
            Timeline — HAROU UNIX 5.8
          </h4>
          <span className="text-[11px] font-mono text-slate-400 whitespace-nowrap">
            {assemblyAsset ? 'Montage assemblé' : 'Assemblage en cours'}
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-400 shrink-0">
          <span>{clips.length} séq.</span>
          <span aria-hidden="true">·</span>
          <span>
            Transition : {transition}
            {effectiveOverlapSec > 0 ? ` (${effectiveOverlapSec.toFixed(1)}s)` : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-200 font-semibold">
            Durée {formatTimecode(totalDurationSec)}
          </span>
        </div>
      </div>

      {/* Timecode Ruler */}
      <div className="px-4 py-1.5 border-b border-slate-800/80 bg-[#0D121B] flex items-center gap-3">
        <div className="w-20 shrink-0 text-[10px] font-mono text-slate-500">TIMECODE</div>
        <div className="flex-1 flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500">
          {rulerTicks.map((ratio) => (
            <span key={ratio}>{formatTimecode(totalDurationSec * ratio)}</span>
          ))}
        </div>
      </div>

      {/* Tracks Area */}
      <div className="p-4 space-y-2.5">
        {/* Track V1 — Video Sequences */}
        <div className="flex items-stretch gap-3">
          <div className="w-20 shrink-0 flex flex-col justify-center px-2 py-2 bg-[#121824] border border-slate-800 rounded text-[11px] font-mono">
            <span className="text-slate-200 font-semibold">V1</span>
            <span className="text-[10px] text-slate-500">H.264</span>
          </div>

          <div className="flex-1 flex items-stretch gap-1 min-w-0 overflow-x-auto">
            {clips.map((clip, i) => {
              const isSelected = activeClip?.sequence.id === clip.sequence.id;
              const pct = Math.max(12, Math.round((clip.durationSec / sumClipDurations) * 100));
              return (
                <div key={clip.sequence.id} className="contents">
                  <button
                    type="button"
                    onClick={() => setSelectedSeqId(clip.sequence.id)}
                    style={{ flexGrow: pct, flexBasis: '120px' }}
                    className={`relative text-left p-2.5 rounded border transition-colors overflow-hidden cursor-pointer min-w-[120px] ${
                      isSelected
                        ? 'border-blue-500 bg-blue-950/35'
                        : 'border-slate-800 bg-[#121824] hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[11px] font-medium text-slate-100 truncate">
                        S{clip.index + 1} · {clip.title}
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-blue-300 shrink-0">
                        {clip.durationSec}s
                      </span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-mono tabular-nums text-slate-400">
                      <span className="truncate">{clip.motion}</span>
                      <span className="shrink-0">
                        {formatTimecode(clip.startSec)}–{formatTimecode(clip.endSec)}
                      </span>
                    </div>
                  </button>

                  {i < clips.length - 1 && (
                    <div
                      title={`Transition ${transition}`}
                      className="w-4 shrink-0 flex flex-col items-center justify-center border-x border-dashed border-emerald-700/60 bg-emerald-950/20 text-[9px] font-mono text-emerald-400"
                    >
                      <span>{transition === 'cut' ? '|' : '×'}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Track A1 — Audio / Voices */}
        <div className="flex items-stretch gap-3">
          <div className="w-20 shrink-0 flex flex-col justify-center px-2 py-2 bg-[#121824] border border-slate-800 rounded text-[11px] font-mono">
            <span className="text-slate-200 font-semibold">A1</span>
            <span className="text-[10px] text-slate-500">Audio</span>
          </div>

          <div className="flex-1 flex items-stretch gap-1 min-w-0 overflow-x-auto">
            {clips.map((clip, i) => {
              const pct = Math.max(12, Math.round((clip.durationSec / sumClipDurations) * 100));
              const hasAudio = Boolean(clip.audio);
              return (
                <div key={`aud-${clip.sequence.id}`} className="contents">
                  <div
                    style={{ flexGrow: pct, flexBasis: '120px' }}
                    className={`px-2.5 py-2 rounded border min-w-[120px] flex items-center justify-between gap-2 ${
                      hasAudio
                        ? 'border-amber-900/60 bg-amber-950/20 text-amber-200'
                        : 'border-slate-800/70 bg-[#0E131D] text-slate-500'
                    }`}
                  >
                    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono truncate">
                      <Volume2 className="w-3 h-3 shrink-0" />
                      {hasAudio
                        ? `${clip.speaker || 'Voix'} · ${clip.audio?.codec || 'pcm_s16le'}`
                        : 'Stéréo silencieuse'}
                    </span>
                    {hasAudio && (
                      <span className="text-[10px] font-mono tabular-nums text-amber-300 shrink-0">
                        {clip.audio?.durationSec}s
                      </span>
                    )}
                  </div>
                  {i < clips.length - 1 && <div className="w-4 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>

        {/* Track M1 — Master Assembly / Export */}
        {masterAsset && (
          <div className="flex items-stretch gap-3">
            <div className="w-20 shrink-0 flex flex-col justify-center px-2 py-2 bg-[#121824] border border-slate-800 rounded text-[11px] font-mono">
              <span className="text-emerald-400 font-semibold">M1</span>
              <span className="text-[10px] text-slate-500">Master</span>
            </div>

            <div className="flex-1 px-3 py-2 rounded border border-emerald-800/60 bg-emerald-950/20 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
              <span className="inline-flex items-center gap-2 text-emerald-300">
                <Film className="w-3.5 h-3.5 shrink-0" />
                {masterAsset.filename} ({masterAsset.provider})
              </span>
              <span className="tabular-nums text-slate-300">
                {masterAsset.width}×{masterAsset.height} · {masterAsset.codec || 'h264'} ·{' '}
                {formatTimecode(masterAsset.durationSec || totalDurationSec)} ·{' '}
                {formatBytes(masterAsset.sizeBytes)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Selected Sequence Clip Inspector */}
      {activeClip && (
        <div className="px-4 py-3 border-t border-slate-800 bg-[#0E131D] flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {activeClip.image && (
              <img
                src={activeClip.image.url}
                alt={activeClip.title}
                referrerPolicy="no-referrer"
                className="w-16 h-10 object-cover rounded border border-slate-800 shrink-0"
              />
            )}
            <div className="min-w-0 text-xs">
              <div className="font-medium text-slate-100 truncate">
                Clip sélectionné : S{activeClip.index + 1} — {activeClip.title}
              </div>
              <div className="text-[11px] font-mono tabular-nums text-slate-400">
                {activeClip.sequence.id} · {activeClip.sequence.width}×{activeClip.sequence.height}{' '}
                · {activeClip.durationSec}s · {formatBytes(activeClip.sequence.sizeBytes)} ·{' '}
                {activeClip.motion}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {activeClip.audio && (
              <audio controls src={activeClip.audio.url} className="h-7 max-w-[200px]" />
            )}
            <a
              href={activeClip.sequence.url}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 bg-[#121824] hover:bg-slate-800 border border-slate-700 text-xs font-mono text-blue-300 rounded whitespace-nowrap"
            >
              Lire la séquence MP4
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
