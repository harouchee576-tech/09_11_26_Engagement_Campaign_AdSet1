import { GoogleGenAI, Type } from '@google/genai';
import type { MotionPreset, ScenarioScene } from '../types.ts';

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY manquante sur le serveur. Configurez-la dans Settings > Secrets ou utilisez un provider open-source local (Ollama).'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export async function generateScenarioWithGemini(params: {
  prompt: string;
  genre?: string;
  tone?: string;
  visualStyle?: string;
  sceneCount?: number;
  language?: string;
}): Promise<{
  title: string;
  logline: string;
  genre: string;
  tone: string;
  visualStyle: string;
  scenes: ScenarioScene[];
}> {
  const ai = getClient();
  const count = Math.max(2, Math.min(8, params.sceneCount || 4));
  const language = params.language || 'fr';

  const systemInstruction = [
    'Tu es un scénariste et réalisateur expert travaillant pour le moteur HAROU GENERATOR.',
    `Génère un scénario structuré en exactement ${count} scènes prêtes pour une production multimédia automatisée.`,
    `Langue des titres, logline et dialogues/voix off : ${language}.`,
    'Les champs visualPrompt doivent être en anglais très détaillés et cinématographiques (sujet, décor, éclairage, cadrage, texture) pour obtenir des images de haute qualité avec des modèles open-source (FLUX/SDXL).',
    'Choisis cameraMovement uniquement parmi: ken_burns_in, ken_burns_out, pan_left, pan_right, tilt_up, static_hold.',
  ].join('\n');

  const userPrompt = [
    `Concept principal : ${params.prompt}`,
    params.genre ? `Genre souhaité : ${params.genre}` : '',
    params.tone ? `Ton : ${params.tone}` : '',
    params.visualStyle ? `Style visuel : ${params.visualStyle}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: userPrompt,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          logline: { type: Type.STRING },
          genre: { type: Type.STRING },
          tone: { type: Type.STRING },
          visualStyle: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                sceneNumber: { type: Type.INTEGER },
                title: { type: Type.STRING },
                location: { type: Type.STRING },
                timeOfDay: { type: Type.STRING },
                visualPrompt: { type: Type.STRING },
                cameraMovement: { type: Type.STRING },
                narrationOrDialogue: { type: Type.STRING },
                speaker: { type: Type.STRING },
                durationSec: { type: Type.NUMBER },
                characterNames: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
              },
              required: [
                'sceneNumber',
                'title',
                'location',
                'timeOfDay',
                'visualPrompt',
                'cameraMovement',
                'narrationOrDialogue',
                'speaker',
                'durationSec',
                'characterNames',
              ],
            },
          },
        },
        required: ['title', 'logline', 'genre', 'tone', 'visualStyle', 'scenes'],
      },
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as {
    title: string;
    logline: string;
    genre: string;
    tone: string;
    visualStyle: string;
    scenes: ScenarioScene[];
  };

  const validMotions: MotionPreset[] = [
    'ken_burns_in',
    'ken_burns_out',
    'pan_left',
    'pan_right',
    'tilt_up',
    'static_hold',
  ];

  parsed.scenes = (parsed.scenes || []).map((s, idx) => ({
    ...s,
    sceneNumber: s.sceneNumber || idx + 1,
    durationSec: Math.max(4, Math.min(18, Math.round(Number(s.durationSec) || 6))),
    cameraMovement: validMotions.includes(s.cameraMovement) ? s.cameraMovement : 'ken_burns_in',
    characterNames: Array.isArray(s.characterNames) ? s.characterNames : [],
  }));

  return parsed;
}

export async function generateCharacterWithGemini(params: {
  name?: string;
  concept: string;
  role?: string;
  visualStyle?: string;
  language?: string;
}): Promise<{
  name: string;
  role: string;
  age: string;
  physicalDescription: string;
  wardrobe: string;
  personality: string;
  voiceStyle: string;
  recommendedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
  visualPromptAnchor: string;
}> {
  const ai = getClient();
  const language = params.language || 'fr';

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [
      `Concept du personnage : ${params.concept}`,
      params.name ? `Nom imposé : ${params.name}` : '',
      params.role ? `Rôle : ${params.role}` : '',
      params.visualStyle ? `Style visuel : ${params.visualStyle}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    config: {
      systemInstruction: [
        'Tu crées une fiche personnage complète et cohérente pour la production audiovisuelle HAROU GENERATOR.',
        `Rédige les descriptions en ${language}.`,
        'Le champ visualPromptAnchor doit être en anglais précis pour générer un portrait cohérent sur FLUX/SDXL (sans texte ni watermark).',
        'Choisis recommendedVoice uniquement parmi: Puck, Charon, Kore, Fenrir, Zephyr.',
      ].join('\n'),
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          role: { type: Type.STRING },
          age: { type: Type.STRING },
          physicalDescription: { type: Type.STRING },
          wardrobe: { type: Type.STRING },
          personality: { type: Type.STRING },
          voiceStyle: { type: Type.STRING },
          recommendedVoice: { type: Type.STRING },
          visualPromptAnchor: { type: Type.STRING },
        },
        required: [
          'name',
          'role',
          'age',
          'physicalDescription',
          'wardrobe',
          'personality',
          'voiceStyle',
          'recommendedVoice',
          'visualPromptAnchor',
        ],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim()) as {
    name: string;
    role: string;
    age: string;
    physicalDescription: string;
    wardrobe: string;
    personality: string;
    voiceStyle: string;
    recommendedVoice: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Zephyr';
    visualPromptAnchor: string;
  };

  const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'] as const;
  if (!allowedVoices.includes(parsed.recommendedVoice)) {
    parsed.recommendedVoice = 'Kore';
  }
  return parsed;
}

export async function generateSpeechWithGemini(params: {
  text: string;
  voiceName?: string;
  style?: string;
  mode?: 'single' | 'dialogue';
  speakers?: Array<{ speaker: string; voiceName: string; style?: string; text: string }>;
}): Promise<Buffer> {
  const ai = getClient();
  const allowedVoices = ['Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'];

  if (params.mode === 'dialogue' && params.speakers && params.speakers.length === 2) {
    const [s1, s2] = params.speakers;
    const v1 = allowedVoices.includes(s1.voiceName) ? s1.voiceName : 'Puck';
    const v2 = allowedVoices.includes(s2.voiceName) ? s2.voiceName : 'Kore';

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash-tts',
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `${s1.speaker}: ${s1.text}`,
              speechMetadata: {
                speaker: s1.speaker,
                style: s1.style || 'Natural expressive cinema voice',
              },
            } as Record<string, unknown>,
            {
              text: `${s2.speaker}: ${s2.text}`,
              speechMetadata: {
                speaker: s2.speaker,
                style: s2.style || 'Natural expressive cinema voice',
              },
            } as Record<string, unknown>,
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: [
              {
                speaker: s1.speaker,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: v1 } },
              },
              {
                speaker: s2.speaker,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: v2 } },
              },
            ],
          },
        },
      },
    });

    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!base64Audio) {
      throw new Error('Gemini TTS dialogue n’a retourné aucune donnée audio.');
    }
    return Buffer.from(base64Audio, 'base64');
  }

  const voice = allowedVoices.includes(params.voiceName || '') ? (params.voiceName as string) : 'Kore';
  const response = await ai.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: params.text,
            ...(params.style
              ? {
                  speechMetadata: {
                    style: params.style,
                  },
                }
              : {}),
          } as Record<string, unknown>,
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error('Gemini TTS n’a retourné aucune donnée audio.');
  }
  return Buffer.from(base64Audio, 'base64');
}
