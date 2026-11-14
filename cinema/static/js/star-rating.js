export const ratingWords = ["Not for me", "Could be better", "Worth a watch", "Really good", "A must-see"];
export function stars(score, extraClass = "") {
  const value = Math.max(0, Math.min(10, Number(score) || 0));
  return `<span class="review-stars ${extraClass}" role="img" aria-label="${value / 2} out of 5 stars">${[1, 2, 3, 4, 5].map(n => `<span aria-hidden="true" style="--fill:${Math.max(0, Math.min(100, (value / 2 - n + 1) * 100))}%">★</span>`).join("")}</span>`;
}

export function starPicker(score = 0) {
  return `<fieldset class="star-picker"><legend>Your rating</legend><input type="hidden" name="stars" value="${Number(score) || 0}"><div class="star-picker-row">${[1, 2, 3, 4, 5].map(n => `<label title="${n} stars · ${ratingWords[n - 1]}"><input type="radio" name="star-choice" value="${n * 2}" aria-label="${n} ${n === 1 ? "star" : "stars"}" ${Number(score) === n * 2 ? "checked" : ""}><span aria-hidden="true">★</span></label>`).join("")}</div><output class="star-caption" aria-live="polite"></output></fieldset>`;
}

export function bindStars(form) {
  const picker = form.querySelector(".star-picker");
  const saved = picker.querySelector('[name="stars"]');
  const choices = [...picker.querySelectorAll("label")];
  function paint(score) {
    choices.forEach((label, i) => label.style.setProperty("--fill", `${Math.max(0, Math.min(100, (score / 2 - i) * 100))}%`));
    picker.querySelector("output").textContent = score ? `${score / 2} / 5 · ${ratingWords[Math.ceil(score / 2) - 1]}` : "Select a star to rate this film";
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
