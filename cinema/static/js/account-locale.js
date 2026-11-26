import { tx } from "./locale.js";
import { districtLabel, venueName } from "./venue-locale.js";

const seedDistricts = ["Chaoyang", "Haidian", "Dongcheng"];
const importedManagers = new Map([
  ["manager.poly-canyon@cinema.test", "保利国际影城(凯德大峡谷店)"],
  ["manager.zhonghua@cinema.test", "中华电影院"],
  ["manager.hengdian-wangfujing@cinema.test", "北京横店影城(王府井百货店)"],
  ["manager.capital-xidan@cinema.test", "首都电影院(西单店)"],
  ["manager.emperor-centre@cinema.test", "英皇电影城(北京英皇中心店)"],
  ["manager.geological-hall@cinema.test", "北京地质礼堂"],
]);

// These labels belong to fixture accounts. A real customer's chosen name is literal text.
export function accountName(name, identity) {
  const email = identity?.email_normalized;
  if (name === "Platform Admin" && email === "admin@cinema.test") return tx(name, "平台管理员");
  if (name === "Demo Customer" && (email === "customer@cinema.test" || identity?.is_demo_customer))
    return tx(name, "演示顾客");
  if (name === "Second Customer" && (email === "customer2@cinema.test" || identity?.is_demo_customer))
    return tx(name, "第二位顾客");

  const staff = /^(manager|staff)([1-3])@cinema\.test$/.exec(email);
  if (staff) {
    const district = seedDistricts[Number(staff[2]) - 1];
    const manager = staff[1] === "manager";
    if (name === district + (manager ? " Manager" : " Staff")) {
      return tx(name, districtLabel({ name: district }) + (manager ? "店长" : "员工"));
    }
  }
  const venue = importedManagers.get(email);
  if (venue && name === venue + " 演示店长") {
    return tx(venueName(venue) + " Demo Manager", name);
  }
  return name;
}
