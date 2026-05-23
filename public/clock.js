// Configuration Keys
const STORAGE_KEYS = {
  CURRENT_SHIFT_ID: "foodbank_mongo_shift_id",
  STAFF_NAME: "foodbank_staff_name",
};

let timerInterval = null;
let currentShift = null;

document.addEventListener("DOMContentLoaded", function () {
  const clockInBtn = document.getElementById("clockInBtn");
  const clockOutBtn = document.getElementById("clockOutBtn");

  if (clockInBtn) {
    initClockInPage();
  } else if (clockOutBtn) {
    initClockedInPage();
  }
});

// ============================================
// CLOCK IN PAGE LOGIC
// ============================================

function initClockInPage() {
  updateCurrentTimeDisplay();
  setInterval(updateCurrentTimeDisplay, 1000);
  displayShiftHistory();

  const clockInBtn = document.getElementById("clockInBtn");
  const staffNameInput = document.getElementById("staffName");

  const savedName = localStorage.getItem(STORAGE_KEYS.STAFF_NAME);
  if (savedName && staffNameInput) {
    staffNameInput.value = savedName;
  }

  if (clockInBtn) {
    clockInBtn.addEventListener("click", handleClockIn);
  }
}

function updateCurrentTimeDisplay() {
  const now = new Date();
  const dateElement = document.getElementById("currentDate");
  const timeElement = document.getElementById("currentTime");

  if (dateElement)
    dateElement.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  if (timeElement)
    timeElement.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
}

async function handleClockIn() {
  const staffNameInput = document.getElementById("staffName");
  const staffName = staffNameInput ? staffNameInput.value.trim() : "";

  if (!staffName) {
    alert("Please enter your name before clocking in.");
    return;
  }

  try {
    const response = await fetch("/api/clock/in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ staffName }),
    });

    const data = await response.json();

    if (data.success) {
      localStorage.setItem(STORAGE_KEYS.STAFF_NAME, staffName);
      localStorage.setItem(STORAGE_KEYS.CURRENT_SHIFT_ID, data.shift._id);
      window.location.href = "/clocked-in";
    } else {
      alert("Clock-in failed: " + data.error);
    }
  } catch (error) {
    console.error("Error connecting to server:", error);
  }
}

async function displayShiftHistory() {
  const historyContainer = document.getElementById("shiftHistory");
  if (!historyContainer) return;

  try {
    const response = await fetch("/api/clock/history");
    const todayShifts = await response.json();

    if (!todayShifts || todayShifts.length === 0) {
      historyContainer.innerHTML = `
        <div class="text-center text-muted py-4">
            <i class="bi bi-inbox display-4 d-block mb-2"></i>
            <p>No completed shifts today</p>
        </div>`;
      return;
    }

    let html = '<div class="list-group">';
    todayShifts.forEach((shift) => {
      const totalDur =
        new Date(shift.clockOutTime) - new Date(shift.clockInTime);
      const workingDur = totalDur - (shift.breakDuration || 0);

      const clockIn = new Date(shift.clockInTime).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const clockOut = new Date(shift.clockOutTime).toLocaleTimeString(
        "en-US",
        { hour: "2-digit", minute: "2-digit" },
      );

      html += `
        <div class="list-group-item">
            <div class="d-flex justify-content-between align-items-center">
                <div>
                    <h6 class="mb-1">${shift.staffName}</h6>
                    <small class="text-muted">${clockIn} - ${clockOut}</small>
                </div>
                <div class="text-end">
                    <span class="badge bg-success">${formatDuration(workingDur)}</span>
                    ${shift.breakDuration > 0 ? `<br><small class="text-muted">Break: ${Math.round(shift.breakDuration / 60000)}m</small>` : ""}
                </div>
            </div>
        </div>`;
    });
    html += "</div>";
    historyContainer.innerHTML = html;
  } catch (error) {
    console.error("Error rendering history list:", error);
  }
}

// ============================================
// CLOCKED IN TRACKING PAGE LOGIC
// ============================================

function initClockedInPage() {
  const currentShiftId = localStorage.getItem(STORAGE_KEYS.CURRENT_SHIFT_ID);

  if (!currentShiftId) {
    alert("No active shift found. Please clock in first.");
    window.location.href = "/clock";
    return;
  }

  currentShift = {
    id: currentShiftId,
    staffName: localStorage.getItem(STORAGE_KEYS.STAFF_NAME) || "Staff Member",
    clockInTime: new Date().toISOString(), // Baseline fallback UI reference point
    breakDuration: 0,
    breakStartTime: null,
  };

  displayShiftInfo();
  startTimer();

  document
    .getElementById("clockOutBtn")
    .addEventListener("click", handleClockOut);
  const breakBtn = document.getElementById("breakBtn");
  if (breakBtn) breakBtn.addEventListener("click", handleBreak);
}

function displayShiftInfo() {
  const displayNameEl = document.getElementById("displayName");
  const shiftNameEl = document.getElementById("shiftName");
  if (displayNameEl) displayNameEl.textContent = currentShift.staffName;
  if (shiftNameEl) shiftNameEl.textContent = currentShift.staffName;
}

function startTimer() {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const now = new Date();
  const clockInTime = new Date(currentShift.clockInTime);
  let totalElapsed = now - clockInTime;

  let breakDuration = currentShift.breakDuration || 0;
  if (currentShift.breakStartTime) {
    breakDuration += now - new Date(currentShift.breakStartTime);
  }

  const workingTime = Math.max(0, totalElapsed - breakDuration);

  const hours = Math.floor(workingTime / (1000 * 60 * 60));
  const minutes = Math.floor((workingTime % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((workingTime % (1000 * 60)) / 1000);

  const hoursEl = document.getElementById("hours");
  const minutesEl = document.getElementById("minutes");
  const secondsEl = document.getElementById("seconds");

  if (hoursEl) hoursEl.textContent = padZero(hours);
  if (minutesEl) minutesEl.textContent = padZero(minutes);
  if (secondsEl) secondsEl.textContent = padZero(seconds);
}

async function handleBreak() {
  const breakBtn = document.getElementById("breakBtn");
  const breakBtnText = document.getElementById("breakBtnText");
  const action = !currentShift.breakStartTime ? "start" : "end";

  try {
    const response = await fetch("/api/clock/break", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId: currentShift.id, action }),
    });

    const data = await response.json();

    if (data.success) {
      currentShift.breakStartTime = data.shift.breakStartTime;
      currentShift.breakDuration = data.shift.breakDuration;

      if (action === "start") {
        breakBtn.classList.remove("btn-outline-secondary");
        breakBtn.classList.add("btn-warning");
        breakBtnText.textContent = "End Break";
      } else {
        breakBtn.classList.remove("btn-warning");
        breakBtn.classList.add("btn-outline-secondary");
        breakBtnText.textContent = "Take Break";
      }
    }
  } catch (error) {
    console.error("Error synced break status payload:", error);
  }
}

async function handleClockOut() {
  if (!confirm("Are you sure you want to clock out?")) return;

  if (timerInterval) clearInterval(timerInterval);

  try {
    const response = await fetch("/api/clock/out", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shiftId: currentShift.id }),
    });

    const data = await response.json();

    if (data.success) {
      localStorage.removeItem(STORAGE_KEYS.CURRENT_SHIFT_ID);

      const totalDur =
        new Date(data.shift.clockOutTime) - new Date(data.shift.clockInTime);
      const workingDur = totalDur - data.shift.breakDuration;

      alert(
        `Shift Complete!\n\nWorking Time: ${formatDuration(workingDur)}\n\nThank you for your service!`,
      );
      window.location.href = "/clock";
    } else {
      alert("Error logging checkout status: " + data.error);
    }
  } catch (error) {
    console.error(
      "Error communicating closeout actions with database server:",
      error,
    );
  }
}

function formatDuration(milliseconds) {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function padZero(num) {
  return num.toString().padStart(2, "0");
}
