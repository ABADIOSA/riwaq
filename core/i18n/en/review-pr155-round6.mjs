/**
 * English for the sixth remediation pass of PR #155 (Codex's fifth
 * review, V1 and V2, docs/REVIEW-PR-155.md). Keyed by the Arabic the code
 * shows.
 */
export default {
  // V1: a removed profile's downloads are deleted after its removal is
  // written; a file another program holds waits on a clean-up list.
  "حُذف الملف الشخصي، وبقيت بعض ملفات تنزيلاته مفتوحة في برنامج آخر؛ سيحذفها رِواق حين تُغلق":
    "The profile was removed. Some of its downloaded files are open in another program; Riwaq will delete them once they are closed",
  "ما زالت ملفات ملف شخصي حُذف سابقًا تنتظر الحذف؛ أغلق البرامج التي تستخدمها ثم أعد تشغيل رِواق":
    "Files of a profile removed earlier are still waiting to be deleted; close the programs using them, then restart Riwaq",
};
