/** Owner devices: the owner's notice tools inside the public app (electron/owner.mjs). */
export default {
  "أدوات المالك": "Owner tools",
  الجميع: "Everyone",
  "تطبيق ويندوز": "Windows app",
  الموقع: "Website",
  "انتشر الإشعار. يوصل للمشاهدين عند فتح رِواق أو خلال ربع ساعة.":
    "The notice is published. Viewers get it when they open Riwaq or within a quarter of an hour.",
  "نتحقق من هذا الجهاز…": "Checking this device…",
  "اجعل هذا الجهاز جهاز مالك": "Make this device an owner device",
  "الجهاز يصير جهاز مالك لما تدخل فيه رمز GitHub لحسابك. رِواق يتأكد من GitHub إن الرمز لحساب مالك رِواق وله صلاحية الكتابة، وغير كذا يرفضه.":
    "A device becomes an owner device when you enter a GitHub token for your account on it. Riwaq checks with GitHub that the token belongs to Riwaq's owner and can write to the repository, and refuses it otherwise.",
  "أنشئ رمزاً جديداً لهذا الجهاز بالذات، وسمّه باسمه (مثلاً «جهاز البيت»).":
    "Create a new token for this device alone, and name it after the device (for example “Home PC”).",
  "اختر المستودع ABADIOSA/riwaq فقط، وصلاحية Contents للقراءة والكتابة، وحدد له تاريخ انتهاء.":
    "Select only the ABADIOSA/riwaq repository and Contents read and write, and give it an expiry date.",
  "انسخ الرمز والصقه هنا.": "Copy the token and paste it here.",
  "صفحة إنشاء الرمز في GitHub": "GitHub's new token page",
  "رمز GitHub": "GitHub token",
  "تذكّر هذا الجهاز كجهاز مالك (الرمز ينحفظ مشفّراً بتشفير ويندوز على هذا الجهاز بس)":
    "Remember this device as an owner device (the token is sealed with Windows encryption on this device only)",
  "تحقق وفعّل": "Check and activate",
  "تقدر تشيل أي جهاز متى ما بغيت: احذف رمزه من GitHub، أو اضغط «إلغاء هذا الجهاز» منه.":
    "You can remove any device at any time: delete its token on GitHub, or press “Remove this device” on it.",
  "هذا الجهاز جهاز مالك": "This device is an owner device",
  "متصل بحساب {name}": "Connected as {name}",
  "محفوظ على هذا الجهاز": "remembered on this device",
  "لهذه الجلسة فقط": "for this session only",
  "العنوان بالعربي": "Title in Arabic",
  "النص بالعربي": "Text in Arabic",
  "العنوان بالإنجليزي (اختياري)": "Title in English (optional)",
  "النص بالإنجليزي (اختياري)": "Text in English (optional)",
  الجمهور: "Audience",
  "يبقى (أيام)": "Stays (days)",
  "من إصدار": "From version",
  "إلى إصدار": "To version",
  "رابط داخل مستودع رِواق (اختياري)":
    "Link inside Riwaq's repository (optional)",
  معاينة: "Preview",
  "بعد النشر يصير في ملف الإشعارات {n} إشعار.":
    "After publishing, the notice file holds {n} notices.",
  "نشر الإشعار": "Publish the notice",
  "معاينة قبل النشر": "Preview before publishing",
  "إلغاء هذا الجهاز": "Remove this device",
  // Main and electron/owner.mjs
  "نشر إشعار رِواق": "Publish a Riwaq notice",
  "يوصل لكل من يطابق الجمهور المحدد عند فتح رِواق أو تحديث صندوق الإشعارات، ويبقى في سجل GitHub.":
    "It reaches everyone in the chosen audience when they open Riwaq or refresh their inbox, and stays in GitHub's history.",
  "تغيّر ملف الإشعارات من جهاز ثاني، عاين المسودة مرة ثانية.":
    "The notice file changed from another device; preview the draft again.",
  "GitHub رفض الرمز: انتهت صلاحيته أو انحذف أو ما له صلاحية الكتابة.":
    "GitHub refused the token: it expired, was deleted or cannot write.",
  "هذا ما يشبه رمز GitHub، انسخه كامل من صفحة الرموز.":
    "This does not look like a GitHub token; copy it whole from the tokens page.",
  "هذا الرمز مو لحساب مالك رِواق، أو ما له صلاحية الكتابة على المستودع.":
    "This token is not for Riwaq's owner account, or it cannot write to the repository.",
  "أعد المعاينة قبل النشر.": "Preview again before publishing.",
  "افتح أدوات المالك على هذا الجهاز أولاً.":
    "Open the owner tools on this device first.",
  "راجع الحقول: العنوان والنص بالعربي مطلوبان، والمدة من يوم إلى 90، والرابط داخل مستودع رِواق.":
    "Check the fields: the Arabic title and text are required, the duration is 1 to 90 days, and the link stays inside Riwaq's repository.",
  "فيه نشر شغّال الحين، انتظره يخلص.":
    "A publication is running now; wait for it to finish.",
  "تعذّر الوصول إلى GitHub. تأكد من الإنترنت ثم حاول مرة ثانية.":
    "GitHub could not be reached. Check the connection and try again.",
  "تشفير ويندوز غير متاح، فما نقدر نحفظ الرمز على هذا الجهاز.":
    "Windows encryption is not available, so the token cannot be kept on this device.",
  "تعذّر فتح الرمز المحفوظ، أدخله مرة ثانية.":
    "The remembered token could not be opened; enter it again.",
  "أدوات المالك تعمل في نسخة رِواق لسطح المكتب على الأجهزة اللي يختارها المالك.":
    "Owner tools work in Riwaq's desktop app, on the devices the owner chooses.",
};
