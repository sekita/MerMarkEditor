/**
 * Update checks for builds made from a fork (e.g. the heading2diagram build).
 *
 * The bundled Tauri updater only accepts packages signed with the upstream
 * key and points at the upstream releases, so a fork build would be offered
 * the upstream version (which lacks the fork's features). Fork builds are
 * therefore made with two build-time variables:
 *
 *   VITE_RELEASE_REPO   owner/repo whose GitHub Releases are checked
 *   VITE_RELEASE_BUILD  build number (the workflow run number)
 *
 * and their releases are tagged `v<version>-h2d.<build>`. When both variables
 * are set, the app checks those releases instead and, if a newer build exists,
 * offers to open its download page. Official builds set neither variable and
 * keep the normal updater.
 */

export const FORK_TAG_MARKER = 'h2d';

export interface ForkBuildInfo {
  /** owner/repo */
  repo: string;
  build: number;
}

export interface ForkRelease {
  tag: string;
  build: number;
  notes: string;
  /** Release page (downloads are listed there). */
  url: string;
}

const repoPattern = /^[\w.-]+\/[\w.-]+$/;
const tagPattern = new RegExp(`-${FORK_TAG_MARKER}\\.(\\d+)$`);

/** Fork build information baked in at build time, or null for official builds. */
export function readForkBuildInfo(env: Record<string, unknown> = import.meta.env): ForkBuildInfo | null {
  const repo = typeof env.VITE_RELEASE_REPO === 'string' ? env.VITE_RELEASE_REPO.trim() : '';
  const build = Number(env.VITE_RELEASE_BUILD);
  if (!repoPattern.test(repo) || !Number.isInteger(build) || build <= 0) return null;
  return { repo, build };
}

export const forkReleaseTag = (version: string, build: number): string => `v${version}-${FORK_TAG_MARKER}.${build}`;

/** Build number of a fork release tag (`v0.8.6-h2d.12` -> 12), or null. */
export function parseForkBuild(tag: string): number | null {
  const match = tagPattern.exec(tag);
  return match ? Number(match[1]) : null;
}

interface GitHubRelease {
  tag_name?: unknown;
  body?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/** Newest published fork release of `repo` (by build number), or null. */
export async function fetchLatestForkRelease(repo: string, fetchImpl: typeof fetch = fetch): Promise<ForkRelease | null> {
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status}`);
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return null;
  let best: ForkRelease | null = null;
  for (const release of data as GitHubRelease[]) {
    if (release.draft || release.prerelease || typeof release.tag_name !== 'string') continue;
    const build = parseForkBuild(release.tag_name);
    if (build === null || (best && build <= best.build)) continue;
    best = {
      tag: release.tag_name,
      build,
      notes: typeof release.body === 'string' ? release.body : '',
      url: typeof release.html_url === 'string' && release.html_url.startsWith('https://github.com/')
        ? release.html_url
        : `https://github.com/${repo}/releases/tag/${encodeURIComponent(release.tag_name)}`,
    };
  }
  return best;
}
