import { ANNOUNCEMENT_REPO } from "../core/announcements.mjs";
import { NoticePublisher } from "../core/notice-publisher.mjs";

export const RELEASES_LIMIT = 2 * 1024 * 1024;
/**
 * The admin app's GitHub side: the shared notice publisher plus the
 * releases list. Used only by the separate admin main process.
 */
export class AdminGithub extends NoticePublisher {
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
