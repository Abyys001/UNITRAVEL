/**
 * Iranian cities offered by the train and bus request forms. This is reference data, not availability: a listed city does
 * not mean a direct service or a free seat, and staff confirm every route on the quote (rule 2). Sources and exclusions:
 * docs/reference-data.md, "Train and bus cities".
 */
export type GroundMode = "TRAIN" | "BUS"
export interface GroundCity { id: string; en: string; fa: string }

const c = (id: string, en: string, fa: string): GroundCity => ({ id, en, fa })

const POPULAR_TRAIN = [
  c("tehran", "Tehran", "تهران"), c("mashhad", "Mashhad", "مشهد"), c("isfahan", "Isfahan", "اصفهان"), c("shiraz", "Shiraz", "شیراز"), c("yazd", "Yazd", "یزد"),
  c("tabriz", "Tabriz", "تبریز"), c("bandar-abbas", "Bandar Abbas", "بندرعباس"), c("ahvaz", "Ahvaz", "اهواز"), c("qom", "Qom", "قم"), c("kerman", "Kerman", "کرمان"),
]

const OTHER_TRAIN = [
  c("abadeh", "Abadeh", "آباده"), c("andimeshk", "Andimeshk", "اندیمشک"), c("arak", "Arak", "اراک"), c("ardakan", "Ardakan", "اردکان"), c("bafq", "Bafq", "بافق"),
  c("bam", "Bam", "بم"), c("mahshahr", "Bandar-e Mahshahr", "بندر ماهشهر"), c("bostanabad", "Bostanabad", "بستان‌آباد"), c("damghan", "Damghan", "دامغان"), c("dorud", "Dorud", "دورود"),
  c("eqlid", "Eqlid", "اقلید"), c("firuzkuh", "Firuzkuh", "فیروزکوه"), c("garmsar", "Garmsar", "گرمسار"), c("gorgan", "Gorgan", "گرگان"), c("hamedan", "Hamedan", "همدان"),
  c("jolfa", "Jolfa", "جلفا"), c("karaj", "Karaj", "کرج"), c("kashan", "Kashan", "کاشان"), c("kermanshah", "Kermanshah", "کرمانشاه"), c("khaf", "Khaf", "خواف"),
  c("khorramshahr", "Khorramshahr", "خرمشهر"), c("mahabad", "Mahabad", "مهاباد"), c("malayer", "Malayer", "ملایر"), c("maragheh", "Maragheh", "مراغه"), c("meybod", "Meybod", "میبد"),
  c("mianeh", "Mianeh", "میانه"), c("neyshabur", "Neyshabur", "نیشابور"), c("pol-e-sefid", "Pol-e Sefid", "پل سفید"), c("qaem-shahr", "Qaem Shahr", "قائمشهر"), c("qazvin", "Qazvin", "قزوین"),
  c("rasht", "Rasht", "رشت"), c("sabzevar", "Sabzevar", "سبزوار"), c("salmas", "Salmas", "سلماس"), c("sarakhs", "Sarakhs", "سرخس"), c("sari", "Sari", "ساری"),
  c("semnan", "Semnan", "سمنان"), c("shahreza", "Shahreza", "شهرضا"), c("shahrud", "Shahrud", "شاهرود"), c("shushtar", "Shushtar", "شوشتر"), c("sirjan", "Sirjan", "سیرجان"),
  c("tabas", "Tabas", "طبس"), c("torbat-e-heydarieh", "Torbat-e Heydarieh", "تربت حیدریه"), c("urmia", "Urmia", "ارومیه"), c("zahedan", "Zahedan", "زاهدان"), c("zanjan", "Zanjan", "زنجان"),
  c("zarand", "Zarand", "زرند"),
]

const POPULAR_BUS = [
  c("tehran", "Tehran", "تهران"), c("mashhad", "Mashhad", "مشهد"), c("isfahan", "Isfahan", "اصفهان"), c("shiraz", "Shiraz", "شیراز"), c("tabriz", "Tabriz", "تبریز"),
  c("yazd", "Yazd", "یزد"), c("ahvaz", "Ahvaz", "اهواز"), c("kermanshah", "Kermanshah", "کرمانشاه"), c("bandar-abbas", "Bandar Abbas", "بندرعباس"), c("hamedan", "Hamedan", "همدان"),
]

const OTHER_BUS = [
  c("arak", "Arak", "اراک"), c("ardabil", "Ardabil", "اردبیل"), c("baneh", "Baneh", "بانه"), c("birjand", "Birjand", "بیرجند"), c("bojnord", "Bojnord", "بجنورد"),
  c("bushehr", "Bushehr", "بوشهر"), c("gorgan", "Gorgan", "گرگان"), c("ilam", "Ilam", "ایلام"), c("karaj", "Karaj", "کرج"), c("kerman", "Kerman", "کرمان"),
  c("khorramabad", "Khorramabad", "خرم‌آباد"), c("mehran", "Mehran", "مهران"), c("qazvin", "Qazvin", "قزوین"), c("qom", "Qom", "قم"), c("ramsar", "Ramsar", "رامسر"),
  c("rasht", "Rasht", "رشت"), c("sanandaj", "Sanandaj", "سنندج"), c("sari", "Sari", "ساری"), c("semnan", "Semnan", "سمنان"), c("shahrekord", "Shahrekord", "شهرکرد"),
  c("urmia", "Urmia", "ارومیه"), c("yasuj", "Yasuj", "یاسوج"), c("zahedan", "Zahedan", "زاهدان"), c("zanjan", "Zanjan", "زنجان"),
]

export const GROUND_CITIES: Record<GroundMode, { popular: readonly GroundCity[]; other: readonly GroundCity[] }> = {
  TRAIN: { popular: POPULAR_TRAIN, other: OTHER_TRAIN },
  BUS: { popular: POPULAR_BUS, other: OTHER_BUS },
}
