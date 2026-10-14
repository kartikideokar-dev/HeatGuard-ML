"use strict";

const API_URL = "http://127.0.0.1:8000";
const $ = (selector) => document.querySelector(selector);

let currentWeather = null;
let latestAssessment = null;
let historyChart = null;

const HISTORY_KEY = "heatguard_assessment_history";

const VALID_SECTIONS = ["overview", "assessment", "safety"];

document.addEventListener("DOMContentLoaded", () => {
  initializeIcons();
  initializeNavigation();
  initializeLocation();
  initializeAssessment();
  initializeInsights();
  initializeSafetyGuide();
  initializeProfileButton();
  updateDashboard();
});

// --------------------------------------------------
// Utilities
// --------------------------------------------------

function initializeIcons() {
  refreshIcons();
}

function refreshIcons() {
  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function showToast(message) {
  const container = $("#toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => toast.remove(), 3500);
}

function setText(selector, value) {
  const element = $(selector);
  if (element) element.textContent = value ?? "";
}

function formatNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "—";

  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function getHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function setHistory(history) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch (error) {
    console.error("Could not save assessment history:", error);
    showToast("Could not save history in this browser.");
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function findFirst(object, keys) {
  for (const key of keys) {
    if (object && object[key] !== null && object[key] !== undefined) {
      return object[key];
    }
  }
  return null;
}

// Backend currently returns estimated_risk_score on a 0–100 scale.
function getScore(result) {
  const raw = findFirst(result, [
    "estimated_risk_score",
    "risk_score",
    "score",
    "heat_risk_score",
    "probability",
    "risk_probability",
  ]);

  if (raw === null || raw === "") return null;

  let score = Number(raw);
  if (!Number.isFinite(score)) return null;

  // Probability-like fields may be in the 0–1 range.
  if (score >= 0 && score <= 1 && !("estimated_risk_score" in (result || {}))) {
    score *= 100;
  }

  return Math.round(Math.max(0, Math.min(100, score)));
}

function getRiskLevel(result, score) {
  const level = findFirst(result, ["risk_level", "risk_category", "level"]);

  if (level !== null) return String(level);

  if (score === null) return "Unavailable";
  if (score < 30) return "Low";
  if (score < 60) return "Moderate";
  return "High";
}

// --------------------------------------------------
// Navigation
// --------------------------------------------------

function initializeNavigation() {
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      const section = link.dataset.section;
      if (VALID_SECTIONS.includes(section)) showSection(section);
    });
  });

  $("#start-assessment")?.addEventListener("click", () => {
    showSection("assessment");
    $("#assessment-form")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  });

  $("#menu-toggle")?.addEventListener("click", () => {
    const sidebar = $("#sidebar");
    const button = $("#menu-toggle");
    if (!sidebar || !button) return;

    const isOpen = sidebar.classList.toggle("open");
    button.setAttribute("aria-expanded", String(isOpen));
  });

  document.querySelectorAll(".brand, .footer-brand").forEach((element) => {
    element.addEventListener("click", () => showSection("overview"));
  });

  window.addEventListener("hashchange", () => {
    const section = location.hash.replace("#", "");
    if (VALID_SECTIONS.includes(section)) showSection(section);
  });

  const initialSection = location.hash.replace("#", "");
  showSection(
    VALID_SECTIONS.includes(initialSection) ? initialSection : "overview",
  );
}

function showSection(sectionName) {
  if (!VALID_SECTIONS.includes(sectionName)) {
    sectionName = "overview";
  }

  document.querySelectorAll(".page-section").forEach((section) => {
    section.classList.toggle("active", section.id === sectionName);
  });

  document.querySelectorAll(".nav-link").forEach((link) => {
    const active = link.dataset.section === sectionName;
    link.classList.toggle("active", active);

    if (active) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  });

  const titles = {
    overview: "Overview",
    assessment: "Risk Assessment",
    safety: "Safety Guide",
  };

  setText("#breadcrumb-current", titles[sectionName]);

  $("#sidebar")?.classList.remove("open");
  $("#menu-toggle")?.setAttribute("aria-expanded", "false");

  if (location.hash !== `#${sectionName}`) {
    history.replaceState(null, "", `#${sectionName}`);
  }

  if (sectionName === "overview") {
    updateDashboard();
  }
}

// --------------------------------------------------
// Location and live weather
// --------------------------------------------------

function initializeLocation() {
  $("#fetch-location")?.addEventListener("click", fetchLocationAndWeather);
  $("#apply-weather")?.addEventListener("click", applyWeatherToForm);
}

function fetchLocationAndWeather() {
  if (!navigator.geolocation) {
    setWeatherStatus("Location is not supported by this browser.");
    showToast("Please enter your location and available values manually.");
    return;
  }

  const button = $("#fetch-location");
  const originalHTML = button?.innerHTML;

  if (button) {
    button.disabled = true;
    button.textContent = "Finding location…";
  }

  setWeatherStatus("Requesting location permission…");

  navigator.geolocation.getCurrentPosition(
    async (position) => {
      try {
        await loadWeatherForCoordinates(
          position.coords.latitude,
          position.coords.longitude,
        );
      } catch (error) {
        console.error("Weather loading failed:", error);
        setWeatherStatus("Weather could not be loaded. Please try again.");
        showToast("Could not load weather.");
      } finally {
        if (button) {
          button.disabled = false;
          button.innerHTML = originalHTML;
          refreshIcons();
        }
      }
    },
    (error) => {
      const messages = {
        1: "Location permission was denied. You can enter values manually.",
        2: "Your location could not be determined. Please try again.",
        3: "Location request timed out. Please try again.",
      };

      setWeatherStatus(messages[error.code] || "Location access failed.");
      showToast("Location unavailable.");

      if (button) {
        button.disabled = false;
        button.innerHTML = originalHTML;
        refreshIcons();
      }
    },
    {
      enableHighAccuracy: false,
      timeout: 12000,
      maximumAge: 300000,
    },
  );
}

async function loadWeatherForCoordinates(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "wind_speed_10m",
      "shortwave_radiation",
      "surface_pressure",
    ].join(","),
    daily: [
      "temperature_2m_min",
      "temperature_2m_max",
      "shortwave_radiation_sum",
    ].join(","),
    timezone: "auto",
    forecast_days: "1",
  });

  const response = await fetch(
    `https://api.open-meteo.com/v1/forecast?${params}`,
  );

  if (!response.ok) {
    throw new Error("Weather service request failed.");
  }

  const data = await response.json();

  if (!data.current) {
    throw new Error("Current weather is unavailable.");
  }

  currentWeather = {
    latitude,
    longitude,
    timezone: data.timezone,
    time: data.current.time,
    temperature: data.current.temperature_2m,
    humidity: data.current.relative_humidity_2m,
    windKmh: data.current.wind_speed_10m,
    solar: data.current.shortwave_radiation,
    pressure: data.current.surface_pressure ?? null,
    temperatureMin: data.daily?.temperature_2m_min?.[0] ?? null,
    temperatureMax: data.daily?.temperature_2m_max?.[0] ?? null,
    shortwaveSum: data.daily?.shortwave_radiation_sum?.[0] ?? null,
    wbgt: null,
    wbgtDetails: null,
    city: "Your location",
  };

  try {
    const geoParams = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
    });

    const geoResponse = await fetch(`${API_URL}/reverse-geocode?${geoParams}`);

    if (geoResponse.ok) {
      const geoData = await geoResponse.json();

      if (geoData.city) {
        currentWeather.city = [geoData.city, geoData.region]
          .filter(Boolean)
          .filter((value, index, array) => array.indexOf(value) === index)
          .join(", ");
      }
    }
  } catch (error) {
    console.warn("Reverse geocoding unavailable:", error);
  }
  try {
    const wbgtResponse = await fetch(`${API_URL}/calculate-wbgt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude,
        longitude,
        local_time: currentWeather.time,
        timezone_name: currentWeather.timezone,
        air_temp_c: currentWeather.temperature,
        rh_pct: currentWeather.humidity,
        wind_kmh: currentWeather.windKmh,
        solar_wm2: currentWeather.solar ?? 0,
        pressure_hpa: currentWeather.pressure ?? 1013.25,
        urban: 1,
      }),
    });

    const wbgtResult = await wbgtResponse.json().catch(() => ({}));

    if (!wbgtResponse.ok) {
      throw new Error(wbgtResult.detail || "WBGT calculation request failed.");
    }

    currentWeather.wbgt = wbgtResult.wbgt_c ?? null;
    currentWeather.wbgtDetails = wbgtResult;
  } catch (error) {
    console.error("WBGT calculation failed:", error);
    currentWeather.wbgt = null;
    currentWeather.wbgtDetails = null;
  }

  renderWeather();
  updateAssessmentWeatherSummary();
}

function renderWeather() {
  if (!currentWeather) return;

  setText("#location-title", currentWeather.city);
  setText(
    "#location-subtitle",
    currentWeather.time
      ? `Current local readings · ${currentWeather.time}`
      : "Current environmental readings",
  );

  setText("#weather-temp", `${formatNumber(currentWeather.temperature)} °C`);
  setText("#weather-humidity", `${formatNumber(currentWeather.humidity, 0)} %`);
  setText("#weather-wind", `${formatNumber(currentWeather.windKmh)} km/h`);

  setText(
    "#weather-wbgt",
    currentWeather.wbgt == null
      ? "Unavailable"
      : `${formatNumber(currentWeather.wbgt, 2)} °C`,
  );

  setText(
    "#weather-wbgt-note",
    currentWeather.wbgt == null
      ? "WBGT calculation unavailable"
      : "Calculated WBGT · environmental estimate",
  );

  setText("#weather-temp-note", "Live weather reading");

  setWeatherStatus(
    currentWeather.wbgt == null
      ? "Live weather loaded, but WBGT could not be calculated. Check that FastAPI is running."
      : "Live weather and WBGT loaded. Select Prepare environmental data to apply available readings.",
  );
}

function setWeatherStatus(message) {
  setText("#weather-status", message);
}

function updateAssessmentWeatherSummary() {
  if (!currentWeather) return;

  setText("#assessment-city", currentWeather.city);
  setText("#assessment-temp", `${formatNumber(currentWeather.temperature)} °C`);
  setText(
    "#assessment-humidity",
    `${formatNumber(currentWeather.humidity, 0)} %`,
  );
  setText(
    "#assessment-wbgt",
    currentWeather.wbgt == null
      ? "Unavailable"
      : `${formatNumber(currentWeather.wbgt, 2)} °C`,
  );
}

function applyWeatherToForm() {
  if (!currentWeather) {
    showToast("Select Use my location first.");
    return;
  }

  const form = $("#assessment-form");
  if (!form) return;

  const values = {
    city: currentWeather.city,
    air_temp_c: currentWeather.temperature,
    rh_pct: currentWeather.humidity,
    wind_kmh: currentWeather.windKmh,
    solar_wm2: currentWeather.solar,
    temperature_max_v2_c: currentWeather.temperatureMax,
    estimated_wbgt: currentWeather.wbgt,
  };

  Object.entries(values).forEach(([name, value]) => {
    const input = form.elements.namedItem(name);

    if (
      input &&
      value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
    ) {
      input.value = value;
    }
  });

  updateAssessmentWeatherSummary();

  setWeatherStatus(
    "Available live readings applied. Other required environmental history and air-quality values are not automatically supplied.",
  );

  setText(
    "#form-message",
    "Live weather applied. Review the remaining required inputs before calculating.",
  );

  showToast("Available weather readings applied.");
}

// --------------------------------------------------
// Assessment form and API
// --------------------------------------------------

function initializeAssessment() {
  const form = $("#assessment-form");

  form?.addEventListener("submit", submitAssessment);

  form?.addEventListener("reset", () => {
    setTimeout(() => {
      setText("#form-message", "");
      latestAssessment = null;
      showResultPlaceholder();
    }, 0);
  });

  $("#load-demo")?.addEventListener("click", loadDemoData);
  $("#save-assessment")?.addEventListener("click", saveAssessment);
}

function setFormValue(form, name, value) {
  const fields = form.querySelectorAll(`[name="${name}"]`);

  fields.forEach((field) => {
    if (field.type === "checkbox") {
      field.checked = Boolean(value);
    } else {
      field.value = value ?? "";
    }
  });
}

function loadDemoData() {
  const form = $("#assessment-form");
  if (!form) return;

  const demo = {
    city: "Pune (demo)",
    air_temp_c: 38,
    rh_pct: 45,
    wind_kmh: 8,
    solar_wm2: 650,
    rain_last_24h_mm: 0,
    pm25_ugm3: 25,
    ozone_ppb: 20,
    no2_ppb: 15,
    estimated_wbgt: 29,
    night_min_c: 25,
    cumulative_heat_3d: 90,
    age: 22,
    gender: "Female",
    exertion_level: "Moderate",
    hydration_score: 0.7,
    temperature_max_v2_c: 39,
    wbgt_mean_v2_c: 27,
    wbgt_max_v2_c: 30,
    wbgt_min_v2_c: 24,
    shortwave_mean_v2_wm2: 400,
    shortwave_max_v2_wm2: 700,
    elevation_v2_m: 560,
  };

  Object.entries(demo).forEach(([name, value]) => {
    setFormValue(form, name, value);
  });

  [
    "pregnant",
    "chronic_condition",
    "heart_disease",
    "diabetes",
    "ckd",
    "diuretic",
    "beta_blocker",
    "outdoor_work",
    "acclimatized",
    "headache",
    "dizziness",
    "nausea",
  ].forEach((name) => setFormValue(form, name, false));

  setText(
    "#form-message",
    "Demo values loaded for testing. Environmental history and air-quality values are illustrative, not live measurements.",
  );

  showToast("Illustrative demo data loaded.");
}

function readFormPayload() {
  const form = $("#assessment-form");
  const formData = new FormData(form);
  const payload = {};

  const numericFields = [
    "air_temp_c",
    "rh_pct",
    "wind_kmh",
    "solar_wm2",
    "rain_last_24h_mm",
    "pm25_ugm3",
    "ozone_ppb",
    "no2_ppb",
    "estimated_wbgt",
    "night_min_c",
    "cumulative_heat_3d",
    "age",
    "hydration_score",
    "temperature_max_v2_c",
    "wbgt_mean_v2_c",
    "wbgt_max_v2_c",
    "wbgt_min_v2_c",
    "shortwave_mean_v2_wm2",
    "shortwave_max_v2_wm2",
    "elevation_v2_m",
  ];

  for (const [name, value] of formData.entries()) {
    if (numericFields.includes(name)) {
      if (String(value).trim() === "") {
        payload[name] = null;
      } else {
        const number = Number(value);

        if (!Number.isFinite(number)) {
          throw new Error(`Please enter a valid number for ${name}.`);
        }

        payload[name] = number;
      }
    } else {
      payload[name] = value;
    }
  }

  const booleanFields = [
    "pregnant",
    "chronic_condition",
    "heart_disease",
    "diabetes",
    "ckd",
    "diuretic",
    "beta_blocker",
    "outdoor_work",
    "acclimatized",
    "headache",
    "dizziness",
    "nausea",
  ];

  booleanFields.forEach((name) => {
    const field = form.elements.namedItem(name);

    payload[name] =
      field instanceof RadioNodeList
        ? field.value
          ? Number(field.value)
          : 0
        : field?.checked
          ? 1
          : 0;
  });

  if (payload.solar_wm2 == null) payload.solar_wm2 = 0;
  if (payload.hydration_score == null) payload.hydration_score = 0.5;

  return payload;
}


async function submitAssessment(event) {
  event.preventDefault();

  const form = $("#assessment-form");
  const button = $("#submit-assessment");
  const message = $("#form-message");

  if (!form || !button) {
    console.error("Assessment form or submit button not found.");
    return;
  }

  // Validate user-visible form fields.
  if (!form.checkValidity()) {
    const invalidField = form.querySelector(":invalid");

    if (invalidField) {
      message.textContent =
        `Please check ${invalidField.name || "the highlighted field"}: ` +
        invalidField.validationMessage;

      invalidField.reportValidity();
    }

    return;
  }

  let payload;

  try {
    payload = readFormPayload();
  } catch (error) {
    if (message) message.textContent = error.message;
    console.error("Could not read form data:", error);
    return;
  }

  const requiredModelFields = [
    "city",
    "air_temp_c",
    "rh_pct",
    "wind_kmh",
    "rain_last_24h_mm",
    "pm25_ugm3",
    "ozone_ppb",
    "no2_ppb",
    "estimated_wbgt",
    "night_min_c",
    "cumulative_heat_3d",
    "age",
    "gender",
    "exertion_level",
    "temperature_max_v2_c",
    "wbgt_mean_v2_c",
    "wbgt_max_v2_c",
    "wbgt_min_v2_c",
    "shortwave_mean_v2_wm2",
    "shortwave_max_v2_wm2",
    "elevation_v2_m",
  ];

  const missing = requiredModelFields.filter(
    (name) =>
      payload[name] === null ||
      payload[name] === undefined ||
      payload[name] === ""
  );

  if (missing.length > 0) {
    if (message) {
      message.textContent =
        `Missing required assessment data: ${missing.join(", ")}. ` +
        "Click Load demo data or complete the missing fields.";
    }

    console.warn("Missing model fields:", missing);
    return;
  }

  button.disabled = true;
  button.textContent = "Calculating…";

  if (message) {
    message.textContent = "Sending your assessment to HeatGuard…";
  }

  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    console.log("Prediction HTTP status:", response.status);
    console.log("Prediction API response:", result);

    if (!response.ok) {
      const detail =
        typeof result.detail === "string"
          ? result.detail
          : JSON.stringify(result.detail || result);

      throw new Error(detail || `API error (${response.status})`);
    }

    latestAssessment = {
      payload,
      result,
      timestamp: new Date().toISOString(),
    };

    console.log("Rendering prediction result...");
    renderResult(result);

    if (message) {
      message.textContent =
        "Assessment completed. This is an experimental estimate, not a clinical diagnosis.";
    }

    showToast("Assessment completed.");
  } catch (error) {
    console.error("Assessment request or rendering failed:", error);

    if (message) {
      message.textContent =
        `Could not complete or display the assessment: ${error.message}`;
    }
  } finally {
    button.disabled = false;
    button.innerHTML =
      '<i data-lucide="activity"></i> Calculate Estimate';

    refreshIcons();
  }
}


// --------------------------------------------------
// Results and recommendations
// --------------------------------------------------


function renderResult(result) {
  if ($("#result-placeholder")) {
    $("#result-placeholder").hidden = true;
  }

  if ($("#result-content")) {
    $("#result-content").hidden = false;
  }

  const score = getScore(result);
  const level = getRiskLevel(result, score);

  setText("#result-score", score === null ? "—" : String(score));
  setText("#result-level", level);
  setText(
    "#result-caption",
    result.disclaimer ||
      "Experimental model output; not a clinical assessment.",
  );

  const gauge = $("#risk-gauge");

  if (gauge && score !== null) {
    gauge.style.setProperty("--risk-score", `${score}%`);
  }

  const factors = findFirst(result, [
    "top_factors",
    "shap_values",
    "factors",
    "contributing_factors",
    "feature_importance",
    "explanations",
  ]);

  // Render the actual explanations returned by the backend.
  renderFactors("#result-factors", factors);

  // Show the explanation section only when real factors exist.
  const factorsContainer = $("#result-factors");
  const factorsHeading = factorsContainer?.previousElementSibling;
  const factorsDivider = factorsHeading?.previousElementSibling;

  const hasFactors =
    Array.isArray(factors) && factors.length > 0;

  if (factorsContainer) {
    factorsContainer.hidden = !hasFactors;
  }

  if (factorsHeading?.tagName === "H4") {
    factorsHeading.hidden = !hasFactors;
  }

  if (factorsDivider?.classList.contains("result-divider")) {
    factorsDivider.hidden = !hasFactors;
  }

  const recommendations = findFirst(result, [
    "recommendations",
    "suggestions",
    "next_steps",
  ]);

  renderRecommendations(recommendations);

  setText("#summary-score", score === null ? "—" : String(score));

  setText(
    "#summary-score-note",
    score === null
      ? "The API did not return a recognized score."
      : `Reported risk level: ${level}`,
  );

  updateDashboard();
}

function renderFactors(selector, factors) {
  const container = $(selector);
  if (!container) return;

  container.replaceChildren();

  if (!Array.isArray(factors) || factors.length === 0) {
    return;
  }

  factors.slice(0, 6).forEach((item) => {
    if (!item || typeof item !== "object") return;

    const name = item.feature || item.name || item.label || "Factor";

    const direction = item.direction;
    const explanation = item.explanation;

    const directionText =
      direction === "increases_risk"
        ? "Pushes the model estimate higher"
        : direction === "decreases_risk"
          ? "Pushes the model estimate lower"
          : "No directional contribution";

    const card = document.createElement("div");
    card.className = "factor-item";

    const title = document.createElement("strong");
    title.textContent = name;

    const detail = document.createElement("p");
    detail.textContent = explanation || directionText;

    card.append(title, detail);
    container.appendChild(card);
  });
}

function renderRecommendations(recommendations) {
  const container = $("#result-recommendations");
  if (!container) return;

  const defaults = [
    "Move to a cooler or shaded place when possible.",
    "Drink water regularly, following any personal medical fluid restrictions.",
    "Reduce strenuous activity during hot conditions.",
  ];

  const items = Array.isArray(recommendations)
    ? recommendations
    : typeof recommendations === "string"
      ? [recommendations]
      : defaults;

  container.replaceChildren();

  items.slice(0, 5).forEach((item) => {
    const text =
      typeof item === "string"
        ? item
        : item?.text ||
          item?.recommendation ||
          item?.message ||
          "";

    if (!text) return;

    const paragraph = document.createElement("p");
    paragraph.className = "recommendation-item";
    paragraph.textContent = text;
    container.appendChild(paragraph);
  });
}

function showResultPlaceholder() {
  if ($("#result-placeholder")) {
    $("#result-placeholder").hidden = false;
  }

  if ($("#result-content")) {
    $("#result-content").hidden = true;
  }
}


// --------------------------------------------------
// Local history and dashboard
// --------------------------------------------------

function saveAssessment() {
  if (!latestAssessment) {
    showToast("Complete an assessment first.");
    return;
  }

  const history = getHistory();

  history.push({
    timestamp: latestAssessment.timestamp,
    result: latestAssessment.result,
    payload: latestAssessment.payload,
  });

  setHistory(history);
  updateDashboard();
  showToast("Assessment saved on this device.");
}

function updateDashboard() {
  const history = getHistory();
  const latest = latestAssessment || history[history.length - 1];

  setText("#summary-count", String(history.length));

  if (latest) {
    const result = latest.result || {};
    const score = getScore(result);
    const level = getRiskLevel(result, score);

    setText("#summary-score", score === null ? "—" : String(score));
    setText(
      "#summary-score-note",
      score === null
        ? "No recognized score available"
        : `Latest estimate: ${level}`,
    );
  }

  renderHistoryTable(history);
  renderHistoryChart(history);
}

function renderHistoryTable(history) {
  const container = $("#history-table-container");
  if (!container) return;

  if (!history.length) {
    container.innerHTML = `
      <div class="empty-state">
        <strong>No saved assessments</strong>
        <p>Your saved records will appear here.</p>
      </div>`;
    return;
  }

  const rows = history
    .slice(-8)
    .reverse()
    .map((item) => {
      const result = item.result || {};
      const score = getScore(result);
      const level = getRiskLevel(result, score);
      const date = new Date(item.timestamp).toLocaleString();

      return `
        <tr>
          <td>${escapeHTML(date)}</td>
          <td>${score === null ? "—" : score}</td>
          <td>${escapeHTML(level)}</td>
        </tr>`;
    })
    .join("");

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr><th>Date</th><th>Score</th><th>Level</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderHistoryChart(history) {
  const canvas = $("#history-chart");
  const empty = $("#history-empty");

  if (!canvas || !window.Chart) return;

  const points = history
    .map((item) => ({
      date: new Date(item.timestamp).toLocaleDateString(),
      score: getScore(item.result || {}),
    }))
    .filter((item) => item.score !== null);

  if (!points.length) {
    if (empty) empty.hidden = false;

    if (historyChart) {
      historyChart.destroy();
      historyChart = null;
    }

    return;
  }

  if (empty) empty.hidden = true;
  if (historyChart) historyChart.destroy();

  historyChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: points.map((item) => item.date),
      datasets: [
        {
          label: "Model score",
          data: points.map((item) => item.score),
          borderColor: "#399b83",
          backgroundColor: "rgba(57, 155, 131, 0.12)",
          fill: true,
          tension: 0.3,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          min: 0,
          max: 100,
          title: { display: true, text: "Score" },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

// --------------------------------------------------
// Scenario explorer and history controls
// --------------------------------------------------

function initializeInsights() {
  const temperature = $("#scenario-temperature");

  temperature?.addEventListener("input", () => {
    setText("#scenario-temperature-value", `${temperature.value}°C`);
  });

  $("#run-scenario")?.addEventListener("click", runScenario);

  $("#clear-history")?.addEventListener("click", () => {
    if (!confirm("Clear all saved assessments from this browser?")) return;

    localStorage.removeItem(HISTORY_KEY);
    updateDashboard();
    showToast("Local history cleared.");
  });
}

async function runScenario() {
  if (!latestAssessment) {
    setText("#scenario-result", "Complete an assessment first.");
    return;
  }

  const temperatureInput = $("#scenario-temperature");
  const exertionInput = $("#scenario-exertion");

  if (!temperatureInput || !exertionInput) {
    setText("#scenario-result", "Scenario controls are unavailable.");
    return;
  }

  const payload = { ...latestAssessment.payload };
  payload.air_temp_c = Number(temperatureInput.value);
  payload.exertion_level = exertionInput.value;

  const container = $("#scenario-result");
  if (!container) return;

  container.textContent = "Calculating scenario…";

  try {
    const response = await fetch(`${API_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        typeof result.detail === "string"
          ? result.detail
          : "Scenario request failed.",
      );
    }

    const score = getScore(result);

    container.textContent =
      score !== null
        ? `Scenario estimate: ${score}/100 at ${payload.air_temp_c}°C with ${payload.exertion_level.toLowerCase()} exertion. This is an experimental comparison, not a forecast.`
        : "The API returned a scenario result but no recognized score field.";
  } catch (error) {
    container.textContent = `Could not calculate scenario: ${error.message}`;
  }
}

// --------------------------------------------------
// Safety guide and profile
// --------------------------------------------------

function initializeSafetyGuide() {
  document.querySelectorAll(".safety-check").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      checkbox
        .closest(".safety-card")
        ?.classList.toggle("reviewed", checkbox.checked);
    });
  });
}

function initializeProfileButton() {
  $("#profile-button")?.addEventListener("click", () => {
    alert(
      "HeatGuard is an experimental AI-assisted prototype. Its estimate is not a diagnosis and should not replace official heat warnings or medical advice.",
    );
  });
}
