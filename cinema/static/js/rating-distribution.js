// A source score, sample size and histogram always travel together.
export function ratingSummary(data, source = "douban") {
  const snapshot = data.rating_snapshot;
  if (source === "douban" && snapshot) {
    return { source: "douban", average: Number(snapshot.score), count: snapshot.vote_count,
      distribution: snapshot.distribution.map(row => ({ stars: row.stars, percent: Number(row.percent) })),
      url: snapshot.source_url, checkedOn: snapshot.checked_on };
  }
  const votes = data.votes || [];
  const count = votes.reduce((sum, vote) => sum + vote.count, 0);
  const average = count ? votes.reduce((sum, vote) => sum + vote.stars * vote.count, 0) / count : null;
  return { source: "falcons", average, count, distribution: [5, 4, 3, 2, 1].map(stars => {
    // Preserve historical half-star votes, grouping them with the next whole star.
    const n = votes.filter(vote => Math.ceil(vote.stars / 2) === stars).reduce((sum, vote) => sum + vote.count, 0);
    return { stars, count: n, percent: count ? n / count * 100 : null };
  }) };
}
