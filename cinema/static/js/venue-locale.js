import translations from "../assets/cinema-translations.json" with { type: "json" };
import { getLanguage, tx } from "./locale.js";

const districts = {
  Dongcheng: "东城区", Xicheng: "西城区", Chaoyang: "朝阳区", Fengtai: "丰台区",
  Shijingshan: "石景山区", Haidian: "海淀区", Mentougou: "门头沟区", Fangshan: "房山区",
  Tongzhou: "通州区", Shunyi: "顺义区", Changping: "昌平区", Daxing: "大兴区",
  Huairou: "怀柔区", Pinggu: "平谷区", Miyun: "密云区", Yanqing: "延庆区",
};
const districtCodes = {
  110101: "Dongcheng", 110102: "Xicheng", 110105: "Chaoyang", 110106: "Fengtai",
  110107: "Shijingshan", 110108: "Haidian", 110109: "Mentougou", 110111: "Fangshan",
  110112: "Tongzhou", 110113: "Shunyi", 110114: "Changping", 110115: "Daxing",
  110116: "Huairou", 110117: "Pinggu", 110118: "Miyun", 110119: "Yanqing",
};
const brands = {
  "万达影城": "Wanda Cinema", "保利国际影城": "Poly International Cinema", "横店影城": "Hengdian Cinema",
  "中华电影院": "Zhonghua Cinema", "北京站电影院": "Beijing Railway Station Cinema",
  "首都电影院": "Capital Cinema", "英皇电影城": "Emperor Cinemas", "地质礼堂": "Geological Hall",
};
export function districtLabel(district) {
  const name = district?.name;
  const canonical = districtCodes[district?.admin_code] ?? name;
  if (!Object.hasOwn(districts, canonical) || (name !== canonical && name !== districts[canonical])) return name;
  return tx(canonical, districts[canonical]);
}
export function venueBrand(name) {
  return tx(Object.hasOwn(brands, name) ? brands[name] : name, name);
}
export function venueName(name) {
  return translations.cinemas[name]?.names?.[getLanguage()] ?? name;
}
export function venueAddress(name, address) {
  const entry = translations.cinemas[name];
  return entry && address === entry.source_address ? entry.addresses[getLanguage()] : address;
}
export function auditoriumName(name) {
  const match = /^(Screen|Demo Screen|Catalogue Demo) (\d+)$/.exec(name);
  if (!match) return name;
  const prefix = { Screen: "", "Demo Screen": "演示", "Catalogue Demo": "片库演示" }[match[1]];
  return tx(name, `${prefix}${match[2]} 号厅`);
}
