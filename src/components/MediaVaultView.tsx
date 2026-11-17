import { Download, Film, Image as ImageIcon, Music } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, formatTime } from '../lib/api';
import type { MediaAssetRecord, MediaCategory } from '../types';

interface MediaVaultViewProps {
  images: MediaAssetRecord[];
  audios: MediaAssetRecord[];
  sequences: MediaAssetRecord[];
  assemblies: MediaAssetRecord[];
  exportsList: MediaAssetRecord[];
}

export function MediaVaultView({
  images,
  audios,
  sequences,
  assemblies,
  exportsList,
}: MediaVaultViewProps) {
  const [category, setCategory] = useState<'all' | MediaCategory>('all');

  const all = [...exportsList, ...assemblies, ...sequences, ...images, ...audios].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const items = category === 'all' ? all : all.filter((item) => item.category === category);

  const tabs: Array<{ id: 'all' | MediaCategory; label: string; count: number }> = [
    { id: 'all', label: 'Tout', count: all.length },
    { id: 'exports', label: 'Exports MP4', count: exportsList.length },
    { id: 'assemblies', label: 'Assemblages', count: assemblies.length },
    { id: 'sequences', label: 'Séquences', count: sequences.length },
    { id: 'images', label: 'Images', count: images.length },
    { id: 'audio', label: 'Audio WAV', count: audios.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Médiathèque et masters générés</h2>
          <p className="text-xs text-slate-400 mt-1">
            Tous les fichiers générés sur le serveur avec métadonnées FFprobe réelles.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#121824] border border-slate-800 rounded-lg overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCategory(t.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                category === t.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-100'
              }`}
            >
              {t.label} ({t.count})
            </button>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="border border-slate-800 bg-[#121824] rounded-xl p-12 text-center space-y-2">
          <Film className="w-8 h-8 text-slate-600 mx-auto" />
          <p className="text-sm text-slate-300">Aucun média dans cette catégorie</p>
          <p className="text-xs text-slate-400">
            Lancez une production ou utilisez l’Atelier modulaire pour générer vos premiers fichiers.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {items.map((asset) => {
            const isVideo =
              asset.category === 'sequences' ||
              asset.category === 'assemblies' ||
              asset.category === 'exports';
            const isImage = asset.category === 'images';
            const isAudio = asset.category === 'audio';

            return (
              <div
                key={asset.id}
                className="border border-slate-800 bg-[#121824] rounded-xl overflow-hidden flex flex-col"
              >
                {isImage && (
                  <img
                    src={asset.url}
                    alt={asset.prompt || asset.filename}
                    referrerPolicy="no-referrer"
                    className="w-full h-44 object-cover bg-[#0B0F17]"
                  />
                )}
                {isVideo && (
                  <video src={asset.url} controls className="w-full h-44 bg-black" />
                )}
                {isAudio && (
                  <div className="h-44 bg-[#0B0F17] flex flex-col items-center justify-center p-4 gap-3 border-b border-slate-800">
                    <Music className="w-7 h-7 text-slate-500" />
                    <audio controls src={asset.url} className="w-full h-8" />
                  </div>
                )}

                <div className="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-slate-200 truncate">{asset.filename}</span>
                      <span className="text-slate-400 font-mono whitespace-nowrap">
                        {asset.category}
                      </span>
                    </div>
                    {asset.prompt && (
                      <p className="text-xs text-slate-400 line-clamp-2">{asset.prompt}</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono tabular-nums text-slate-400">
                    <span className="truncate">
                      {asset.width && asset.height ? `${asset.width}×${asset.height} · ` : ''}
                      {asset.durationSec ? `${asset.durationSec}s · ` : ''}
                      {formatBytes(asset.sizeBytes)} · {formatTime(asset.createdAt)}
                    </span>
                    <a
                      href={`${asset.url}?download=1`}
                      download={asset.filename}
                      className="inline-flex items-center gap-1 text-blue-400 hover:text-blue-300 shrink-0"
                    >
                      {isImage ? (
                        <ImageIcon className="w-3.5 h-3.5" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Télécharger
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
