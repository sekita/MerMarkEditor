import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { check } from '@tauri-apps/plugin-updater';
import { useAutoUpdate } from '../../composables/useAutoUpdate';

const DISMISSED_KEY = 'mermark-dismissed-update-version';

// Hoisted mock state for @tauri-apps/plugin-updater
const mockCheckResult = vi.hoisted(() => ({ value: null as { version: string; body: string } | null }));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(async () => mockCheckResult.value),
}));

const mockFlatpak = vi.hoisted(() => ({ value: false }));

const mockShellOpen = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: mockShellOpen }));

vi.mock('../../services/flatpak', () => ({
  isFlatpak: vi.fn(async () => mockFlatpak.value),
}));

describe('useAutoUpdate', () => {
  beforeEach(() => {
    localStorage.clear();
    mockCheckResult.value = null;
    mockFlatpak.value = false;
    vi.mocked(check).mockClear();
    // Prevent real network calls via fetch
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    // The composable uses module-level singleton refs (so App.vue and the
    // settings modal share state). Reset them between tests to avoid leakage.
    const { showUpdateDialog, updateInfo, updateError, isUpdating, noUpdateFound } = useAutoUpdate();
    showUpdateDialog.value = false;
    updateInfo.value = null;
    updateError.value = null;
    isUpdating.value = false;
    noUpdateFound.value = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does nothing when no update is available', async () => {
    mockCheckResult.value = null;
    const { checkForUpdates, showUpdateDialog, updateInfo } = useAutoUpdate();

    await checkForUpdates();
    expect(showUpdateDialog.value).toBe(false);
    expect(updateInfo.value).toBeNull();
  });

  it('shows dialog when an update is available', async () => {
    mockCheckResult.value = { version: '0.1.72', body: 'Release notes here' };
    const { checkForUpdates, showUpdateDialog, updateInfo } = useAutoUpdate();

    await checkForUpdates();
    expect(showUpdateDialog.value).toBe(true);
    expect(updateInfo.value).toEqual({ version: '0.1.72', notes: 'Release notes here' });
  });

  it('skips dialog when version was previously dismissed', async () => {
    localStorage.setItem(DISMISSED_KEY, '0.1.72');
    mockCheckResult.value = { version: '0.1.72', body: 'notes' };
    const { checkForUpdates, showUpdateDialog } = useAutoUpdate();

    await checkForUpdates();
    expect(showUpdateDialog.value).toBe(false);
  });

  it('still shows dialog for a NEW version even if older was dismissed', async () => {
    localStorage.setItem(DISMISSED_KEY, '0.1.71');
    mockCheckResult.value = { version: '0.1.72', body: 'new notes' };
    const { checkForUpdates, showUpdateDialog } = useAutoUpdate();

    await checkForUpdates();
    expect(showUpdateDialog.value).toBe(true);
  });

  it('persists dismissed version when closeUpdateDialog is called', async () => {
    mockCheckResult.value = { version: '0.1.72', body: 'notes' };
    const { checkForUpdates, closeUpdateDialog, showUpdateDialog } = useAutoUpdate();

    await checkForUpdates();
    closeUpdateDialog();

    expect(showUpdateDialog.value).toBe(false);
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('0.1.72');
  });

  it('does not dismiss while update is in progress', async () => {
    mockCheckResult.value = { version: '0.1.72', body: 'notes' };
    const { checkForUpdates, closeUpdateDialog, isUpdating, showUpdateDialog } = useAutoUpdate();

    await checkForUpdates();
    isUpdating.value = true;
    closeUpdateDialog();

    // Still open, nothing persisted
    expect(showUpdateDialog.value).toBe(true);
    expect(localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  it('falls back to GitHub API when Tauri body is empty', async () => {
    mockCheckResult.value = { version: '0.1.72', body: '' };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ body: 'From GitHub API' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates, updateInfo } = useAutoUpdate();
    await checkForUpdates();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('api.github.com/repos/Vesperino/MerMarkEditor/releases/tags/v0.1.72'),
    );
    expect(updateInfo.value?.notes).toBe('From GitHub API');
  });

  it('does not call GitHub API when Tauri body is non-empty', async () => {
    mockCheckResult.value = { version: '0.1.72', body: 'Tauri provided' };
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { checkForUpdates, updateInfo } = useAutoUpdate();
    await checkForUpdates();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateInfo.value?.notes).toBe('Tauri provided');
  });

  it('leaves updates to Flathub inside Flatpak', async () => {
    mockFlatpak.value = true;
    mockCheckResult.value = { version: '0.1.72', body: 'notes' };
    const { checkForUpdates, showUpdateDialog, updatesViaFlatpak } = useAutoUpdate();
    updatesViaFlatpak.value = null;

    await checkForUpdates();

    expect(check).not.toHaveBeenCalled();
    expect(showUpdateDialog.value).toBe(false);
    expect(updatesViaFlatpak.value).toBe(true);
  });

  it('detects Flatpak as soon as the composable is used, before any check', async () => {
    mockFlatpak.value = true;
    useAutoUpdate().updatesViaFlatpak.value = null;

    const { updatesViaFlatpak } = useAutoUpdate();
    await vi.waitFor(() => expect(updatesViaFlatpak.value).toBe(true));
  });

  it('does not claim "up to date" on a manual check inside Flatpak', async () => {
    mockFlatpak.value = true;
    const { checkForUpdatesManual, noUpdateFound, updatesViaFlatpak } = useAutoUpdate();
    updatesViaFlatpak.value = null;

    await checkForUpdatesManual();

    expect(check).not.toHaveBeenCalled();
    expect(noUpdateFound.value).toBe(false);
  });

  it('uses the bundled updater outside Flatpak', async () => {
    mockCheckResult.value = { version: '0.1.72', body: 'notes' };
    const { checkForUpdates, updatesViaFlatpak } = useAutoUpdate();
    updatesViaFlatpak.value = null;

    await checkForUpdates();

    expect(check).toHaveBeenCalledTimes(1);
    expect(updatesViaFlatpak.value).toBe(false);
  });

  it('handles GitHub API failure silently (empty notes)', async () => {
    mockCheckResult.value = { version: '0.1.72', body: '' };
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));

    const { checkForUpdates, updateInfo } = useAutoUpdate();
    await checkForUpdates();

    expect(updateInfo.value?.notes).toBe('');
  });

  describe('fork builds', () => {
    const releases = (list: unknown[]) => vi.fn(async (_url: string, _init?: unknown) => ({ ok: true, json: async () => list }));

    beforeEach(() => {
      vi.stubEnv('VITE_RELEASE_REPO', 'sekita/MerMarkEditor');
      vi.stubEnv('VITE_RELEASE_BUILD', '5');
      mockShellOpen.mockClear();
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    it('checks the fork releases instead of the upstream updater', async () => {
      const fetchMock = releases([
        { tag_name: 'v0.8.6-h2d.6', body: 'new build', html_url: 'https://github.com/sekita/MerMarkEditor/releases/tag/v0.8.6-h2d.6' },
      ]);
      vi.stubGlobal('fetch', fetchMock);
      mockCheckResult.value = { version: '9.9.9', body: 'upstream' };
      const { checkForUpdates, showUpdateDialog, updateInfo } = useAutoUpdate();

      await checkForUpdates();
      expect(check).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls[0][0]).toBe('https://api.github.com/repos/sekita/MerMarkEditor/releases?per_page=30');
      expect(showUpdateDialog.value).toBe(true);
      expect(updateInfo.value).toEqual({
        version: '0.8.6-h2d.6',
        notes: 'new build',
        downloadUrl: 'https://github.com/sekita/MerMarkEditor/releases/tag/v0.8.6-h2d.6',
      });
    });

    it('stays quiet when the running build is the newest', async () => {
      vi.stubGlobal('fetch', releases([{ tag_name: 'v0.8.6-h2d.5', body: '' }, { tag_name: 'v0.8.6-h2d.4', body: '' }]));
      const { checkForUpdates, checkForUpdatesManual, showUpdateDialog, noUpdateFound } = useAutoUpdate();
      await checkForUpdates();
      expect(showUpdateDialog.value).toBe(false);
      await checkForUpdatesManual();
      expect(noUpdateFound.value).toBe(true);
    });

    it('respects a dismissed build on the automatic check', async () => {
      localStorage.setItem(DISMISSED_KEY, '0.8.6-h2d.6');
      vi.stubGlobal('fetch', releases([{ tag_name: 'v0.8.6-h2d.6', body: '' }]));
      const { checkForUpdates, checkForUpdatesManual, showUpdateDialog } = useAutoUpdate();
      await checkForUpdates();
      expect(showUpdateDialog.value).toBe(false);
      await checkForUpdatesManual();
      expect(showUpdateDialog.value).toBe(true);
    });

    it('opens the release page instead of installing', async () => {
      vi.stubGlobal('fetch', releases([
        { tag_name: 'v0.8.6-h2d.8', body: '', html_url: 'https://github.com/sekita/MerMarkEditor/releases/tag/v0.8.6-h2d.8' },
      ]));
      const { checkForUpdates, downloadAndInstallUpdate, showUpdateDialog } = useAutoUpdate();
      await checkForUpdates();
      await downloadAndInstallUpdate();
      expect(mockShellOpen).toHaveBeenCalledWith('https://github.com/sekita/MerMarkEditor/releases/tag/v0.8.6-h2d.8');
      expect(check).not.toHaveBeenCalled();
      expect(showUpdateDialog.value).toBe(false);
    });

    it('treats a network error as no update', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
      const { checkForUpdatesManual, showUpdateDialog, noUpdateFound } = useAutoUpdate();
      await checkForUpdatesManual();
      expect(showUpdateDialog.value).toBe(false);
      expect(noUpdateFound.value).toBe(true);
    });
  });
});
