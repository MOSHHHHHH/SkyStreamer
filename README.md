# מזג האוויר בישראל – אתר חלופי ל-GitHub Pages

אתר סטטי עם שמיים מונפשים (שמש, ירח, כוכבים, עננים, גשם, ברקים, שלג, ערפל, אבק, גל חום, רוח),
איורים מונפשים, אזהרות, תחזית לערים, תחזית כללית, מצב הים ו-UV.
הנתונים נמשכים כל שעה מערוצי ה-RSS של השירות המטאורולוגי הישראלי דרך GitHub Actions.

## התקנה (5 דקות)
1. צור ריפו חדש ב-GitHub והעלה אליו את כל הקבצים (כולל התיקייה `.github`).
2. **Settings → Pages** → Source: `Deploy from a branch` → Branch: `main` / `(root)`.
3. **Settings → Actions → General → Workflow permissions** → `Read and write permissions`.
4. לשונית **Actions** → "עדכון תחזית" → **Run workflow** (הרצה ראשונה ידנית).
   מאותו רגע האתר מציג נתונים אמיתיים, ואחר כך מתעדכן לבד כל שעה.

האתר יופיע בכתובת `https://<משתמש>.github.io/<ריפו>/`.

## מבנה
| קובץ | תפקיד |
|---|---|
| `index.html`, `assets/style.css`, `assets/app.js` | האתר |
| `scripts/fetch_ims.py` | מושך 25 ערוצי RSS וכותב `data/weather.json` |
| `.github/workflows/update.yml` | הרצה כל שעה (cron) + commit אוטומטי |
| `data/weather.json` | הנתונים שהאתר קורא (בהתחלה: נתוני הדגמה) |
| `data/raw/*.xml` | עותקי ה-XML המקוריים, לבדיקת המבנה |

## תצוגה מקדימה של אפקטים
הוסף לכתובת: `?sim=storm&night=1&temp=16`
ערכי `sim`: `clear partly cloudy rain storm snow hail fog dust heat wind`

## אם משהו לא נראה נכון
* **הטמפרטורות/האיורים לא תואמים לטקסט:** הפענוח נעשה ב-`assets/app.js` (הפונקציות `detect` ו-`parseTemps`) לפי מילות מפתח בעברית. פתח אחד מקבצי `data/raw/rssForecastCity_*.xml`, ואם המבנה שונה מהצפוי עדכן שם את הביטויים.
* **ה-Action נכשל עם 403 / timeout:** ייתכן ש-ims.gov.il חוסם כתובות של GitHub (שרתים בחו"ל). פתרונות: להגדיר Secret בשם `IMS_PROXY` (כתובת פרוקסי ישראלי), או להריץ `scripts/fetch_ims.py` ממחשב/שרת בישראל (cron או self-hosted runner).
* **הכתובת הרשמית של הערוצים:** https://ims.gov.il/he/RSS_ForecastAlerts

## הערה על תנאי השימוש
תנאי השימוש בדף ה-RSS של השירות מגבילים העברת המידע לצדדים שלישיים ללא אישור כתוב. לפני פרסום ציבורי מומלץ לפנות לשירות המטאורולוגי ולבקש אישור. האתר כולל ייחוס ברור למקור והבהרה שאינו רשמי.
