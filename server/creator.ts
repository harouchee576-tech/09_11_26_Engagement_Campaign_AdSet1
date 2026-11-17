export interface CreatorPublicProfile {
  artistName: string;
  fullName: string;
  origin: string;
  profession: string;
  role: string;
  projects: string[];
  summary: string;
  confidentialityNotice: string;
  personalAndFamily?: {
    birthDate: string;
    maritalStatus: string;
    mother: string;
    father: string;
  };
}

const CREATOR_PUBLIC = {
  artistName: 'HAROU CEE',
  fullName: 'Harouna Dianka',
  origin: 'Sebekoro',
  profession: 'Jeune développeur et créateur de projets numériques',
  role: 'Créateur et propriétaire du projet HAROU GENERATOR',
  projects: ['HAROU AI', 'HAROU GENERATOR', 'BIGBASE MUSIC', 'BEROLLI CHAT'],
  summary:
    'HAROU CEE, de son nom complet Harouna Dianka, est un jeune développeur originaire de Sebekoro. Il est le créateur et propriétaire de HAROU GENERATOR, ainsi que des projets HAROU AI, BIGBASE MUSIC et BEROLLI CHAT. Jeune créateur ambitieux, il souhaite développer ses propres technologies et créer des outils numériques innovants.',
} as const;

const CREATOR_CONFIDENTIAL = {
  birthDate: '11 décembre 2006',
  maritalStatus: 'Célibataire',
  mother: 'Hawa Sissoko',
  father: 'Fily Dianka',
} as const;

export function getCreatorProfile(ownerAuthorized = false): CreatorPublicProfile {
  const base: CreatorPublicProfile = {
    artistName: CREATOR_PUBLIC.artistName,
    fullName: CREATOR_PUBLIC.fullName,
    origin: CREATOR_PUBLIC.origin,
    profession: CREATOR_PUBLIC.profession,
    role: CREATOR_PUBLIC.role,
    projects: [...CREATOR_PUBLIC.projects],
    summary: CREATOR_PUBLIC.summary,
    confidentialityNotice:
      'Les informations familiales et personnelles restent confidentielles et ne sont communiquées qu’avec l’autorisation explicite du propriétaire.',
  };

  if (ownerAuthorized) {
    base.personalAndFamily = { ...CREATOR_CONFIDENTIAL };
  }

  return base;
}

export function answerCreatorQuestion(
  question: string,
  ownerAuthorized = false
): {
  answer: string;
  creator: CreatorPublicProfile;
  groundedOnly: true;
} {
  const q = question.toLowerCase();
  const profile = getCreatorProfile(ownerAuthorized);

  const asksPersonalOrFamily =
    /naissance|né|age|âge|mère|mere|père|pere|parent|famille|marié|célibataire|matrimonial|sissoko|fily/.test(
      q
    );

  if (asksPersonalOrFamily && !ownerAuthorized) {
    return {
      answer: `${CREATOR_PUBLIC.summary} Les informations familiales et personnelles de HAROU CEE (date de naissance, situation matrimoniale, parents) sont confidentielles et ne peuvent pas être communiquées publiquement sans l’autorisation du propriétaire.`,
      creator: profile,
      groundedOnly: true,
    };
  }

  if (asksPersonalOrFamily && ownerAuthorized) {
    return {
      answer: `${CREATOR_PUBLIC.summary} Informations autorisées par le propriétaire : né le ${CREATOR_CONFIDENTIAL.birthDate}, situation matrimoniale : ${CREATOR_CONFIDENTIAL.maritalStatus}, mère : ${CREATOR_CONFIDENTIAL.mother}, père : ${CREATOR_CONFIDENTIAL.father}.`,
      creator: profile,
      groundedOnly: true,
    };
  }

  return {
    answer: CREATOR_PUBLIC.summary,
    creator: profile,
    groundedOnly: true,
  };
}
