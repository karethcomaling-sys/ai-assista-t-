import type { LanguagePreference } from '../types/assistant';

const CEBUANO_MARKERS = [
  'maayong',
  'palihug',
  'palihog',
  'unsa',
  'unsay',
  'ablihi',
  'abli',
  'karon',
  'kaayo',
  'asa',
  'ngano',
  'daghang',
  'salamat kaayo',
  'pangitaa',
  'kusgan',
  'hinay',
  'buntag',
  'hapon',
  'gabii',
  'nimo',
  'ko',
];

const FILIPINO_MARKERS = [
  'kamusta',
  'kumusta',
  'maraming salamat',
  'salamat',
  'pakibukas',
  'buksan',
  'hanapin',
  'ngayon',
  'oras',
  'petsa',
  'lakasan',
  'hinaan',
  'pakiusap',
  'puwede',
  'pwede',
  'magandang',
  'umaga',
  'tanghali',
  'gabi',
  'po',
  'opo',
  'naman',
  'ito',
];

export function detectSpokenLanguage(
  text: string,
  preference: LanguagePreference
): string {
  if (preference === 'en') return 'English';
  if (preference === 'tl') return 'Filipino';
  if (preference === 'ceb') return 'Cebuano';

  const normalized = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, ' ')} `;

  let cebScore = 0;
  let tlScore = 0;

  for (const word of CEBUANO_MARKERS) {
    if (normalized.includes(` ${word} `)) {
      cebScore += word.includes(' ') ? 2 : 1;
    }
  }
  for (const word of FILIPINO_MARKERS) {
    if (normalized.includes(` ${word} `)) {
      tlScore += word.includes(' ') ? 2 : 1;
    }
  }

  if (cebScore > tlScore && cebScore > 0) return 'Cebuano';
  if (tlScore > cebScore && tlScore > 0) return 'Filipino';
  return 'English';
}
