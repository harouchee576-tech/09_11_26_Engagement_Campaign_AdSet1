import { Check, Copy, ExternalLink, KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatTime, harouApi } from '../lib/api';
import type { ApiKeyInfo, EngineInfo } from '../types';
import { HealthCheck } from './HealthCheck';

interface ApiConnectViewProps {
  info: EngineInfo | null;
  apiKeys: ApiKeyInfo[];
  onRefresh: () => Promise<void>;
}

type IntegrationTab = 'curl' | 'harou-ai' | 'lovable' | 'media-sign';

export function ApiConnectView({ info, apiKeys, onRefresh }: ApiConnectViewProps) {
  const [newKeyName, setNewKeyName] = useState('HAROU AI Production');
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [snippetTab, setSnippetTab] = useState<IntegrationTab>('lovable');

  const personalApiUrl = info?.personalApiBaseUrl || `${window.location.origin}/api/v1`;
  const openApiUrl = info?.openApiUrl || `${personalApiUrl}/openapi.json`;
  const docsUrl = info?.docsUrl || `${personalApiUrl}/docs`;
  const healthUrl = info?.healthUrl || `${personalApiUrl}/health`;
  const activeSnippetKey = createdSecret || 'VOTRE_CLE_HAROU_AI';

  async function copyText(id: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedId(id);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000);
  }

  async function handleCreateKey(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await harouApi.createKey(newKeyName);
      setCreatedSecret(res.plaintextKey);
      setNewKeyName('HAROU AI Client');
      await onRefresh();
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    await harouApi.revokeKey(id);
    await onRefresh();
  }

  const curlSnippet = `curl -X POST "${personalApiUrl}/pipeline/produce" \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: ${activeSnippetKey}" \\
  -d '{
    "projectName": "Film HAROU AI",
    "prompt": "Une exploratrice cartographie une station orbitale abandonnée",
    "sceneCount": 3,
    "exportProfile": "720p"
  }'`;

  const tsSnippet = `const HAROU_GENERATOR_API = "${personalApiUrl}";
const HAROU_GENERATOR_KEY = process.env.HAROU_GENERATOR_KEY!; // Côté serveur HAROU AI

export async function produceFilmFromHarouAI(prompt: string) {
  const res = await fetch(\`\${HAROU_GENERATOR_API}/pipeline/produce\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": HAROU_GENERATOR_KEY,
    },
    body: JSON.stringify({ prompt, sceneCount: 3, exportProfile: "720p" }),
  });
  return res.json(); // Retourne { project, job } pour suivi temps réel
}`;

  const lovableEdgeSnippet = `// Supabase / Lovable Cloud Edge Function (secrets protégés côté serveur)
// Secrets Lovable : HAROU_API_URL="${personalApiUrl}" et HAROU_API_KEY="${activeSnippetKey}"

Deno.serve(async (req) => {
  const { task = "pipeline", prompt, sceneCount = 3 } = await req.json();
  const apiUrl = Deno.env.get("HAROU_API_URL")!;
  const apiKey = Deno.env.get("HAROU_API_KEY")!;

  const res = await fetch(\`\${apiUrl}/dispatch\`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": \`Bearer \${apiKey}\`,
    },
    body: JSON.stringify({ task, prompt, sceneCount, exportProfile: "720p" }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
});`;

  const signedMediaSnippet = `// Lecture sécurisée de la vidéo MP4 dans un frontend Lovable sans exposer la clé API
const signRes = await fetch("${personalApiUrl}/media/sign", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-api-key": HAROU_GENERATOR_KEY, // appelé côté serveur / Edge Function
  },
  body: JSON.stringify({
    category: "exports",
    filename: "exp_exemple.mp4",
    ttlSec: 3600,
  }),
});
const { signedUrl } = await signRes.json();
// Utilisez directement <video src={signedUrl} controls /> dans Lovable`;

  const cloudRunSnippet = `gcloud run deploy harou-generator-api \\
  --source . \\
  --region europe-west2 \\
  --allow-unauthenticated \\
  --port 3000 \\
  --memory 2Gi \\
  --cpu 2 \\
  --set-env-vars "NODE_ENV=production,CORS_ALLOWED_ORIGINS=*,RATE_LIMIT_RPM=180" \\
  --set-secrets "HAROU_API_KEY=HAROU_API_KEY:latest,HAROU_SESSION_SECRET=HAROU_SESSION_SECRET:latest"`;

  const snippetContent: Record<IntegrationTab, { title: string; code: string }> = {
    lovable: {
      title: 'Edge Function Lovable (protection des clés secrètes)',
      code: lovableEdgeSnippet,
    },
    'harou-ai': {
      title: 'SDK TypeScript serveur pour HAROU AI',
      code: tsSnippet,
    },
    'media-sign': {
      title: 'URL média signée temporaire pour <video> / <img> externe',
      code: signedMediaSnippet,
    },
    curl: {
      title: 'Test rapide cURL',
      code: curlSnippet,
    },
  };

  return (
    <div className="space-y-8">
      {/* Real-Time Health Check */}
      <HealthCheck endpoint="/api/v1/health" />

      {/* Public API Endpoint & OpenAPI Docs */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">
              Service API Public &amp; OpenAPI 3.1
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              URL API stable prête pour HAROU AI, Lovable et clients REST externes. Authentification
              obligatoire par <code className="text-slate-300">x-api-key</code> ou{' '}
              <code className="text-slate-300">Authorization: Bearer</code>.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <a
              href={docsUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Documentation OpenAPI
            </a>
            <a
              href={openApiUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0B0F17] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium rounded-md whitespace-nowrap"
            >
              openapi.json
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-400">URL de base API v1</div>
              <code className="text-xs font-mono text-blue-300 break-all">{personalApiUrl}</code>
            </div>
            <button
              type="button"
              onClick={() => void copyText('base-url', personalApiUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#121824] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedId === 'base-url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedId === 'base-url' ? 'Copié' : 'Copier'}
            </button>
          </div>

          <div className="flex items-center gap-3 p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-slate-400">Spécification OpenAPI 3.1 (import Lovable / Postman)</div>
              <code className="text-xs font-mono text-slate-300 break-all">{openApiUrl}</code>
            </div>
            <button
              type="button"
              onClick={() => void copyText('openapi-url', openApiUrl)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#121824] hover:bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedId === 'openapi-url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedId === 'openapi-url' ? 'Copié' : 'Copier'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
            <div className="text-slate-400">Politique CORS &amp; Rate-Limit</div>
            <div className="font-mono tabular-nums text-slate-200 mt-1 truncate">
              {info?.deployment?.corsAllowedOrigins?.join(', ') || '*'} ·{' '}
              {info?.deployment?.rateLimitRpm || 180} req/min
            </div>
          </div>

          <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
            <div className="text-slate-400">Clé maître serveur (env)</div>
            <div className="font-mono text-slate-200 mt-1">
              {info?.deployment?.envApiKeyConfigured
                ? 'HAROU_API_KEY active'
                : 'Clés dynamiques SHA-256'}
            </div>
          </div>
        </div>
      </section>

      {/* HAROU AI / Lovable Client Keys */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Clés d’accès client (HAROU AI / Lovable)
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Les clés sont hachées en SHA-256 côté serveur. En production conteneurisée, vous
              pouvez aussi définir <code className="text-slate-300">HAROU_API_KEY</code> en secret
              serveur.
            </p>
          </div>

          <form onSubmit={handleCreateKey} className="flex items-center gap-2 shrink-0">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Nom du client (ex: Lovable)"
              className="px-3 py-2 bg-[#0B0F17] border border-slate-800 rounded-lg text-xs text-slate-100 w-48"
            />
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Générer une clé API
            </button>
          </form>
        </div>

        {createdSecret && (
          <div className="p-4 bg-emerald-950/30 border border-emerald-800/60 rounded-lg space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-emerald-300">
                Nouvelle clé générée — copiez-la maintenant (affichée une seule fois)
              </span>
              <button
                type="button"
                onClick={() => void copyText('new-secret', createdSecret)}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-700 hover:bg-emerald-600 text-white text-xs rounded cursor-pointer"
              >
                {copiedId === 'new-secret' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedId === 'new-secret' ? 'Copiée' : 'Copier la clé'}
              </button>
            </div>
            <code className="block text-xs font-mono text-emerald-200 break-all">
              {createdSecret}
            </code>
          </div>
        )}

        {apiKeys.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-400">
            Aucune clé dynamique générée. Créez une clé API ci-dessus ou configurez{' '}
            <code className="text-slate-300">HAROU_API_KEY</code> sur le serveur.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 px-3">Client</th>
                  <th className="py-2.5 px-3">Préfixe</th>
                  <th className="py-2.5 px-3 text-right">Requêtes</th>
                  <th className="py-2.5 px-3 text-right">Dernière utilisation</th>
                  <th className="py-2.5 px-3 text-right">Statut</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {apiKeys.map((k) => (
                  <tr key={k.id}>
                    <td className="py-2.5 px-3 font-medium text-slate-200">
                      <span className="inline-flex items-center gap-1.5">
                        <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                        {k.name}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-300">{k.prefix}…</td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-300">
                      {k.requestCount}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                      {formatTime(k.lastUsedAt)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {k.revokedAt ? (
                        <span className="text-rose-400">Révoquée</span>
                      ) : (
                        <span className="text-emerald-400">Active</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {!k.revokedAt ? (
                        <button
                          type="button"
                          onClick={() => void handleRevoke(k.id)}
                          className="inline-flex items-center gap-1 text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Révoquer
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* External App Integration: Lovable, HAROU AI, Signed Media, cURL */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Connexion depuis Lovable &amp; HAROU AI
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Stockez votre clé API dans les Secrets Edge Function / serveur de Lovable ou HAROU AI —
              ne la placez jamais dans le code React navigateur.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg">
            {(
              [
                ['lovable', 'Lovable Edge'],
                ['harou-ai', 'HAROU AI SDK'],
                ['media-sign', 'Média Signé'],
                ['curl', 'cURL'],
              ] as Array<[IntegrationTab, string]>
            ).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setSnippetTab(tabId)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  snippetTab === tabId
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-300">
              {snippetContent[snippetTab].title}
            </span>
            <button
              type="button"
              onClick={() => void copyText(`snippet-${snippetTab}`, snippetContent[snippetTab].code)}
              className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              {copiedId === `snippet-${snippetTab}` ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              Copier
            </button>
          </div>
          <pre className="p-3.5 bg-[#0B0F17] border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
            {snippetContent[snippetTab].code}
          </pre>
        </div>
      </section>

      {/* Public Deployment Guide */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-sm font-semibold text-slate-100">
              Déploiement public sécurisé &amp; URL API stable
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Le dépôt inclut <code className="text-slate-300">Dockerfile</code>,{' '}
              <code className="text-slate-300">render.yaml</code> et la probe{' '}
              <code className="text-slate-300">{healthUrl}</code> pour un déploiement immédiat avec
              FFmpeg et stockage persistant.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-200">
                Option 1 — Google Cloud Run (URL HTTPS stable)
              </span>
              <button
                type="button"
                onClick={() => void copyText('cloudrun', cloudRunSnippet)}
                className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
              >
                {copiedId === 'cloudrun' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                Copier
              </button>
            </div>
            <pre className="p-3 bg-[#121824] border border-slate-800/80 rounded text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
              {cloudRunSnippet}
            </pre>
          </div>

          <div className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2 text-xs text-slate-300">
            <div className="font-semibold text-slate-200">
              Option 2 — Render / Railway / VPS Docker
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
              <li>
                Poussez le projet sur GitHub et créez un service Docker (ou utilisez{' '}
                <code className="text-slate-300">render.yaml</code>).
              </li>
              <li>
                Définissez <code className="text-slate-300">HAROU_API_KEY</code> et{' '}
                <code className="text-slate-300">HAROU_SESSION_SECRET</code> dans les variables
                secrètes de l’hébergeur.
              </li>
              <li>
                Montez un volume persistant sur <code className="text-slate-300">/app/runtime</code>{' '}
                avec <code className="text-slate-300">HAROU_DATA_DIR</code> et{' '}
                <code className="text-slate-300">HAROU_STORAGE_DIR</code>.
              </li>
              <li>
                Renseignez <code className="text-slate-300">PUBLIC_API_URL</code> avec votre domaine
                HTTPS public et connectez Lovable / HAROU AI via{' '}
                <code className="text-slate-300">/api/v1/openapi.json</code>.
              </li>
            </ol>
          </div>
        </div>
      </section>

      {/* HAROU GENERATOR 2.0 Collaborative 4-Engine Matrix & Real Hardware */}
      {info?.engines && info.engines.length > 0 && (
        <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-100">
                HAROU GENERATOR 2.0 — 4 Moteurs Collaboratifs &amp; Dispatch Central
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                L’endpoint <code className="text-slate-300">POST /api/v1/dispatch</code> analyse
                automatiquement la requête, route vers le moteur spécialisé et partage la mémoire de
                cohérence HAROU TIC-TAC 3.7.
              </p>
            </div>
            <code className="text-[11px] font-mono text-blue-300 whitespace-nowrap">
              GET /api/v1/engines
            </code>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {info.engines.map((eng) => (
              <div
                key={eng.id}
                className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-100">{eng.name}</span>
                  <span
                    className={`text-[11px] font-medium ${
                      eng.operational ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {eng.operational ? 'Opérationnel' : 'Indisponible'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{eng.role}</p>
                <div className="text-[11px] font-mono text-slate-300">
                  Modèle actif : {eng.preferredFreeModel}
                </div>
                <div className="text-[11px] text-slate-500">
                  Dépendances : {eng.dependencies.join(' · ')}
                </div>
              </div>
            ))}
          </div>

          {info.hardware && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-slate-800/80 text-xs">
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
                <div className="text-slate-400">CPU ({info.hardware.cpuCores} cœurs)</div>
                <div className="font-mono tabular-nums text-slate-200 mt-1 truncate">
                  Charge {info.hardware.loadAverage1m} · {info.hardware.arch}
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
                <div className="text-slate-400">Mémoire RAM</div>
                <div className="font-mono tabular-nums text-slate-200 mt-1">
                  {info.hardware.memoryFreeMb} / {info.hardware.memoryTotalMb} Mo
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
                <div className="text-slate-400">Disque libre</div>
                <div className="font-mono tabular-nums text-slate-200 mt-1">
                  {info.hardware.diskFreeGb} Go
                </div>
              </div>
              <div className="p-3 bg-[#0B0F17] border border-slate-800 rounded-lg">
                <div className="text-slate-400">FFmpeg / Node</div>
                <div className="font-mono tabular-nums text-slate-200 mt-1 truncate">
                  {info.hardware.ffmpegVersion ? 'FFmpeg actif' : 'FFmpeg absent'} ·{' '}
                  {info.hardware.nodeVersion}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Modular Providers Matrix */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Architecture modulaire (modèles open-source et gratuits)
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Aucune API vidéo payante connectée. Chaque capacité accepte un paramètre{' '}
            <code className="text-slate-300">provider</code> pour basculer entre moteurs locaux et
            endpoints gratuits.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400">
                <th className="py-2.5 px-3">Module</th>
                <th className="py-2.5 px-3">Capacité</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">Statut serveur</th>
                <th className="py-2.5 px-3">Configuration serveur</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {(info?.providers || []).map((p) => (
                <tr key={p.id}>
                  <td className="py-2.5 px-3 font-medium text-slate-200">
                    <div>{p.name}</div>
                    <div className="text-[11px] font-mono text-slate-500">{p.id}</div>
                  </td>
                  <td className="py-2.5 px-3 font-mono text-slate-300">{p.capability}</td>
                  <td className="py-2.5 px-3 text-slate-400">{p.license}</td>
                  <td className="py-2.5 px-3">
                    {p.available ? (
                      <span className="text-emerald-400 font-medium">Actif</span>
                    ) : (
                      <span className="text-slate-400">Inactif</span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">{p.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Open-Source Installation Guides */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Guide d’installation des moteurs open-source optionnels
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Toutes les variables d’environnement sont optionnelles. Si un moteur local n’est pas
            installé, HAROU GENERATOR 2.0 bascule automatiquement vers une alternative gratuite active.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(info?.providers || [])
            .filter((p) => p.installGuide && p.installGuide.commands.length > 0)
            .map((p) => (
              <div
                key={`guide-${p.id}`}
                className="p-4 bg-[#0B0F17] border border-slate-800 rounded-lg space-y-2.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">{p.name}</span>
                  <span
                    className={`text-[11px] font-medium ${
                      p.available ? 'text-emerald-400' : 'text-slate-400'
                    }`}
                  >
                    {p.available ? 'Détecté' : 'Optionnel'}
                  </span>
                </div>
                <p className="text-xs text-slate-400">{p.installGuide?.summary}</p>
                <pre className="p-2.5 bg-[#121824] border border-slate-800/80 rounded text-[11px] font-mono text-slate-300 overflow-x-auto leading-relaxed">
                  {p.installGuide?.commands.join('\n')}
                </pre>
                {p.installGuide && p.installGuide.envVars.length > 0 && (
                  <div className="text-[11px] font-mono text-slate-500">
                    Env optionnelles : {p.installGuide.envVars.join(' · ')}
                  </div>
                )}
              </div>
            ))}
        </div>
      </section>

      {/* Endpoint Catalog */}
      <section className="border border-slate-800 bg-[#121824] rounded-xl p-6 space-y-4">
        <h3 className="text-sm font-semibold text-slate-100">Catalogue des endpoints REST v1</h3>
        <div className="divide-y divide-slate-800/70">
          {(info?.endpoints || []).map((ep) => (
            <div
              key={`${ep.method}-${ep.path}`}
              className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-3 font-mono">
                <span className="text-blue-400 w-10">{ep.method}</span>
                <span className="text-slate-200">{ep.path}</span>
              </div>
              <span className="text-slate-400">{ep.description}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
