export function buildOpenApiSpec(apiBaseUrl: string) {
  const rootUrl = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return {
    openapi: '3.1.0',
    info: {
      title: 'HAROU GENERATOR 2.0 — Public Multimedia API',
      version: '2.0.0',
      summary:
        'Moteur centralisé de génération multimédia et de production vidéo MP4 (HAROU DEVIN 2.0, HAROU AILLEURS 4.6, HAROU TIC-TAC 3.7, HAROU UNIX 5.8).',
      description:
        'API REST publique sécurisée destinée à HAROU AI, Lovable et aux clients externes. Toutes les clés de modèles tiers restent strictement isolées côté serveur. Authentification par clé API via header `x-api-key` ou `Authorization: Bearer <clé>`.',
      contact: {
        name: 'HAROU CEE (Harouna Dianka)',
      },
    },
    servers: [
      {
        url: apiBaseUrl,
        description: 'Endpoint API v1 actif',
      },
      {
        url: `${rootUrl}/api/v1`,
        description: 'URL relative au serveur courant',
      },
    ],
    tags: [
      { name: 'Santé & Découverte', description: 'Vérification serveur, OpenAPI et capacités' },
      { name: 'Orchestration 2.0', description: 'Dispatch central et pipeline film complet' },
      { name: 'Scénarios & Personnages', description: 'HAROU DEVIN 2.0 & HAROU TIC-TAC 3.7' },
      { name: 'Images & Audio', description: 'HAROU AILLEURS 4.6 & synthèse vocale WAV' },
      { name: 'Vidéo & Montage MP4', description: 'HAROU UNIX 5.8 (séquences, assemblage xfade, export)' },
      { name: 'Projets & Tâches', description: 'Suivi asynchrone, SSE et mémoire partagée' },
      { name: 'Sécurité & Médias', description: 'Clés API et URLs média signées' },
    ],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key',
          description: 'Clé API client générée dans la console ou définie via HAROU_API_KEY.',
        },
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization: Bearer <votre_cle_api>',
        },
      },
      schemas: {
        ErrorResponse: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'validation_error' },
            message: { type: 'string' },
          },
          required: ['error', 'message'],
        },
        HealthResponse: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', example: true },
            status: { type: 'string', enum: ['ok', 'degraded'] },
            engine: { type: 'string', example: 'HAROU GENERATOR 2.0' },
            version: { type: 'string', example: '2.0.0' },
            uptimeSec: { type: 'number' },
            apiBaseUrl: { type: 'string' },
            openApiUrl: { type: 'string' },
            checks: {
              type: 'object',
              properties: {
                storageWritable: { type: 'boolean' },
                ffmpegAvailable: { type: 'boolean' },
                ffprobeAvailable: { type: 'boolean' },
                operationalEngines: { type: 'integer' },
                totalEngines: { type: 'integer' },
                activeJobs: { type: 'integer' },
              },
            },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        DispatchRequest: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              enum: [
                'auto',
                'pipeline',
                'scenario',
                'character',
                'image',
                'audio',
                'video',
                'assembly',
                'export',
              ],
              description: 'Type de tâche ou auto-détection intelligente.',
            },
            prompt: { type: 'string', description: 'Instruction créative ou description visuelle.' },
            projectId: { type: 'string' },
            projectName: { type: 'string' },
            provider: { type: 'string', default: 'auto' },
            sceneCount: { type: 'integer', minimum: 1, maximum: 12 },
            exportProfile: {
              type: 'string',
              enum: ['1080p', '720p', 'vertical_9_16', 'square_1_1'],
            },
            transition: {
              type: 'string',
              enum: ['fade', 'dissolve', 'wipeleft', 'slideleft', 'cut'],
            },
            transitionDurationSec: { type: 'number', minimum: 0.1, maximum: 3 },
            imageAssetId: { type: 'string' },
            sequenceAssetIds: { type: 'array', items: { type: 'string' } },
            sourceAssetId: { type: 'string' },
            sync: { type: 'boolean', default: false },
            webhookUrl: { type: 'string', format: 'uri' },
          },
        },
      },
    },
    security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
    paths: {
      '/health': {
        get: {
          tags: ['Santé & Découverte'],
          security: [],
          summary: 'Vérification publique de santé du serveur',
          description:
            'Probe public pour Cloud Run, Render, Railway, Lovable et systèmes de monitoring. Ne retourne aucun secret.',
          responses: {
            '200': {
              description: 'Serveur sain et opérationnel',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/HealthResponse' },
                },
              },
            },
            '503': { description: 'Stockage indisponible ou serveur dégradé' },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Santé & Découverte'],
          security: [],
          summary: 'Spécification OpenAPI 3.1.0 au format JSON',
          responses: {
            '200': { description: 'Document OpenAPI 3.1.0 complet' },
          },
        },
      },
      '/info': {
        get: {
          tags: ['Santé & Découverte'],
          summary: 'Métadonnées du moteur, URL API publique et capacités disponibles',
          responses: {
            '200': { description: 'Configuration publique du moteur' },
            '401': { description: 'Clé API manquante ou invalide' },
          },
        },
      },
      '/engines': {
        get: {
          tags: ['Santé & Découverte'],
          summary: 'Diagnostics matériels temps réel et statut des 4 moteurs',
          responses: { '200': { description: 'État CPU, RAM, disque, FFmpeg et moteurs' } },
        },
      },
      '/providers': {
        get: {
          tags: ['Santé & Découverte'],
          summary: 'Catalogue des modules open-source et gratuits détectés sur le serveur',
          responses: { '200': { description: 'Liste des providers disponibles' } },
        },
      },
      '/dispatch': {
        post: {
          tags: ['Orchestration 2.0'],
          summary: 'Routeur central HAROU GENERATOR 2.0',
          description:
            'Analyse le champ `task` ou le `prompt` pour router automatiquement vers DEVIN 2.0, AILLEURS 4.6, TIC-TAC 3.7, UNIX 5.8 ou le pipeline film complet.',
          parameters: [
            {
              name: 'sync',
              in: 'query',
              schema: { type: 'boolean' },
              description: 'Attendre la fin de la tâche unitaire avant de répondre.',
            },
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/DispatchRequest' },
                example: {
                  task: 'image',
                  prompt: 'Paysage futuriste africain au coucher du soleil, cinéma 35mm',
                  width: 1280,
                  height: 720,
                  sync: true,
                },
              },
            },
          },
          responses: {
            '201': { description: 'Résultat généré en mode synchrone' },
            '202': { description: 'Tâche mise en file d’exécution asynchrone' },
            '400': { description: 'Erreur de validation' },
          },
        },
      },
      '/pipeline/produce': {
        post: {
          tags: ['Orchestration 2.0'],
          summary: 'Lancer la production complète d’un film MP4 de bout en bout',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    projectName: { type: 'string' },
                    prompt: { type: 'string' },
                    genre: { type: 'string' },
                    tone: { type: 'string' },
                    visualStyle: { type: 'string' },
                    sceneCount: { type: 'integer', default: 3 },
                    language: { type: 'string', default: 'fr' },
                    transition: { type: 'string', default: 'fade' },
                    exportProfile: { type: 'string', default: '720p' },
                    withVoice: { type: 'boolean', default: true },
                    webhookUrl: { type: 'string', format: 'uri' },
                  },
                },
              },
            },
          },
          responses: {
            '202': { description: 'Projet créé et pipeline démarré ({ project, job })' },
          },
        },
      },
      '/scenarios': {
        get: {
          tags: ['Scénarios & Personnages'],
          summary: 'Lister les scénarios enregistrés',
          responses: { '200': { description: 'Liste des scénarios' } },
        },
        post: {
          tags: ['Scénarios & Personnages'],
          summary: 'Envoyer un scénario structuré depuis HAROU AI / Lovable',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['title', 'scenes'],
                  properties: {
                    projectId: { type: 'string' },
                    title: { type: 'string' },
                    logline: { type: 'string' },
                    scenes: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Scénario enregistré' } },
        },
      },
      '/scenarios/generate': {
        post: {
          tags: ['Scénarios & Personnages'],
          summary: 'Générer un scénario multi-scènes avec HAROU DEVIN 2.0',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    projectId: { type: 'string' },
                    prompt: { type: 'string' },
                    sceneCount: { type: 'integer', default: 3 },
                    language: { type: 'string', default: 'fr' },
                    provider: { type: 'string', default: 'auto' },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Scénario généré' }, '202': { description: 'Job créé' } },
        },
      },
      '/characters': {
        get: {
          tags: ['Scénarios & Personnages'],
          summary: 'Lister les personnages enregistrés',
          responses: { '200': { description: 'Liste des personnages' } },
        },
        post: {
          tags: ['Scénarios & Personnages'],
          summary: 'Enregistrer un personnage existant dans la mémoire TIC-TAC 3.7',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    projectId: { type: 'string' },
                    name: { type: 'string' },
                    role: { type: 'string' },
                    physicalDescription: { type: 'string' },
                    visualPromptAnchor: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Personnage enregistré' } },
        },
      },
      '/characters/create': {
        post: {
          tags: ['Scénarios & Personnages'],
          summary: 'Créer un personnage avec fiche et portrait via HAROU TIC-TAC 3.7',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['concept'],
                  properties: {
                    projectId: { type: 'string' },
                    name: { type: 'string' },
                    concept: { type: 'string' },
                    generatePortrait: { type: 'boolean', default: true },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Personnage créé' }, '202': { description: 'Job créé' } },
        },
      },
      '/images': {
        get: {
          tags: ['Images & Audio'],
          summary: 'Lister les images générées ou importées',
          responses: { '200': { description: 'Liste des images' } },
        },
      },
      '/images/import': {
        post: {
          tags: ['Images & Audio'],
          summary: 'Importer une image (base64 ou sourceUrl) depuis une app externe',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    base64: { type: 'string' },
                    sourceUrl: { type: 'string', format: 'uri' },
                    prompt: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Image enregistrée' } },
        },
      },
      '/images/generate': {
        post: {
          tags: ['Images & Audio'],
          summary: 'Générer une image via HAROU AILLEURS 4.6 (ComfyUI / SD / FLUX)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['prompt'],
                  properties: {
                    projectId: { type: 'string' },
                    prompt: { type: 'string' },
                    width: { type: 'integer', default: 1280 },
                    height: { type: 'integer', default: 720 },
                    provider: { type: 'string', default: 'auto' },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Image générée' }, '202': { description: 'Job créé' } },
        },
      },
      '/audio': {
        get: {
          tags: ['Images & Audio'],
          summary: 'Lister les pistes audio WAV',
          responses: { '200': { description: 'Liste des fichiers audio' } },
        },
      },
      '/audio/generate': {
        post: {
          tags: ['Images & Audio'],
          summary: 'Générer une voix ou un dialogue WAV (Piper / eSpeak-NG / Gemini TTS)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    text: { type: 'string' },
                    voiceName: { type: 'string' },
                    language: { type: 'string', default: 'fr' },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Audio généré' }, '202': { description: 'Job créé' } },
        },
      },
      '/videos': {
        get: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Lister les séquences vidéo MP4',
          responses: { '200': { description: 'Liste des séquences vidéo' } },
        },
      },
      '/videos/generate': {
        post: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Générer une séquence vidéo MP4 animée par FFmpeg (HAROU UNIX 5.8)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    projectId: { type: 'string' },
                    imageAssetId: { type: 'string' },
                    audioAssetId: { type: 'string' },
                    prompt: { type: 'string' },
                    durationSec: { type: 'number', default: 5 },
                    motion: {
                      type: 'string',
                      enum: ['ken_burns_in', 'ken_burns_out', 'pan_left', 'pan_right', 'tilt_up', 'static_hold'],
                    },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Séquence MP4 générée' }, '202': { description: 'Job créé' } },
        },
      },
      '/assemblies': {
        get: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Lister les montages assemblés',
          responses: { '200': { description: 'Liste des assemblages' } },
        },
      },
      '/assemblies/create': {
        post: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Assembler plusieurs séquences vidéo avec transitions xfade (HAROU UNIX 5.8)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sequenceAssetIds'],
                  properties: {
                    projectId: { type: 'string' },
                    sequenceAssetIds: { type: 'array', items: { type: 'string' } },
                    transition: { type: 'string', default: 'fade' },
                    transitionDurationSec: { type: 'number', default: 0.6 },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Assemblage MP4 généré' }, '202': { description: 'Job créé' } },
        },
      },
      '/exports': {
        get: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Lister les exports MP4 finaux',
          responses: { '200': { description: 'Liste des exports MP4' } },
        },
      },
      '/exports/mp4': {
        post: {
          tags: ['Vidéo & Montage MP4'],
          summary: 'Exporter un montage final en MP4 (1080p, 720p, vertical_9_16, square_1_1)',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sourceAssetId'],
                  properties: {
                    projectId: { type: 'string' },
                    sourceAssetId: { type: 'string' },
                    profile: { type: 'string', default: '720p' },
                    sync: { type: 'boolean' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Export MP4 généré' }, '202': { description: 'Job créé' } },
        },
      },
      '/projects': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Lister les projets de production',
          responses: { '200': { description: 'Liste des projets' } },
        },
        post: {
          tags: ['Projets & Tâches'],
          summary: 'Créer un projet de production',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    prompt: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { '201': { description: 'Projet créé' } },
        },
      },
      '/projects/{id}': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Récupérer un projet complet (scénario, personnages, médias, tâches)',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            '200': { description: 'Détail complet du projet' },
            '404': { description: 'Projet introuvable' },
          },
        },
      },
      '/memory/{projectId}': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Lire la mémoire de cohérence HAROU TIC-TAC 3.7 d’un projet',
          parameters: [{ name: 'projectId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Mémoire partagée du projet' } },
        },
      },
      '/jobs': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Lister la file des tâches avec filtrage par statut, type ou projet',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'type', in: 'query', schema: { type: 'string' } },
            { name: 'projectId', in: 'query', schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'Liste des tâches' } },
        },
      },
      '/jobs/{id}': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Consulter la progression et les logs d’une tâche',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Détail de la tâche' } },
        },
      },
      '/jobs/{id}/cancel': {
        post: {
          tags: ['Projets & Tâches'],
          summary: 'Annuler une tâche en cours ou en file',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Tâche annulée' } },
        },
      },
      '/events': {
        get: {
          tags: ['Projets & Tâches'],
          summary: 'Flux Server-Sent Events (SSE) temps réel des logs et progressions',
          parameters: [{ name: 'jobId', in: 'query', schema: { type: 'string' } }],
          responses: { '200': { description: 'Flux text/event-stream' } },
        },
      },
      '/keys': {
        get: {
          tags: ['Sécurité & Médias'],
          summary: 'Lister les clés API (préfixes et compteurs uniquement, jamais les secrets)',
          responses: { '200': { description: 'Liste des clés' } },
        },
        post: {
          tags: ['Sécurité & Médias'],
          summary: 'Créer une nouvelle clé API client (affichée une seule fois)',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
          responses: { '201': { description: 'Clé créée' } },
        },
      },
      '/keys/{id}': {
        delete: {
          tags: ['Sécurité & Médias'],
          summary: 'Révoquer une clé API',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Clé révoquée' } },
        },
      },
      '/media/sign': {
        post: {
          tags: ['Sécurité & Médias'],
          summary: 'Signer temporairement une URL média pour lecture directe (<video>/<img>) depuis Lovable',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['category', 'filename'],
                  properties: {
                    category: {
                      type: 'string',
                      enum: ['images', 'audio', 'sequences', 'assemblies', 'exports'],
                    },
                    filename: { type: 'string' },
                    ttlSec: { type: 'integer', default: 3600, minimum: 60, maximum: 86400 },
                  },
                },
              },
            },
          },
          responses: { '200': { description: 'URL signée temporairement sans exposer la clé API' } },
        },
      },
      '/media/{category}/{filename}': {
        get: {
          tags: ['Sécurité & Médias'],
          summary: 'Streaming média avec support HTTP Range (MP4, WAV, JPG, PNG)',
          parameters: [
            { name: 'category', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'filename', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'download', in: 'query', schema: { type: 'string', enum: ['1'] } },
            { name: 'token', in: 'query', schema: { type: 'string' } },
          ],
          responses: {
            '200': { description: 'Flux média complet' },
            '206': { description: 'Streaming partiel HTTP Range' },
          },
        },
      },
      '/creator': {
        get: {
          tags: ['Santé & Découverte'],
          summary: 'Profil public vérifié du créateur HAROU CEE',
          responses: { '200': { description: 'Informations publiques du créateur' } },
        },
      },
      '/creator/ask': {
        post: {
          tags: ['Santé & Découverte'],
          summary: 'Réponse factuelle sur le créateur HAROU CEE',
          responses: { '200': { description: 'Réponse structurée' } },
        },
      },
    },
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderOpenApiDocsHtml(apiBaseUrl: string): string {
  const safeBaseUrl = escapeHtml(apiBaseUrl);
  const safeRootHref = escapeHtml(rootHref(apiBaseUrl));
  const spec = buildOpenApiSpec(apiBaseUrl);
  const serializedSpec = JSON.stringify(spec).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>HAROU GENERATOR 2.0 — Documentation OpenAPI</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #0b0f17; color: #e2e8f0; line-height: 1.5; }
    .container { max-width: 1120px; margin: 0 auto; padding: 28px 20px 64px; }
    .header { display: flex; flex-wrap: wrap; gap: 16px; justify-content: space-between; align-items: flex-end; padding-bottom: 20px; border-bottom: 1px solid #1e293b; }
    h1 { margin: 0; font-size: 22px; font-weight: 600; color: #f8fafc; }
    .sub { margin: 6px 0 0; font-size: 13px; color: #94a3b8; max-width: 720px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .btn { display: inline-flex; align-items: center; padding: 8px 14px; font-size: 12px; font-weight: 500; border-radius: 6px; border: 1px solid #334155; background: #121824; color: #e2e8f0; text-decoration: none; cursor: pointer; }
    .btn-primary { background: #2563eb; border-color: #2563eb; color: #fff; }
    .auth-bar { margin-top: 20px; padding: 16px; background: #121824; border: 1px solid #1e293b; border-radius: 8px; display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; }
    .auth-bar label { font-size: 12px; color: #94a3b8; }
    .input { background: #0b0f17; border: 1px solid #334155; color: #f1f5f9; border-radius: 6px; padding: 8px 12px; font-family: ui-monospace, monospace; font-size: 12px; min-width: 280px; }
    .meta-row { margin-top: 14px; font-size: 12px; color: #94a3b8; font-family: ui-monospace, monospace; }
    .groups { margin-top: 28px; display: flex; flex-direction: column; gap: 24px; }
    .group-title { font-size: 14px; font-weight: 600; color: #f1f5f9; margin: 0 0 10px; }
    .ep-list { display: flex; flex-direction: column; gap: 8px; }
    .ep { background: #121824; border: 1px solid #1e293b; border-radius: 8px; overflow: hidden; }
    .ep-head { width: 100%; background: none; border: 0; color: inherit; padding: 12px 16px; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; text-align: left; cursor: pointer; }
    .ep-head:hover { background: #161e2e; }
    .method { font-family: ui-monospace, monospace; font-size: 11px; font-weight: 700; min-width: 56px; }
    .GET { color: #38bdf8; }
    .POST { color: #34d399; }
    .DELETE { color: #fb7185; }
    .path { font-family: ui-monospace, monospace; font-size: 13px; color: #f8fafc; }
    .summary { font-size: 12px; color: #94a3b8; margin-left: auto; }
    .ep-body { display: none; padding: 14px 16px; border-top: 1px solid #1e293b; background: #0d121b; font-size: 12px; }
    .ep.open .ep-body { display: block; }
    textarea { width: 100%; min-height: 92px; background: #0b0f17; color: #cbd5e1; border: 1px solid #334155; border-radius: 6px; padding: 10px; font-family: ui-monospace, monospace; font-size: 12px; margin-top: 8px; }
    pre { background: #0b0f17; border: 1px solid #1e293b; border-radius: 6px; padding: 10px; font-family: ui-monospace, monospace; font-size: 11px; color: #cbd5e1; overflow-x: auto; margin-top: 10px; white-space: pre-wrap; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>HAROU GENERATOR 2.0 — Documentation OpenAPI 3.1</h1>
        <p class="sub">Référence publique interactive des endpoints de génération multimédia, orchestration des 4 moteurs et streaming MP4.</p>
      </div>
      <div class="actions">
        <a class="btn" href="${safeBaseUrl}/openapi.json" target="_blank" rel="noreferrer">Télécharger openapi.json</a>
        <a class="btn" href="${safeBaseUrl}/health" target="_blank" rel="noreferrer">Santé serveur (/health)</a>
        <a class="btn btn-primary" href="${safeRootHref}">Ouvrir la console</a>
      </div>
    </div>

    <div class="auth-bar">
      <div>
        <label for="apiKeyInput">Clé API client (<code style="color:#93c5fd">x-api-key</code>) pour tester en direct :</label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <input id="apiKeyInput" class="input" type="password" placeholder="hg_live_..." />
        <button id="saveKeyBtn" class="btn" type="button">Mémoriser (session)</button>
      </div>
    </div>
    <div class="meta-row">Base URL : <span id="baseUrlLabel">${safeBaseUrl}</span> · Auth : header x-api-key ou Authorization: Bearer &lt;clé&gt;</div>

    <div id="groups" class="groups"></div>
  </div>

  <script>
    const SPEC = ${serializedSpec};
    const keyInput = document.getElementById('apiKeyInput');
    keyInput.value = sessionStorage.getItem('harou_docs_key') || '';
    document.getElementById('saveKeyBtn').addEventListener('click', () => {
      sessionStorage.setItem('harou_docs_key', keyInput.value.trim());
    });

    const grouped = {};
    for (const [pathKey, methods] of Object.entries(SPEC.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const tag = (op.tags && op.tags[0]) || 'Général';
        if (!grouped[tag]) grouped[tag] = [];
        grouped[tag].push({ path: pathKey, method: method.toUpperCase(), op });
      }
    }

    const container = document.getElementById('groups');
    for (const [tag, items] of Object.entries(grouped)) {
      const sec = document.createElement('section');
      const h = document.createElement('h2');
      h.className = 'group-title';
      h.textContent = tag;
      sec.appendChild(h);

      const list = document.createElement('div');
      list.className = 'ep-list';

      for (const item of items) {
        const card = document.createElement('div');
        card.className = 'ep';

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'ep-head';
        head.innerHTML =
          '<span class="method ' + item.method + '">' + item.method + '</span>' +
          '<span class="path">/api/v1' + item.path + '</span>' +
          '<span class="summary">' + (item.op.summary || '') + '</span>';
        head.addEventListener('click', () => card.classList.toggle('open'));

        const body = document.createElement('div');
        body.className = 'ep-body';
        const hasBody = item.method === 'POST';
        const exampleObj = item.op.requestBody?.content?.['application/json']?.example || {};
        const needsPathParam = item.path.includes('{');

        body.innerHTML =
          (item.op.description ? '<p style="margin:0 0 8px;color:#94a3b8;">' + item.op.description + '</p>' : '') +
          (needsPathParam ? '<div style="margin-bottom:8px;"><label>Chemin concret : <input class="input path-input" value="/api/v1' + item.path + '" /></label></div>' : '') +
          (hasBody ? '<div><label>Corps JSON :</label><textarea class="body-input">' + JSON.stringify(exampleObj, null, 2) + '</textarea></div>' : '') +
          '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;">' +
            '<button type="button" class="btn btn-primary try-btn">Exécuter la requête</button>' +
            '<span class="status-out" style="font-family:monospace;color:#94a3b8;"></span>' +
          '</div>' +
          '<pre class="res-out" style="display:none;"></pre>';

        const tryBtn = body.querySelector('.try-btn');
        tryBtn.addEventListener('click', async () => {
          const statusOut = body.querySelector('.status-out');
          const resOut = body.querySelector('.res-out');
          const pathInput = body.querySelector('.path-input');
          const bodyInput = body.querySelector('.body-input');
          const targetPath = pathInput ? pathInput.value.trim() : '/api/v1' + item.path;
          const headers = { 'Content-Type': 'application/json' };
          const apiKey = keyInput.value.trim();
          if (apiKey) headers['x-api-key'] = apiKey;

          statusOut.textContent = 'Requête en cours...';
          resOut.style.display = 'block';
          try {
            const opts = { method: item.method, headers };
            if (hasBody && bodyInput) opts.body = bodyInput.value;
            const res = await fetch(targetPath, opts);
            statusOut.textContent = 'HTTP ' + res.status;
            const text = await res.text();
            try {
              resOut.textContent = JSON.stringify(JSON.parse(text), null, 2);
            } catch {
              resOut.textContent = text.slice(0, 4000);
            }
          } catch (err) {
            statusOut.textContent = 'Erreur réseau';
            resOut.textContent = String(err);
          }
        });

        card.appendChild(head);
        card.appendChild(body);
        list.appendChild(card);
      }

      sec.appendChild(list);
      container.appendChild(sec);
    }
  </script>
</body>
</html>`;
}

function rootHref(apiBaseUrl: string): string {
  const clean = apiBaseUrl.replace(/\/api\/v1\/?$/, '');
  return clean || '/';
}
