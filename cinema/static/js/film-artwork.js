// Supplied posters, served locally. The database remains the source of film facts.
const artwork = Object.freeze({
  'Resident Evil (2026)': 'resident-evil-2026.png',
  'Tenzing': 'tenzing.png',
  'The Love Hypothesis': 'love-hypothesis.png',
  '牛来 (Niu Lai)': 'niu-lai.png',
  'The Shawshank Redemption': 'shawshank-redemption.png',
  "Interstellar": "interstellar.jpg",
  "Inception": "inception.jpg",
  "Zootopia": "zootopia.jpg",
  "Spirited Away": "spirited-away.png",
  "Harry Potter and the Philosopher's Stone": "harry-potter.jpg",
});

export function filmArtwork(film) {
  const filename = Object.hasOwn(artwork, film.title) ? artwork[film.title] : null;
  return filename ? `/static/assets/${filename}` : null;
}
