import { tx } from "./locale.js";

export const ratingWords = ["Not for me", "Could be better", "Worth a watch", "Really good", "A must-see"];
const ratingWord = i => tx(ratingWords[i], ["不合我意", "有待改进", "值得一看", "很喜欢", "不容错过"][i]);

export function stars(score, extraClass = "") {
  const value = Math.max(0, Math.min(10, Number(score) || 0));
  return `<span class="review-stars ${extraClass}" role="img" aria-label="${tx(`${value / 2} out of 5 stars`, `满分 5 星，获评 ${value / 2} 星`)}">${[1, 2, 3, 4, 5].map(n => `<span aria-hidden="true" style="--fill:${Math.max(0, Math.min(100, (value / 2 - n + 1) * 100))}%">★</span>`).join("")}</span>`;
}

export function starPicker(score = 0) {
  return `<fieldset class="star-picker"><legend>${tx("Your rating", "我的评分")}</legend><input type="hidden" name="stars" value="${Number(score) || 0}"><div class="star-picker-row">${[1, 2, 3, 4, 5].map(n => `<label title="${n} ${tx(n === 1 ? "star" : "stars", "星")} · ${ratingWord(n - 1)}"><input type="radio" name="star-choice" value="${n * 2}" aria-label="${n} ${tx(n === 1 ? "star" : "stars", "星")}" ${Number(score) === n * 2 ? "checked" : ""}><span aria-hidden="true">★</span></label>`).join("")}</div><output class="star-caption" aria-live="polite"></output></fieldset>`;
}

export function bindStars(form) {
  const picker = form.querySelector(".star-picker");
  const saved = picker.querySelector('[name="stars"]');
  const choices = [...picker.querySelectorAll("label")];
  function paint(score) {
    choices.forEach((label, i) => label.style.setProperty("--fill", `${Math.max(0, Math.min(100, (score / 2 - i) * 100))}%`));
    picker.querySelector("output").textContent = score ? `${score / 2} / 5 · ${ratingWord(Math.ceil(score / 2) - 1)}` : tx("Select a star to rate this film", "选择星级，为这部电影打分");
  }
  choices.forEach(label => {
    const radio = label.querySelector("input");
    label.onmouseenter = () => paint(Number(radio.value));
    radio.onfocus = () => paint(Number(radio.value));
    radio.onchange = () => { saved.value = radio.value; paint(Number(saved.value)); };
    radio.onblur = () => paint(Number(saved.value));
  });
  picker.onmouseleave = () => paint(Number(saved.value));
  paint(Number(saved.value));
}
