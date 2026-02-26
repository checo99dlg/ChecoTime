const state = {
  cities: window.DEFAULT_TZS.map((tz) => ({
    id: tz,
    label: tz,
    tz,
  })),
  serverSkewMs: 0,
  perfStart: performance.now(),
  baseNowMs: Date.now(),
  localTz: null,
  localLabel: null,
  sunrise: null,
  sunset: null,
  projection: null,
  localLat: null,
  localLon: null,
  activeLat: null,
  activeLon: null,
  activeTz: null,
  activeLabel: null,
  activeSunrise: null,
  activeSunset: null,
  locationLabel: null,
  lastWeatherKey: null,
};

const cards = document.getElementById("cards");
const heroTime = document.getElementById("heroTime");
const heroDate = document.getElementById("heroDate");
const heroZone = document.getElementById("heroZone");
const heroSun = document.getElementById("heroSun");
const heroSuffix = document.getElementById("heroSuffix");
const locationLine = document.getElementById("locationLine");
const heroWeather = document.getElementById("heroWeather");
const heroWeatherText = heroWeather
  ? heroWeather.querySelector(".wx-text")
  : null;
const cityInput = document.getElementById("cityInput");
const addCityBtn = document.getElementById("addCityBtn");
const cityHint = document.getElementById("cityHint");
const resetBtn = document.getElementById("resetBtn");
const syncStatus = document.getElementById("syncStatus");
const syncDelta = document.getElementById("syncDelta");
const terminatorPath = document.getElementById("terminator");
const mapLand = document.getElementById("mapLand");
const mapLandClip = document.getElementById("mapLandClip");
const tzBands = document.getElementById("tzBands");
const userDot = document.getElementById("userDot");
const tzLegend = document.getElementById("tzLegend");

const MAP_WIDTH = 2200;
const MAP_HEIGHT = 1100;
const MAP_ZOOM = 1;

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const dateFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "2-digit",
  year: "numeric",
});

function setSkew(serverUnixMs) {
  state.serverSkewMs = serverUnixMs - Date.now();
  state.perfStart = performance.now();
  state.baseNowMs = Date.now() + state.serverSkewMs;

  syncStatus.textContent = "Synced";
  const deltaSeconds = Math.round(state.serverSkewMs / 1000);
  const sign = deltaSeconds >= 0 ? "+" : "";
  syncDelta.textContent = `offset ${sign}${deltaSeconds}s`;
}

function nowMs() {
  return state.baseNowMs + (performance.now() - state.perfStart);
}

function formatSun(timeIso, tz) {
  if (!timeIso) return "--";
  const dt = new Date(timeIso);
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz || "UTC",
  }).format(dt);
}

function colorForOffset(offset) {
  const min = -12;
  const max = 14;
  const clamped = Math.min(max, Math.max(min, offset));
  const palette = [
    "#24478f",
    "#2b65a0",
    "#2e86b5",
    "#34a0be",
    "#3fb7c8",
    "#4fc9a6",
    "#66d08e",
    "#87d86f",
    "#a7de61",
    "#c9e055",
    "#e2d14f",
    "#e9b84f",
    "#e59a4b",
    "#e07c49",
    "#d9634c",
    "#cf4f5a",
    "#c0486d",
    "#aa4d84",
    "#8f5796",
    "#6f5fa0",
    "#5965a3",
    "#4b7db0",
    "#3f94b8",
    "#33a7bd",
    "#39b8a8",
    "#55c28b",
    "#7cc76c",
  ];
  const idx = Math.round(clamped - min);
  return palette[idx] || palette[0];
}

function renderTzLegend() {
  if (!tzLegend) return;
  tzLegend.innerHTML = "";
  for (let offset = -12; offset <= 14; offset += 1) {
    const item = document.createElement("div");
    item.className = "flex flex-col items-center gap-1";

    const swatch = document.createElement("div");
    swatch.className = "h-2 w-full rounded-sm";
    swatch.style.background = colorForOffset(offset);
    swatch.style.opacity = "0.9";

    const label = document.createElement("span");
    label.textContent = offset === 0 ? "UTC" : offset > 0 ? `+${offset}` : `${offset}`;

    item.append(swatch, label);
    tzLegend.appendChild(item);
  }
}

function sortTimezoneFeatures(features) {
  try {
    return features;
  } catch (err) {
    return features;
  }
}

function renderTimezoneShapes(geo, projection) {
  if (!tzBands || !geo || !projection) return;
  tzBands.innerHTML = "";
  const features = geo.features || [];
  const path = window.d3.geoPath(projection);
  const offsetsUsed = new Set();
  const sorted = sortTimezoneFeatures(features).slice().sort((a, b) => {
    try {
      return path.area(b) - path.area(a);
    } catch (err) {
      return 0;
    }
  });
  sorted.forEach((feature) => {
    try {
      const offset = Number(feature?.properties?.offset ?? 0);
      offsetsUsed.add(offset);
      const d = path(feature);
      if (!d) return;
      const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
      shape.setAttribute("d", d);
      shape.setAttribute("fill", colorForOffset(offset));
      shape.setAttribute("fill-opacity", "0.75");
      shape.setAttribute("fill-rule", "evenodd");
      shape.setAttribute("stroke", "rgba(15, 23, 42, 0.12)");
      shape.setAttribute("stroke-width", "0.4");
      tzBands.appendChild(shape);
    } catch (err) {
      // skip bad feature
    }
  });
}

function updateLocationLine() {
  const label = state.locationLabel || state.localLabel;
  if (label) {
    locationLine.textContent = `Time in ${label}`;
  } else {
    locationLine.textContent = "Local time";
  }
}

function formatTemp(celsius) {
  if (celsius == null || Number.isNaN(celsius)) return "--";
  const f = celsius * 1.8 + 32;
  return `${Math.round(celsius)}°C / ${Math.round(f)}°F`;
}

function weatherKey(code, isDay) {
  const day = isDay === 1;
  if (code === 0) return day ? "clear-day" : "clear-night";
  if (code >= 1 && code <= 2) return day ? "partly-day" : "partly-night";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (
    (code >= 51 && code <= 57) ||
    (code >= 61 && code <= 67) ||
    (code >= 80 && code <= 82)
  ) {
    return day ? "rain-day" : "rain-night";
  }
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) {
    return day ? "snow-day" : "snow-night";
  }
  if (code === 95 || code === 96 || code === 99) {
    return day ? "thunder-day" : "thunder-night";
  }
  return day ? "clear-day" : "clear-night";
}

async function updateWeather(lat, lon) {
  if (!heroWeather) return;
  if (lat == null || lon == null) {
    if (heroWeatherText) {
      heroWeatherText.textContent = "Weather --°C / --°F";
    }
    return;
  }
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (state.lastWeatherKey === key) return;
  state.lastWeatherKey = key;
  if (heroWeatherText) {
    heroWeatherText.textContent = "Weather …";
  }
  try {
    const res = await fetch(
      `/api/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
    );
    const data = await res.json();
    if (!res.ok || data.error) {
      if (heroWeatherText) {
        heroWeatherText.textContent = "Weather --°C / --°F";
      }
      return;
    }
    if (heroWeatherText) {
      heroWeatherText.textContent = `Weather ${formatTemp(data.temperature_c)}`;
    }
    if (heroWeather.dataset) {
      heroWeather.dataset.wx = weatherKey(data.weather_code, data.is_day);
    }
  } catch (err) {
    if (heroWeatherText) {
      heroWeatherText.textContent = "Weather --°C / --°F";
    }
  }
}

function setActiveCity(city) {
  state.activeLat = city.lat ?? null;
  state.activeLon = city.lon ?? null;
  state.activeTz = city.tz ?? null;
  state.activeLabel = city.label ?? null;
  state.activeSunrise = city.sunrise ?? null;
  state.activeSunset = city.sunset ?? null;
  updateUserDot();
  updateWeather(state.activeLat, state.activeLon);
  updateTimes();
}

function renderCards() {
  cards.innerHTML = "";
  state.cities.forEach((city) => {
    const card = document.createElement("div");
    card.className =
      "rounded-2xl border border-white/10 bg-navy-800/70 px-5 py-4 shadow-glow";

    const title = document.createElement("h3");
    title.className = "text-base font-semibold";
    title.textContent = city.label;

    const timeEl = document.createElement("div");
    timeEl.className = "mt-3 text-2xl font-semibold time";
    timeEl.dataset.tz = city.tz || "UTC";

    const meta = document.createElement("div");
    meta.className = "text-xs text-silver-300 mt-2";
    meta.dataset.meta = city.tz || "UTC";
    if (city.sunrise || city.sunset) {
      meta.dataset.sunrise = city.sunrise || "";
      meta.dataset.sunset = city.sunset || "";
    }

    const remove = document.createElement("button");
    remove.className =
      "absolute top-3 right-3 rounded-full border border-white/10 px-3 py-1 text-xs text-silver-200 hover:text-white transition";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      state.cities = state.cities.filter((item) => item.id !== city.id);
      renderCards();
    });

    card.append(title, timeEl, meta, remove);
    card.classList.add("relative", "overflow-hidden");
    card.addEventListener("click", () => {
      setActiveCity(city);
    });
    cards.appendChild(card);
  });
}

function updateTimes() {
  const now = new Date(nowMs());
  const heroTz = state.activeTz || state.localTz || "UTC";
  heroTime.textContent = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: heroTz,
  }).format(now);
  heroDate.textContent = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: heroTz,
  }).format(now);
  updateLocationLine();
  heroZone.textContent = state.activeLabel || state.localLabel || heroTz;
  const sunRise = state.activeSunrise || state.sunrise;
  const sunSet = state.activeSunset || state.sunset;
  heroSun.textContent = `Sunrise ${formatSun(sunRise, heroTz)} · Sunset ${formatSun(
    sunSet,
    heroTz
  )}`;

  const hour = now.getHours();
  heroSuffix.textContent = hour >= 12 ? "PM" : "AM";

  document.querySelectorAll(".time").forEach((el) => {
    const tz = el.dataset.tz || "UTC";
    const tzTime = new Date(nowMs());
    try {
      const display = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: tz,
      }).format(tzTime);
      el.textContent = display;
    } catch (err) {
      const fallback = new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      }).format(tzTime);
      el.textContent = fallback;
    }
  });

  document.querySelectorAll(".meta").forEach((el) => {
    const tz = el.dataset.meta;
    const dateText = new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "2-digit",
      timeZone: tz,
    }).format(new Date(nowMs()));
    const sunrise = el.dataset.sunrise
      ? formatSun(el.dataset.sunrise, tz)
      : null;
    const sunset = el.dataset.sunset ? formatSun(el.dataset.sunset, tz) : null;
    if (sunrise || sunset) {
      el.textContent = `${dateText} · Sun ${sunrise || "--"} / ${sunset || "--"}`;
    } else {
      el.textContent = dateText;
    }
  });
}

function toRadians(deg) {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad) {
  return (rad * 180) / Math.PI;
}

function computeSolarPosition(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const diff = date.getTime() - start;
  const oneDay = 1000 * 60 * 60 * 24;
  const day = diff / oneDay;
  const gamma =
    (2 * Math.PI) / 365 * (day - 1 + (date.getUTCHours() - 12) / 24);

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const eqtime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const mins =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60;
  const tst = (mins + eqtime + 1440) % 1440;
  const subLon = (720 - tst) / 4;

  return { declination: decl, subsolarLon: subLon };
}

function lonLatToXY(lon, lat, width = MAP_WIDTH, height = MAP_HEIGHT) {
  if (state.projection) {
    const point = state.projection([lon, lat]);
    return { x: point[0], y: point[1] };
  }
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

function updateTerminator() {
  if (!terminatorPath) return;
  const now = new Date(nowMs());
  const { declination, subsolarLon } = computeSolarPosition(now);
  const sinDec = Math.sin(declination);
  const cosDec = Math.cos(declination);

  const points = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    let lat;
    if (Math.abs(sinDec) < 1e-6) {
      lat = 0;
    } else {
      const h = toRadians(lon - subsolarLon);
      const tanLat = (-Math.cos(h) * cosDec) / sinDec;
      lat = toDegrees(Math.atan(tanLat));
    }
    points.push(lonLatToXY(lon, lat));
  }

  const d = points
    .map((pt, idx) => `${idx === 0 ? "M" : "L"} ${pt.x.toFixed(2)} ${pt.y.toFixed(2)}`)
    .join(" ");
  terminatorPath.setAttribute("d", d);

  updateUserDot();
}

function updateUserDot() {
  if (!userDot) return;
  if (state.activeLat == null || state.activeLon == null) {
    userDot.setAttribute("opacity", "0");
    return;
  }
  const userPoint = lonLatToXY(
    state.activeLon,
    state.activeLat,
    MAP_WIDTH,
    MAP_HEIGHT
  );
  const size = 10;
  userDot.setAttribute("x", (userPoint.x - size / 2).toFixed(2));
  userDot.setAttribute("y", (userPoint.y - size / 2).toFixed(2));
  userDot.setAttribute("opacity", "1");
}

async function loadMap() {
  if (!mapLand || !window.d3 || !window.topojson) return;
  try {
    const res = await fetch(
      "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json"
    );
    const topo = await res.json();
    const land = window.topojson.feature(topo, topo.objects.land);
    const projection = window.d3
      .geoEquirectangular()
      .fitSize([MAP_WIDTH, MAP_HEIGHT], land);
    const baseScale = projection.scale();
    projection.scale(baseScale * MAP_ZOOM);
    projection.translate([MAP_WIDTH / 2, MAP_HEIGHT / 2]);
    const path = window.d3.geoPath(projection);
    mapLand.setAttribute("d", path(land));
    if (mapLandClip) {
      mapLandClip.setAttribute("d", path(land));
    }
    try {
      const tzRes = await fetch("/api/tz_geo");
      if (tzRes.ok) {
        const tzGeo = await tzRes.json();
        renderTimezoneShapes(tzGeo, projection);
        renderTzLegend();
      }
    } catch (err) {
      tzBands.innerHTML = "";
    }
    state.projection = projection;
    updateTerminator();
    updateUserDot();
  } catch (err) {
    mapLand.setAttribute("d", "");
  }
}

async function syncTime() {
  syncStatus.textContent = "Syncing...";
  try {
    const params = new URLSearchParams();
    state.cities.forEach((city) => params.append("tz", city.tz));
    const res = await fetch(`/api/time?${params.toString()}`);
    const data = await res.json();
    setSkew(data.server_unix_ms);
  } catch (err) {
    syncStatus.textContent = "Sync failed";
    syncDelta.textContent = "check server";
  }
}

async function loadLocal() {
  try {
    const res = await fetch("/api/local");
    const data = await res.json();
    state.localTz = data.tz || Intl.DateTimeFormat().resolvedOptions().timeZone;
    state.sunrise = data.sunrise;
    state.sunset = data.sunset;
    state.localLat = data.latitude ?? null;
    state.localLon = data.longitude ?? null;

    const parts = [data.city, data.region, data.country].filter(Boolean);
    state.localLabel = parts.join(", ") || state.localTz;

    // Apply local location if no city has been manually selected yet,
    // or if the active city is still the local one (update label/coords).
    if (!state.activeTz || state.activeTz === state.localTz) {
      setActiveCity({
        label: state.localLabel,
        tz: state.localTz || "UTC",
        sunrise: state.sunrise,
        sunset: state.sunset,
        lat: state.localLat,
        lon: state.localLon,
      });
    }
    updateLocationLine();
  } catch (err) {
    locationLine.textContent = "Local time";
  }
}

async function addCity() {
  const query = cityInput.value.trim();
  if (!query) return;
  cityInput.value = "";
  cityInput.placeholder = "Searching...";
  if (cityHint) {
    cityHint.textContent = "Searching…";
  }
  try {
    const res = await fetch(`/api/city?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    if (!res.ok || data.error) {
      cityInput.placeholder = "City not found";
      if (cityHint) {
        cityHint.textContent = "City not found. Try a larger city name.";
      }
      return;
    }
    if (!data.tz) {
      cityInput.placeholder = "Timezone not found";
      if (cityHint) {
        cityHint.textContent = "Timezone not found for that city.";
      }
      return;
    }
    const existing = state.cities.find((item) => item.id === data.label);
    if (existing) {
      setActiveCity(existing);
      cityInput.placeholder = "e.g. Mexico City";
      if (cityHint) {
        cityHint.textContent = "Already on your board. Jumped to it.";
      }
      return;
    }
    state.cities.push({
      id: data.label,
      label: data.label,
      tz: data.tz,
      sunrise: data.sunrise,
      sunset: data.sunset,
      lat: data.latitude,
      lon: data.longitude,
    });
    setActiveCity({
      label: data.label,
      tz: data.tz,
      sunrise: data.sunrise,
      sunset: data.sunset,
      lat: data.latitude,
      lon: data.longitude,
    });
    state.locationLabel = data.label;
    updateLocationLine();
    cityInput.placeholder = "e.g. Mexico City";
    if (cityHint) {
      cityHint.textContent = "Search by city name and we’ll find the timezone.";
    }
    renderCards();
    syncTime();
  } catch (err) {
    cityInput.placeholder = "Lookup failed";
    if (cityHint) {
      cityHint.textContent = "Lookup failed. Check your connection and try again.";
    }
  }
}

addCityBtn.addEventListener("click", addCity);
resetBtn.addEventListener("click", () => {
  state.cities = window.DEFAULT_TZS.map((tz) => ({
    id: tz,
    label: tz,
    tz,
  }));
  renderCards();
  syncTime();
});

cityInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    addCity();
  }
});

renderCards();
updateTimes();
loadLocal();
loadMap();
syncTime();
updateTerminator();
setInterval(updateTimes, 1000);
setInterval(syncTime, 30000);
setInterval(updateTerminator, 60000);
