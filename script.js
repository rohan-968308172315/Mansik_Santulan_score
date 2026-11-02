/* ==========================================================
   MindMetric – Mental Health Score Predictor
   Talks to the FastAPI backend: POST /predict
   ========================================================== */

// Change this if your API runs on a different host or port.
const API_BASE_URL = "https://mansik-santulan-score-adn9.onrender.com/";
const REQUEST_TIMEOUT_MS = 20000;

// Score is shown out of 10 on the gauge.
const SCORE_MAX = 10;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 58; // matches r="58" in index.html

// ---------- Element references ----------
const form = document.getElementById("predict-form");
const submitBtn = document.getElementById("submit-btn");
const resetBtn = document.getElementById("reset-btn");
const retryBtn = document.getElementById("retry-btn");

const states = {
  idle: document.getElementById("state-idle"),
  loading: document.getElementById("state-loading"),
  result: document.getElementById("state-result"),
  error: document.getElementById("state-error"),
};

const gaugeValue = document.getElementById("gauge-value");
const scoreNumber = document.getElementById("score-number");
const scoreBand = document.getElementById("score-band");
const scoreMessage = document.getElementById("score-message");
const errorMessage = document.getElementById("error-message");
const resultPanel = document.getElementById("result-panel");

const apiStatus = document.getElementById("api-status");
document.getElementById("footer-api").textContent = `${API_BASE_URL}/predict`;

// ---------- UI state helpers ----------
function showState(name) {
  Object.entries(states).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("is-loading", isLoading);
  submitBtn.querySelector(".btn-label").textContent = isLoading
    ? "Predicting…"
    : "Predict score";
}

function scrollToResultIfNeeded() {
  // On narrow screens the result card sits above the form.
  if (window.matchMedia("(max-width: 960px)").matches) {
    resultPanel.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ---------- Score interpretation ----------
// Assumes a 0–10 scale where a higher score means better mental health.
function describeScore(score) {
  if (score >= 7.5) {
    return {
      tone: "good",
      band: "Healthy balance",
      message: "Your habits point to a strong mental health score. Keep protecting your sleep and routine.",
    };
  }
  if (score >= 5.5) {
    return {
      tone: "mid",
      band: "Moderate",
      message: "Some habits may be affecting wellbeing. Small changes to screen time, sleep or activity could help.",
    };
  }
  return {
    tone: "low",
    band: "Needs attention",
    message: "These habits are linked with a lower score. Consider cutting screen time, sleeping more and talking to someone you trust.",
  };
}

// ---------- Result rendering ----------
function animateNumber(el, target, duration = 1200) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    el.textContent = target.toFixed(2);
    return;
  }
  const start = performance.now();
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = (target * eased).toFixed(2);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function renderResult(score) {
  const info = describeScore(score);

  states.result.classList.remove("tone-good", "tone-mid", "tone-low");
  states.result.classList.add(`tone-${info.tone}`);
  scoreBand.textContent = info.band;
  scoreMessage.textContent = info.message;

  showState("result");

  // Reset the ring, then animate to the new value.
  gaugeValue.style.transition = "none";
  gaugeValue.style.strokeDasharray = GAUGE_CIRCUMFERENCE;
  gaugeValue.style.strokeDashoffset = GAUGE_CIRCUMFERENCE;
  void gaugeValue.getBoundingClientRect(); // force reflow
  gaugeValue.style.transition = "";

  const ratio = Math.max(0, Math.min(score / SCORE_MAX, 1));
  requestAnimationFrame(() => {
    gaugeValue.style.strokeDashoffset = GAUGE_CIRCUMFERENCE * (1 - ratio);
  });

  animateNumber(scoreNumber, score);
  scrollToResultIfNeeded();
}

function renderError(message) {
  errorMessage.textContent = message;
  showState("error");
  scrollToResultIfNeeded();
}

// ---------- Validation ----------
function validateForm() {
  let valid = true;
  let firstInvalid = null;

  form.querySelectorAll(".field").forEach((field) => {
    const control = field.querySelector("input[name], select[name]");
    const ok = control.checkValidity();
    field.classList.toggle("invalid", !ok);
    if (!ok) {
      valid = false;
      firstInvalid = firstInvalid || control;
    }
  });

  const segmented = form.querySelector(".segmented");
  const stressChosen = form.querySelector('input[name="stress_level"]:checked');
  segmented.classList.toggle("invalid", !stressChosen);
  if (!stressChosen) {
    valid = false;
    firstInvalid = firstInvalid || segmented.querySelector("input");
  }

  if (firstInvalid) firstInvalid.focus();
  return valid;
}

// ---------- Build payload (matches the StudentData model) ----------
function buildPayload() {
  const data = new FormData(form);
  return {
    age: parseInt(data.get("age"), 10),
    gender: data.get("gender"),
    country: data.get("country").trim(),
    academic_level: data.get("academic_level"),
    most_used_platform: data.get("most_used_platform"),
    purpose_of_use: data.get("purpose_of_use"),
    avg_daily_usage_hours: parseFloat(data.get("avg_daily_usage_hours")),
    daily_unlocks: parseInt(data.get("daily_unlocks"), 10),
    study_hours: parseFloat(data.get("study_hours")),
    physical_activity_hours: parseFloat(data.get("physical_activity_hours")),
    sleep_hours_per_night: parseFloat(data.get("sleep_hours_per_night")),
    stress_level: data.get("stress_level"),
  };
}

// ---------- API ----------
async function requestPrediction(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    console.log("Sending payload:", payload);
    const response = await fetch(`${API_BASE_URL}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await readApiError(response));
    }

    const result = await response.json();
    const score = Number(result.predicted_mental_health_score);
    if (Number.isNaN(score)) {
      throw new Error("The API replied, but the score was missing from the response.");
    }
    return score;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error("The request took too long. Check that the API is running and try again.");
    }
    if (err instanceof TypeError) {
      throw new Error(
        `Can't reach the API at ${API_BASE_URL}. Make sure uvicorn is running and CORS is enabled.`
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Turn FastAPI error bodies (422 validation, 500, etc.) into readable text.
async function readApiError(response) {
  try {
    const body = await response.json();
    console.error("API error response:", body);
    if (Array.isArray(body.detail)) {
      return body.detail
        .map((d) => `${(d.loc || []).slice(1).join(".") || "input"}: ${d.msg} (got ${JSON.stringify(d.input)})`)
        .join(" • ");
    }
    if (typeof body.detail === "string") return body.detail;
  } catch (_) {
    /* body was not JSON */
  }
  return `The API returned an error (HTTP ${response.status}).`;
}

async function checkApiStatus() {
  try {
    const res = await fetch(`${API_BASE_URL}/`, { method: "GET" });
    if (!res.ok) throw new Error();
    apiStatus.textContent = "API online";
    apiStatus.className = "api-status online";
  } catch (_) {
    apiStatus.textContent = "API offline";
    apiStatus.className = "api-status offline";
  }
}

// ---------- Events ----------
async function handleSubmit(event) {
  event.preventDefault();
  if (!validateForm()) return;

  setLoading(true);
  showState("loading");
  scrollToResultIfNeeded();

  try {
    const score = await requestPrediction(buildPayload());
    renderResult(score);
    apiStatus.textContent = "API online";
    apiStatus.className = "api-status online";
  } catch (err) {
    renderError(err.message);
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", handleSubmit);

form.addEventListener("reset", () => {
  form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  showState("idle");
});

retryBtn.addEventListener("click", () => form.requestSubmit());

// Clear the red error style as soon as the user fixes a field.
form.addEventListener("input", (event) => {
  const field = event.target.closest(".field");
  if (field && event.target.checkValidity()) field.classList.remove("invalid");
  if (event.target.name === "stress_level") {
    form.querySelector(".segmented").classList.remove("invalid");
  }
});

// ---------- Init ----------
showState("idle");
checkApiStatus();
