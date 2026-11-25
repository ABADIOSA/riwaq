/**
 * English for issue #157: the player menu's "Download subtitle"
 * (src/components/PlayerMenu.jsx, electron/subtitle-save.mjs,
 * core/subtitle-export.mjs). Keyed by the Arabic the code shows.
 *
 * Singular since 0.57 (the requester's follow-up on #157): the action saves
 * one file, one subtitle track in one language, never every subtitle.
 * "No subtitles loaded" stays plural: it says there are none at all.
 */
export default {
  "تنزيل الترجمة": "Download subtitle",
  "اختر الترجمة التي تريد حفظها": "Choose the subtitle to save",
  "حفظ الترجمة": "Save subtitle",
  "حُفظت الترجمة «{name}»": "Saved the subtitle as “{name}”",
  "ملف على هذا الجهاز": "file on this computer",
  "الترجمة هنا مدمجة في ملف الفيديو ولا تُحفظ منفصلة":
    "This subtitle is inside the video file and cannot be saved on its own",
  "مدمجة في ملف الفيديو": "Inside the video file",
  "لا ترجمة محمّلة": "No subtitles loaded",
  "لم تعد هذه الترجمة في المشاهدة":
    "This subtitle is no longer part of this viewing",
  "اختر ترجمة من القائمة": "Choose a subtitle from the menu",
  "الملف الذي وصل ليس ملف ترجمة":
    "The file that arrived is not a subtitle file",
  "ملف الترجمة لم يعد موجوداً": "The subtitle file is no longer there",
  "مكان الحفظ غير صالح": "That save location is not valid",
  "عنوان الترجمة غير صالح": "The subtitle address is not valid",
  "عنوان الترجمة غير مدعوم": "This subtitle address is not supported",
  "حُوّلت الترجمة إلى عنوان على شبكتك، فلم تُحفظ":
    "The subtitle was redirected to an address on your network, so it was not saved",
  "انتهت مهلة تحميل الترجمة": "Downloading the subtitle took too long",
  "تعذّر تحميل الترجمة من مصدرها":
    "Could not download the subtitle from its source",
  "تعذّر تحميل الترجمة (HTTP {n})":
    "Could not download the subtitle (HTTP {n})",
  "المصدر لم يرسل ملف ترجمة": "The source did not send a subtitle file",
  "تعذّر تحميل الترجمة: تحويلات كثيرة":
    "Could not download the subtitle: too many redirects",
};
