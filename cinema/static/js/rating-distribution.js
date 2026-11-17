// Use the same aggregate as film listings, ticketing and AI recommendations.
export function ratingSummary(data) {
  const snapshot = data.rating_snapshot;
  const rating = data.film.rating;
  const votes = data.votes || [];
  const count = Number(rating.count);
  const importedCount = Number(snapshot?.vote_count ?? data.imported_votes ?? 0);
  // An old baseline with no published histogram cannot supply a full breakdown.
  const hasDistribution = Boolean(snapshot) || importedCount === 0;
  return {
    average: rating.average == null ? null : Number(rating.average), count,
    hasDistribution, url: snapshot?.source_url, checkedOn: snapshot?.checked_on,
    distribution: [5, 4, 3, 2, 1].map(stars => {
      // Preserve historical half-star scores, grouping them with the next star.
      const localVotes = votes.filter(vote => Math.ceil(vote.stars / 2) === stars)
        .reduce((sum, vote) => sum + Number(vote.count), 0);
      const sourcePercent = Number(snapshot?.distribution.find(row => row.stars === stars)?.percent ?? 0);
      // Source percentages are rounded. Weight them directly; never invent or
      // store exact imported bucket counts or synthetic customer ratings.
      const percent = count && hasDistribution
        ? (sourcePercent * importedCount + localVotes * 100) / count : null;
      return { stars, percent };
    }),
  };
}
