/**
 * utils/api.js
 * Lazy-polling helpers for LeetCode GraphQL.
 * These use the user's active LeetCode session cookies (credentials: 'include').
 * Called at most ONCE per UTC day — result is cached in storage.
 */

const GRAPHQL_URL = 'https://leetcode.com/graphql/';

/**
 * Fetch today's unique accepted submission count for a user.
 * Uses recentAcSubmissionList — returns last 20 by default (enough for any daily goal).
 * Returns { count, slugs, loggedIn }.
 */
export async function fetchTodaySolves(username) {
  const query = `
    query recentAcSubmissions($username: String!, $limit: Int!) {
      recentAcSubmissionList(username: $username, limit: $limit) {
        id
        title
        titleSlug
        timestamp
      }
    }
  `;

  try {
    const resp = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query, variables: { username, limit: 20 } }),
    });

    if (resp.status === 403 || resp.status === 401) {
      return { count: 0, slugs: [], loggedIn: false };
    }

    const json = await resp.json();
    const list = json?.data?.recentAcSubmissionList ?? [];

    const todayUTC = new Date().toISOString().split('T')[0];
    const todaySolves = list.filter((s) => {
      const solveDate = new Date(parseInt(s.timestamp, 10) * 1000)
        .toISOString()
        .split('T')[0];
      return solveDate === todayUTC;
    });

    // Deduplicate by slug
    const slugSet = new Set(todaySolves.map((s) => s.titleSlug));
    return { count: slugSet.size, slugs: [...slugSet], loggedIn: true };
  } catch {
    // Network error or not logged in — fail gracefully
    return { count: 0, slugs: [], loggedIn: false };
  }
}

/**
 * Fetch today's daily challenge question info.
 * Returns { slug, title, link } or null if the query fails.
 */
export async function fetchDailyChallenge() {
  const query = `
    query questionOfToday {
      activeDailyCodingChallengeQuestion {
        date
        link
        question {
          titleSlug
          title
        }
      }
    }
  `;

  try {
    const resp = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ query }),
    });

    const json = await resp.json();
    const q = json?.data?.activeDailyCodingChallengeQuestion;
    if (!q) return null;

    const slug = q.question?.titleSlug ?? null;
    const title = q.question?.title ?? null;
    const link = q.link
      ? `https://leetcode.com${q.link}`
      : slug
      ? `https://leetcode.com/problems/${slug}/`
      : null;

    return slug ? { slug, title, link } : null;
  } catch {
    return null;
  }
}
