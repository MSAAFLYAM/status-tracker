/* Static configuration: form fields, CSV header aliases, default leave types.
 * No institution name appears anywhere in this file. */

/** حقول استمارة الموظف: [key, label, input type]. Labels can be renamed by the
 *  user in settings (stored on the device only) via settings.labels. */
export const FIELDS = [
  ["mat", "الرقم المهني"],
  ["ppr", "رقم التأجير"],
  ["nom", "الاسم العائلي"],
  ["prenom", "الاسم الشخصي"],
  ["grade", "الرتبة"],
  ["cap", "الصفة (عنصر / رئيس ...)"],
  ["svc", "المصلحة"],
  ["div", "القسم"],
  ["joined", "تاريخ الالتحاق بالعمل", "date"],
  ["dob", "تاريخ الازدياد", "date"],
  ["addr", "العنوان"],
  ["tel", "الهاتف", "tel"],
];

export const FAM_LABEL = "الوضعية العائلية";
export const FAM_OPTIONS = ["", "متزوج(ة)", "عازب(ة)", "مطلق(ة)", "أرمل(ة)"];

/** مرادفات رؤوس أعمدة CSV (عربية / فرنسية / إنجليزية). */
export const ALIASES = {
  mat: ["mat", "matricule", "الرقم المهني", "الرقم"],
  ppr: ["ppr", "som", "رقم التأجير"],
  nom: ["nom", "اللقب", "النسب", "الاسم العائلي", "last name", "surname"],
  prenom: ["prenom", "الاسم", "الاسم الشخصي", "first name"],
  grade: ["grade", "الرتبة"],
  cap: ["cap", "الصفة"],
  svc: ["svc", "المصلحة", "service"],
  div: ["div", "القسم"],
  joined: ["joined", "تاريخ الالتحاق بالعمل", "تاريخ الولوج", "تاريخ الالتحاق", "date d entree", "hire date"],
  dob: ["dob", "date de naissance", "تاريخ الازدياد", "تاريخ الميلاد", "birth date"],
  addr: ["addr", "adresse", "العنوان", "address"],
  tel: ["tel", "telephone", "تيليفون", "الهاتف", "phone"],
  fam: ["fam", "situation familiale", "الوضعية العائلية"],
};

/** أنواع الرخص الافتراضية. تُخزَّن في الإعدادات ويمكن تعديلها من التطبيق.
 *  noDate: اختيار النوع فقط بلا تاريخ ومدة (التقاعد) — الحالة تبقى حتى الحذف.
 *  bad:    حالة سالبة تظهر بالأحمر (التوقيف، العزل). */
export const DEFAULT_TYPES = [
  { tid: "t01", name: "عطلة إدارية داخل التراب الوطني", days: 30 },
  { tid: "t02", name: "عطلة إدارية خارج التراب الوطني", days: 30 },
  { tid: "t03", name: "رخصة استثنائية 24 ساعة", days: 1 },
  { tid: "t04", name: "رخصة استثنائية 48 ساعة", days: 2 },
  { tid: "t05", name: "رخصة الولادة", days: 15 },
  { tid: "t06", name: "رخصة الوفاة (الأصول)", days: 3 },
  { tid: "t07", name: "رخصة الوفاة (الفروع)", days: 2 },
  { tid: "t08", name: "رخصة مرضية", days: 7 },
  { tid: "t09", name: "رخصة الاستشفاء", days: 7 },
  { tid: "t10", name: "التقاعد النسبي", days: 0, noDate: true },
  { tid: "t11", name: "التقاعد", days: 0, noDate: true },
  { tid: "t12", name: "التوقيف عن العمل", days: 0, bad: true },
  { tid: "t13", name: "العزل", days: 0, bad: true },
];

export const WORKING = "يعمل";
export const LOCK_IDLE_MS = 2 * 60 * 1000; // auto-lock after 2 minutes of inactivity
export const BACKUP_REMIND_DAYS = 30;
