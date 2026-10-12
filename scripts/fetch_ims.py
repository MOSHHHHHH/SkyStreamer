#!/usr/bin/env python3
"""
מושך את ערוצי ה-RSS של השירות המטאורולוגי הישראלי וכותב data/weather.json
(וגם עותקי XML גולמיים ל-data/raw/ כדי שאפשר יהיה לבדוק את המבנה ולכוונן את התצוגה).

הרצה מקומית:  python scripts/fetch_ims.py
משתנה סביבה אופציונלי:
  HTTPS_PROXY   - פרוקסי (אם GitHub חסום מול ims.gov.il)
"""
import json, re, sys, time, html
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "weather.json"
RAW = ROOT / "data" / "raw"
BASE = "https://ims.gov.il/sites/default/files/ims_data/rss"

# (קטגוריה, מזהה, שם, נתיב)
FEEDS = [
    ("country", "country", "תחזית כללית לרחבי הארץ", "forecast_country/rssForecastCountry_he.xml"),
    ("uv", "uv", "מדד קרינת UV", "forecast_radiation/rssForecastRadiation_he.xml"),
    ("sea", "212", "חוף צפון", "forecast_sea/rssForecastSea_212_he.xml"),
    ("sea", "210", "חוף מרכז", "forecast_sea/rssForecastSea_210_he.xml"),
    ("sea", "213", "חוף דרום", "forecast_sea/rssForecastSea_213_he.xml"),
    ("sea", "211", "כנרת", "forecast_sea/rssForecastSea_211_he.xml"),
    ("sea", "214", "מפרץ אילת", "forecast_sea/rssForecastSea_214_he.xml"),
    ("city", "510", "ירושלים", "forecast_city/rssForecastCity_510_he.xml"),
    ("city", "402", "תל-אביב, חוף", "forecast_city/rssForecastCity_402_he.xml"),
    ("city", "115", "חיפה", "forecast_city/rssForecastCity_115_he.xml"),
    ("city", "513", "באר שבע", "forecast_city/rssForecastCity_513_he.xml"),
    ("city", "520", "אילת", "forecast_city/rssForecastCity_520_he.xml"),
    ("city", "114", "אשדוד", "forecast_city/rssForecastCity_114_he.xml"),
    ("city", "204", "לוד", "forecast_city/rssForecastCity_204_he.xml"),
    ("city", "202", "טבריה", "forecast_city/rssForecastCity_202_he.xml"),
    ("city", "507", "צפת", "forecast_city/rssForecastCity_507_he.xml"),
    ("city", "207", "נצרת", "forecast_city/rssForecastCity_207_he.xml"),
    ("city", "209", "עפולה", "forecast_city/rssForecastCity_209_he.xml"),
    ("city", "203", "בית שאן", "forecast_city/rssForecastCity_203_he.xml"),
    ("city", "201", "קצרין", "forecast_city/rssForecastCity_201_he.xml"),
    ("city", "106", "מצפה רמון", "forecast_city/rssForecastCity_106_he.xml"),
    ("city", "105", "עין גדי", "forecast_city/rssForecastCity_105_he.xml"),
    ("alert", "general", "כל האזהרות לציבור הרחב", "alert/rssAlert_general_country_he.xml"),
    ("alert", "sea", "אזהרות לאזורי הים", "alert/rssAlert_sea_country_he.xml"),
    ("alert", "visibility", "אזהרות על הגבלות ראות", "alert/rssAlert_visibility_country_he.xml"),
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "he-IL,he;q=0.9,en;q=0.5",
}


class _Strip(HTMLParser):
    """HTML -> טקסט קריא, עם שמירה על מעברי שורה ועל מבנה טבלאות."""
    BLOCK = {"br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK:
            self.parts.append("\n")
        elif tag in ("td", "th"):
            self.parts.append(" | ")

    def handle_endtag(self, tag):
        if tag in self.BLOCK:
            self.parts.append("\n")

    def handle_data(self, data):
        self.parts.append(data)


def html_to_text(s: str) -> str:
    if not s:
        return ""
    p = _Strip()
    try:
        p.feed(s)
        txt = "".join(p.parts)
    except Exception:
        txt = re.sub(r"<[^>]+>", " ", s)
    txt = html.unescape(txt).replace("\xa0", " ")
    lines = []
    for ln in txt.splitlines():
        ln = re.sub(r"[ \t]+", " ", ln).strip(" |\t")
        ln = re.sub(r"(\s*\|\s*){2,}", " | ", ln)
        if ln:
            lines.append(ln)
    return "\n".join(lines)


def strip_ns(tag: str) -> str:
    return tag.split("}", 1)[-1] if "}" in tag else tag


def parse_rss(content: bytes) -> dict:
    root = ET.fromstring(content)
    channel = None
    for el in root.iter():
        if strip_ns(el.tag) == "channel":
            channel = el
            break
    if channel is None:
        channel = root
    meta, items = {}, []
    for ch in channel:
        name = strip_ns(ch.tag)
        if name == "item":
            it, extra = {}, {}
            for f in ch:
                k = strip_ns(f.tag)
                v = (f.text or "").strip()
                if k in ("title", "link", "pubDate", "guid", "category", "author"):
                    it[k] = v
                elif k == "description":
                    it.setdefault("description", v)
                elif k == "encoded":
                    it["description"] = v
                elif v:
                    extra[k] = v
            desc = it.get("description", "")
            item = {
                "title": html_to_text(it.get("title", "")),
                "pubDate": it.get("pubDate", ""),
                "link": it.get("link", ""),
                "text": html_to_text(desc),
                "html": desc if "<" in desc else "",
            }
            if extra:
                item["extra"] = extra
            items.append(item)
        elif name in ("title", "description", "lastBuildDate", "pubDate", "language"):
            meta[name] = html_to_text((ch.text or "").strip())
    return {"meta": meta, "items": items}


def fetch_one(feed):
    cat, fid, name, path = feed
    url = f"{BASE}/{path}"
    last_err = None
    for attempt in range(1, 4):
        try:
            r = requests.get(url, headers=HEADERS, timeout=30)
            r.raise_for_status()
            RAW.mkdir(parents=True, exist_ok=True)
            (RAW / Path(path).name).write_bytes(r.content)
            parsed = parse_rss(r.content)
            return {"cat": cat, "id": fid, "name": name, "url": url, "ok": True, **parsed}
        except Exception as e:  # noqa
            last_err = f"{type(e).__name__}: {e}"
            time.sleep(2 * attempt)
    return {"cat": cat, "id": fid, "name": name, "url": url, "ok": False,
            "error": last_err, "meta": {}, "items": []}


def main():
    prev = {}
    if OUT.exists():
        try:
            old = json.loads(OUT.read_text(encoding="utf-8"))
            if not old.get("demo"):
                prev = {(f["cat"], f["id"]): f for f in old.get("feeds", []) if f.get("ok")}
        except Exception:
            pass

    with ThreadPoolExecutor(max_workers=5) as ex:
        results = list(ex.map(fetch_one, FEEDS))

    ok = 0
    for i, f in enumerate(results):
        if f["ok"]:
            ok += 1
            print(f"OK    {f['cat']:8s} {f['name']}  ({len(f['items'])} פריטים)")
        else:
            print(f"FAIL  {f['cat']:8s} {f['name']}  {f['error']}", file=sys.stderr)
            old = prev.get((f["cat"], f["id"]))
            if old:  # שומרים את הנתון האחרון שהצליח
                old = dict(old)
                old["stale"] = True
                results[i] = old

    if ok == 0:
        print("כל הערוצים נכשלו - לא מעדכנים את הקובץ.", file=sys.stderr)
        sys.exit(1)

    now = datetime.now(timezone.utc)
    data = {
        "demo": False,
        "fetchedAt": now.isoformat(timespec="seconds"),
        "fetchedAtIL": now.astimezone(ZoneInfo("Asia/Jerusalem")).strftime("%d/%m/%Y %H:%M"),
        "okCount": ok,
        "total": len(FEEDS),
        "feeds": results,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"נכתב {OUT} ({ok}/{len(FEEDS)} ערוצים)")


if __name__ == "__main__":
    main()
