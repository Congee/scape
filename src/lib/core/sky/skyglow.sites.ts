/** Published clear, moonless zenith brightness measurements used to calibrate SKYGLOW_PARAMS. Points and values only. */

export const SiteKind = { City: 'city', Suburb: 'suburb', Rural: 'rural', Pristine: 'pristine' } as const;
export type SiteKind = (typeof SiteKind)[keyof typeof SiteKind];

export interface SqmSite {
  name: string;
  lat: number;
  lng: number;
  elevM: number;
  kind: SiteKind;
  /** mag/arcsec². */
  sqm: number;
  source: string;
}

const POSCH = 'Posch, Binder & Puschnig 2018, JQSRT 211:144 (arXiv:1803.09811), Table 2';
const PUN = 'Pun & So 2012, Environ. Monit. Assess. 184:2537 (arXiv:1106.3842)';

export const SQM_SITES: readonly SqmSite[] = [
  { name: 'Hong Kong, Mong Kok', lat: 22.319, lng: 114.17, elevM: 10, kind: SiteKind.City, sqm: 16.0, source: PUN },
  { name: 'Zagreb centre', lat: 45.808, lng: 15.977, elevM: 150, kind: SiteKind.City, sqm: 18.2, source: 'Andreić et al. 2018 (arXiv:1803.00299)' },
  { name: 'Vienna University Observatory', lat: 48.2317, lng: 16.3342, elevM: 231, kind: SiteKind.City, sqm: 19.1, source: 'Puschnig, Posch & Uttenthaler 2014, JQSRT 139:64' },
  { name: 'Madrid centre', lat: 40.4168, lng: -3.7038, elevM: 650, kind: SiteKind.City, sqm: 18.5, source: 'Sánchez de Miguel et al. 2015' },
  { name: 'Linz Goethestraße', lat: 48.3053, lng: 14.3083, elevM: 259, kind: SiteKind.City, sqm: 18.6, source: 'Posch, Binder & Puschnig 2018, JQSRT 211:144 (arXiv:1803.09811), Fig. 3' },
  { name: 'Potsdam-Babelsberg', lat: 52.3833, lng: 13.0942, elevM: 40, kind: SiteKind.Suburb, sqm: 20.3, source: 'Puschnig, Schwope, Posch & Schwarz 2014, JQSRT 139:76' },
  { name: 'Braunau', lat: 48.2611, lng: 13.0447, elevM: 351, kind: SiteKind.Suburb, sqm: 20.2, source: POSCH },
  { name: 'Grieskirchen', lat: 48.2344, lng: 13.8258, elevM: 336, kind: SiteKind.Suburb, sqm: 20.2, source: POSCH },
  { name: 'Freistadt', lat: 48.5092, lng: 14.5019, elevM: 512, kind: SiteKind.Suburb, sqm: 20.2, source: POSCH },
  { name: 'Pasching', lat: 48.2586, lng: 14.21, elevM: 292, kind: SiteKind.Suburb, sqm: 20.1, source: POSCH },
  { name: 'Vöcklabruck', lat: 48.0058, lng: 13.6453, elevM: 434, kind: SiteKind.Suburb, sqm: 20.4, source: POSCH },
  { name: 'High Island Reservoir, Sai Kung', lat: 22.353, lng: 114.359, elevM: 10, kind: SiteKind.Rural, sqm: 20.8, source: PUN },
  { name: 'Bodinggraben', lat: 47.7919, lng: 14.3939, elevM: 641, kind: SiteKind.Rural, sqm: 21.8, source: POSCH },
  { name: 'Zöblboden', lat: 47.8383, lng: 14.4411, elevM: 899, kind: SiteKind.Rural, sqm: 21.9, source: POSCH },
  { name: 'Krippenstein', lat: 47.5231, lng: 13.6933, elevM: 2067, kind: SiteKind.Rural, sqm: 21.9, source: POSCH },
  { name: 'Grünbach', lat: 48.5306, lng: 14.575, elevM: 918, kind: SiteKind.Rural, sqm: 21.6, source: POSCH },
  { name: 'Lake Stechlin', lat: 53.164, lng: 13.027, elevM: 60, kind: SiteKind.Rural, sqm: 21.6, source: 'Jechow, Kyba et al. 2016 (arXiv:1602.04537)' },
  { name: 'Zselic Starry Sky Park', lat: 46.267, lng: 17.783, elevM: 300, kind: SiteKind.Rural, sqm: 21.3, source: 'Kolláth 2010, J. Phys.: Conf. Ser. 218:012001' },
  { name: 'NamibRand, Keerweder', lat: -25.02, lng: 16.02, elevM: 1200, kind: SiteKind.Pristine, sqm: 21.6, source: 'NamibRand IDA Dark Sky Reserve Annual Report 2016' },
  { name: 'Mt John, Aoraki Mackenzie', lat: -43.9866, lng: 170.465, elevM: 1029, kind: SiteKind.Pristine, sqm: 21.5, source: 'Aoraki Mackenzie IDSR Annual Report 2016' },
  { name: 'Roque de los Muchachos', lat: 28.7606, lng: -17.8792, elevM: 2396, kind: SiteKind.Pristine, sqm: 21.66, source: 'Alarcón et al. 2021, AJ 162:25, Table 1' },
  { name: 'Cerro Paranal', lat: -24.6272, lng: -70.4039, elevM: 2635, kind: SiteKind.Pristine, sqm: 21.61, source: 'Patat 2003, A&A 400:1183, Table 1' },
  { name: 'Mauna Kea', lat: 19.8207, lng: -155.4681, elevM: 4205, kind: SiteKind.Pristine, sqm: 21.6, source: 'Krisciunas 1997, PASP 109:1181' }
];
