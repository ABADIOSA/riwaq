import { ANNOUNCEMENT_REPO } from "../core/announcements.mjs";
import { NoticePublisher } from "../core/notice-publisher.mjs";

export const RELEASES_LIMIT = 2 * 1024 * 1024;
/**
 * The admin app's GitHub side: the shared notice publisher plus the
 * releases list. Used only by the separate admin main process.
 */
export class AdminGithub extends NoticePublisher {
  async downloadStats() {
    const rows = [];
    let complete = false;
    for (let page = 1; page <= 40; page++) {
      const releases = await this.api(
        `/repos/${ANNOUNCEMENT_REPO}/releases?per_page=30&page=${page}`,
        {},
        "",
        RELEASES_LIMIT,
      );
      if (!Array.isArray(releases)) throw Error("Invalid release response");
      for (const release of releases.filter((r) => !r.draft)) {
        let installer = 0,
          portable = 0;
        for (const asset of release.assets || []) {
          if (
            !Number.isSafeInteger(asset.download_count) ||
            asset.download_count < 0
          )
            throw Error("Invalid download count");
          if (
            /^Riwaq-Setup-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?-win-x64\.exe$/.test(
              asset.name,
            )
          )
            installer += asset.download_count;
          else if (
            /^Riwaq-\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?-win-x64\.exe$/.test(
              asset.name,
            )
          )
            portable += asset.download_count;
        }
        rows.push({
          tag: String(release.tag_name).slice(0, 80),
          at: release.published_at,
          installer,
          portable,
          total: installer + portable,
        });
      }
      if (releases.length < 30) {
        complete = true;
        break;
      }
    }
    return {
      at: this.now(),
      complete,
      total: rows.reduce((n, r) => n + r.total, 0),
      installer: rows.reduce((n, r) => n + r.installer, 0),
      portable: rows.reduce((n, r) => n + r.portable, 0),
      releases: rows,
    };
  }
  async releases() {
    // Each release carries its full notes (about 23 KB now, growing with
    // every release): ten of them passed 200 KB at 0.43.1 and would outgrow
    // the general 256 KB cap within a few releases.
    const releases = await this.api(
      `/repos/${ANNOUNCEMENT_REPO}/releases?per_page=10`,
      {},
      "",
      RELEASES_LIMIT,
    );
    return releases
      .filter((r) => !r.draft)
      .map((r) => ({
        tag: r.tag_name,
        name: r.name,
        at: r.published_at,
        prerelease: !!r.prerelease,
      }));
  }
}
