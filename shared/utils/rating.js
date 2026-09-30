import { getDb } from "../db/getClient.js";

/**
 * Recalculates an expert's rating_count and rating_avg based on their currently 
 * 'published' reviews. Call this whenever a review is added, hidden, or published.
 * 
 * @param {string} expertId - The UUID of the expert profile.
 * @param {object} [tx] - Optional Prisma transaction client to use.
 */
export async function recalculateExpertRating(expertId, tx) {
  const dbClient = tx || getDb();
  
  await dbClient.$executeRaw`
    WITH stats AS (
      SELECT 
        COUNT(*) as new_count, 
        COALESCE(AVG(rating), 0) as new_avg
      FROM reviews
      WHERE expert_id = ${expertId}::uuid AND status = 'published'
    )
    UPDATE expert_profiles
    SET rating_count = stats.new_count::integer,
        rating_avg = ROUND(stats.new_avg::numeric, 2)
    FROM stats
    WHERE id = ${expertId}::uuid;
  `;
}
