from __future__ import annotations

from datetime import datetime, timezone
import time
from zoneinfo import ZoneInfo

import requests
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

GEO_CACHE: dict[str, dict] = {}
GEO_CACHE_TTL = 600
SUN_CACHE: dict[str, dict] = {}
SUN_CACHE_TTL = 3600
CITY_CACHE: dict[str, dict] = {}
CITY_CACHE_TTL = 86400


DEFAULT_TZS = [
    "UTC",
    "America/Los_Angeles",
    "America/Denver",
    "America/Chicago",
    "America/New_York",
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Africa/Cairo",
    "Asia/Dubai",
    "Asia/Kolkata",
    "Asia/Singapore",
    "Asia/Tokyo",
    "Australia/Sydney",
]


def _client_ip() -> str | None:
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    ip = request.remote_addr
    if ip in ("127.0.0.1", "::1"):
        try:
            res = requests.get("https://api.ipify.org", params={"format": "json"}, timeout=2)
            if res.ok:
                return res.json().get("ip") or ip
        except Exception:
            return ip
    return ip


def _geo_lookup(ip: str | None) -> dict:
    if not ip:
        return {}
    cached = GEO_CACHE.get(ip)
    now = time.time()
    if cached and now - cached.get("ts", 0) < GEO_CACHE_TTL:
        return cached.get("data", {})
    try:
        res = requests.get(
            f"https://ipapi.co/{ip}/json/", timeout=2, headers={"User-Agent": "time-web"}
        )
        if res.ok:
            data = res.json()
            GEO_CACHE[ip] = {"ts": now, "data": data}
            return data
    except Exception:
        if cached:
            return cached.get("data", {})
        return {}
    return {}


def _sun_times(lat: float, lon: float, tz: str) -> dict:
    key = f"{lat:.3f},{lon:.3f},{tz}"
    cached = SUN_CACHE.get(key)
    now = time.time()
    if cached and now - cached.get("ts", 0) < SUN_CACHE_TTL:
        return cached.get("data", {})
    try:
        res = requests.get(
            "https://api.sunrise-sunset.org/json",
            params={"lat": lat, "lng": lon, "formatted": 0},
            timeout=2,
        )
        if not res.ok:
            if cached:
                return cached.get("data", {})
            return {}
        data = res.json().get("results", {})
        sunrise_utc = datetime.fromisoformat(data.get("sunrise"))
        sunset_utc = datetime.fromisoformat(data.get("sunset"))
        zone = ZoneInfo(tz)
        result = {
            "sunrise": sunrise_utc.astimezone(zone).isoformat(),
            "sunset": sunset_utc.astimezone(zone).isoformat(),
        }
        SUN_CACHE[key] = {"ts": now, "data": result}
        return result
    except Exception:
        if cached:
            return cached.get("data", {})
        return {}


def _tz_for_coords(lat: float, lon: float) -> str:
    try:
        res = requests.get(
            "https://timeapi.io/api/TimeZone/coordinate",
            params={"latitude": lat, "longitude": lon},
            timeout=3,
        )
        if res.ok:
            data = res.json()
            tz = data.get("timeZone")
            if tz:
                return tz
    except Exception:
        return "UTC"
    return "UTC"


@app.route("/")
def index():
    return render_template("index.html", default_tzs=DEFAULT_TZS)


@app.route("/api/time")
def api_time():
    tzs = request.args.getlist("tz")
    if not tzs:
        tzs = DEFAULT_TZS

    now_utc = datetime.now(timezone.utc)
    results = []

    for tz in tzs:
        try:
            zone = ZoneInfo(tz)
        except Exception:
            continue
        local = now_utc.astimezone(zone)
        results.append(
            {
                "tz": tz,
                "iso": local.isoformat(),
                "offset": local.utcoffset().total_seconds() if local.utcoffset() else 0,
                "abbr": local.tzname() or "",
            }
        )

    return jsonify(
        {
            "server_utc": now_utc.isoformat(),
            "server_unix_ms": int(now_utc.timestamp() * 1000),
            "zones": results,
        }
    )


@app.route("/api/local")
def api_local():
    ip = _client_ip()
    geo = _geo_lookup(ip)
    tz = geo.get("timezone") or "UTC"
    city = geo.get("city")
    region = geo.get("region")
    country = geo.get("country_name")
    lat = geo.get("latitude")
    lon = geo.get("longitude")

    sunrise_sunset = {}
    if lat is not None and lon is not None:
        sunrise_sunset = _sun_times(float(lat), float(lon), tz)

    return jsonify(
        {
            "ip": ip,
            "tz": tz,
            "city": city,
            "region": region,
            "country": country,
            "latitude": lat,
            "longitude": lon,
            "sunrise": sunrise_sunset.get("sunrise"),
            "sunset": sunrise_sunset.get("sunset"),
        }
    )


@app.route("/api/city")
def api_city():
    query = (request.args.get("q") or "").strip()
    if not query:
        return jsonify({"error": "missing query"}), 400

    key = query.lower()
    cached = CITY_CACHE.get(key)
    now = time.time()
    if cached and now - cached.get("ts", 0) < CITY_CACHE_TTL:
        return jsonify(cached.get("data", {}))

    try:
        res = requests.get(
            "https://nominatim.openstreetmap.org/search",
            params={"q": query, "format": "json", "limit": 1},
            timeout=3,
            headers={"User-Agent": "time-web"},
        )
        if not res.ok:
            return jsonify({"error": "geocode failed"}), 502
        data = res.json()
        if not data:
            return jsonify({"error": "not found"}), 404
        hit = data[0]
        lat = float(hit["lat"])
        lon = float(hit["lon"])
        label = hit.get("display_name") or query
        tz = _tz_for_coords(lat, lon)

        sun = _sun_times(lat, lon, tz)
        payload = {
            "label": label,
            "tz": tz,
            "latitude": lat,
            "longitude": lon,
            "sunrise": sun.get("sunrise"),
            "sunset": sun.get("sunset"),
        }
        CITY_CACHE[key] = {"ts": now, "data": payload}
        return jsonify(payload)
    except Exception:
        if cached:
            return jsonify(cached.get("data", {}))
        return jsonify({"error": "lookup failed"}), 502


if __name__ == "__main__":
    app.run(debug=True, port=5173)
