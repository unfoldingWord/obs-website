// Continent of each country, as UN M49 region codes. Intl.DisplayNames
// names these in any locale ('150' -> "Europe", "Europe" in French, "欧洲"), so the
// printed Discover list can say where a widely spoken language is used
// without a translation table. Grouping follows the UN M49 continents
// (Western Asia, including Cyprus and Turkey, is Asia '142').
export type ContinentCode = '002' | '019' | '142' | '150' | '009';

const CONTINENT_OF: Record<string, ContinentCode> = {
  ...Object.fromEntries('DZ AO BJ BW BF BI CV CM CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA MZ NA NE NG RE RW SH ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW IO TF'.split(' ').map((cc): [string, ContinentCode] => [cc, '002'])),
  ...Object.fromEntries('AI AG AR AW BS BB BZ BM BO BQ BR VG CA KY CL CO CR CU CW DM DO EC SV FK GF GL GD GP GT GY HT HN JM MQ MX MS NI PA PY PE PR BL KN LC MF PM VC SX SR TT TC US UM VI UY VE GS BV'.split(' ').map((cc): [string, ContinentCode] => [cc, '019'])),
  ...Object.fromEntries('AF AM AZ BH BD BT BN KH CN CY GE HK IN ID IR IQ IL JP JO KZ KW KG LA LB MO MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK SY TW TJ TH TL TR TM AE UZ VN YE'.split(' ').map((cc): [string, ContinentCode] => [cc, '142'])),
  ...Object.fromEntries('AX AL AD AT BY BE BA BG HR CZ DK EE FO FI FR DE GI GR GG VA HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SJ SE CH UA GB'.split(' ').map((cc): [string, ContinentCode] => [cc, '150'])),
  ...Object.fromEntries('AS AU CX CC CK FJ PF GU HM KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF'.split(' ').map((cc): [string, ContinentCode] => [cc, '009'])),
};

export function continentOf(countryCode: string): ContinentCode | null {
  return CONTINENT_OF[countryCode.toUpperCase()] ?? null;
}

/** The catalog's own region labels (translationDatabase `lr`) as M49 codes. */
const REGION_CODE: Record<string, ContinentCode> = {
  Africa: '002',
  Americas: '019',
  Asia: '142',
  Europe: '150',
  Pacific: '009',
};

export function regionCode(region: string | null | undefined): ContinentCode | null {
  return (region && REGION_CODE[region]) || null;
}
