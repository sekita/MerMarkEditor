import { describe, expect, it, vi } from 'vitest';
import { fetchLatestForkRelease, forkReleaseTag, parseForkBuild, readForkBuildInfo } from '../../utils/fork-release';

const response = (body: unknown, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => body }) as Response;

describe('fork release helpers', () => {
  it('reads the build-time variables', () => {
    expect(readForkBuildInfo({ VITE_RELEASE_REPO: 'sekita/MerMarkEditor', VITE_RELEASE_BUILD: '12' }))
      .toEqual({ repo: 'sekita/MerMarkEditor', build: 12 });
    expect(readForkBuildInfo({})).toBeNull();
    expect(readForkBuildInfo({ VITE_RELEASE_REPO: 'sekita/MerMarkEditor' })).toBeNull();
    expect(readForkBuildInfo({ VITE_RELEASE_REPO: 'not a repo', VITE_RELEASE_BUILD: '3' })).toBeNull();
    expect(readForkBuildInfo({ VITE_RELEASE_REPO: 'a/b', VITE_RELEASE_BUILD: '0' })).toBeNull();
  });

  it('builds and parses tags', () => {
    expect(forkReleaseTag('0.8.6', 7)).toBe('v0.8.6-h2d.7');
    expect(parseForkBuild('v0.8.6-h2d.7')).toBe(7);
    expect(parseForkBuild('v0.9.0-h2d.123')).toBe(123);
    expect(parseForkBuild('v0.8.6')).toBeNull();
    expect(parseForkBuild('h2d-2026-11-21')).toBeNull();
  });

  it('picks the highest published build and ignores other releases', async () => {
    const fetchImpl = vi.fn(async () => response([
      { tag_name: 'v0.8.6', body: 'upstream-style', html_url: 'https://github.com/a/b/releases/tag/v0.8.6' },
      { tag_name: 'v0.8.6-h2d.9', body: 'draft', draft: true },
      { tag_name: 'v0.8.6-h2d.8', body: 'pre', prerelease: true },
      { tag_name: 'v0.8.6-h2d.5', body: 'five', html_url: 'https://github.com/a/b/releases/tag/v0.8.6-h2d.5' },
      { tag_name: 'v0.8.6-h2d.7', body: 'seven', html_url: 'https://evil.example/' },
    ]));
    expect(await fetchLatestForkRelease('a/b', fetchImpl as unknown as typeof fetch)).toEqual({
      tag: 'v0.8.6-h2d.7',
      build: 7,
      notes: 'seven',
      url: 'https://github.com/a/b/releases/tag/v0.8.6-h2d.7', // non-GitHub links are not followed
    });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.github.com/repos/a/b/releases?per_page=30', expect.anything());
  });

  it('reports API failures and empty lists', async () => {
    await expect(fetchLatestForkRelease('a/b', (async () => response({}, false)) as unknown as typeof fetch)).rejects.toThrow('GitHub API 403');
    expect(await fetchLatestForkRelease('a/b', (async () => response([])) as unknown as typeof fetch)).toBeNull();
  });
});
