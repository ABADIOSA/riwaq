/**
 * Owner devices: the public app becomes the owner's notice tool on the
 * devices the owner chooses. A device joins when the owner enters a GitHub
 * token there that GitHub itself confirms belongs to ABADIOSA with push
 * access to the public repository (core/notice-publisher.mjs). Each device
 * should get its own fine-grained token: deleting that token on GitHub takes
 * exactly that device out, and the device notices on its next use.
 *
 * A remembered token is sealed with Windows' safeStorage in its own file
 * (`owner.bin`), outside the profile, so it never enters a backup, an
 * account, the interface or a report. Nothing here contacts GitHub until the
 * owner opens the tools; other people's copies never make a request for it.
 */
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { NoticePublisher } from "../core/notice-publisher.mjs";

/** GitHub's and the publisher's refusals, as sentences for the owner. */
export function ownerProblem(error) {
  const message = String(error?.message || "");
  const status = /HTTP (\d{3})/.exec(message)?.[1];
  if (status === "409")
    return "تغيّر ملف الإشعارات من جهاز ثاني، عاين المسودة مرة ثانية.";
  if (status === "401" || status === "403")
    return "GitHub رفض الرمز: انتهت صلاحيته أو انحذف أو ما له صلاحية الكتابة.";
  if (/Invalid GitHub token/.test(message))
    return "هذا ما يشبه رمز GitHub، انسخه كامل من صفحة الرموز.";
  if (/Owner access/.test(message))
    return "هذا الرمز مو لحساب مالك رِواق، أو ما له صلاحية الكتابة على المستودع.";
  if (/Preview again|Connection cancelled/.test(message))
    return "أعد المعاينة قبل النشر.";
  if (/Connect the owner/.test(message))
    return "افتح أدوات المالك على هذا الجهاز أولاً.";
  if (/Invalid announcement|Invalid feed/.test(message))
    return "راجع الحقول: العنوان والنص بالعربي مطلوبان، والمدة من يوم إلى 90، والرابط داخل مستودع رِواق.";
  if (/Publishing in progress/.test(message))
    return "فيه نشر شغّال الحين، انتظره يخلص.";
  return "تعذّر الوصول إلى GitHub. تأكد من الإنترنت ثم حاول مرة ثانية.";
}

/** A refusal that means this token can no longer act for the owner. */
const revoked = (error) =>
  /HTTP 40[13]|Owner access|Invalid GitHub token/.test(
    String(error?.message || ""),
  );

export class OwnerDevice {
  /**
   * `file` is where a remembered token is sealed; `confirm(item)` asks the
   * owner in a native dialog before a publication and resolves true or false.
   */
  constructor({ file, safeStorage, publisher, confirm, log = () => {} }) {
    this.file = file;
    this.safeStorage = safeStorage;
    this.publisher = publisher || new NoticePublisher();
    this.confirm = confirm;
    this.log = log;
    this.login = "";
  }

  get remembered() {
    return existsSync(this.file);
  }

  /** What the interface may know: flags and the account name, never the token. */
  state() {
    return {
      owner: !!this.publisher.token,
      remembered: this.remembered,
      login: this.publisher.token ? this.login : "",
    };
  }

  seal(token) {
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error(
        "تشفير ويندوز غير متاح، فما نقدر نحفظ الرمز على هذا الجهاز.",
      );
    writeFileSync(this.file + ".tmp", this.safeStorage.encryptString(token));
    renameSync(this.file + ".tmp", this.file);
  }

  unseal() {
    return this.safeStorage.decryptString(readFileSync(this.file));
  }

  /** Makes this device an owner device; `remember` keeps it one after a restart. */
  async activate({ token, remember = true } = {}) {
    try {
      const { login } = await this.publisher.connect(token);
      this.login = login;
    } catch (error) {
      this.log(error);
      throw new Error(ownerProblem(error));
    }
    if (remember) this.seal(String(token).trim());
    else this.removeFile();
    return this.state();
  }

  /**
   * Opens the tools: a remembered token is checked with GitHub again. One
   * GitHub no longer accepts for the owner is deleted, so a token deleted on
   * GitHub takes this device out; a network failure keeps it for next time.
   */
  async open() {
    if (this.publisher.token || !this.remembered) return this.state();
    let token;
    try {
      token = this.unseal();
    } catch (error) {
      this.log(error);
      this.removeFile();
      return {
        ...this.state(),
        problem: "تعذّر فتح الرمز المحفوظ، أدخله مرة ثانية.",
      };
    }
    try {
      const { login } = await this.publisher.connect(token);
      this.login = login;
      return this.state();
    } catch (error) {
      this.log(error);
      if (revoked(error)) this.removeFile();
      return { ...this.state(), problem: ownerProblem(error) };
    }
  }

  removeFile() {
    rmSync(this.file, { force: true });
    rmSync(this.file + ".tmp", { force: true });
  }

  /** Takes this device out: the remembered token is deleted here. */
  forget() {
    try {
      this.publisher.disconnect();
    } catch {
      // A publication in flight keeps its connection until it ends.
    }
    this.login = "";
    this.removeFile();
    return this.state();
  }

  async preview(draft) {
    try {
      return await this.publisher.preview(draft);
    } catch (error) {
      this.log(error);
      throw new Error(ownerProblem(error));
    }
  }

  /** Publishes the previewed notice, only after the owner confirms it natively. */
  async publish({ nonce } = {}) {
    const previewed = this.publisher.previewed;
    if (!previewed || previewed.nonce !== nonce)
      throw new Error("أعد المعاينة قبل النشر.");
    if (!(await this.confirm(previewed.item))) return { published: false };
    try {
      return await this.publisher.publish(nonce);
    } catch (error) {
      this.log(error);
      throw new Error(ownerProblem(error));
    }
  }
}
