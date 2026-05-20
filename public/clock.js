// Clock In/Out System with Real-time Tracking
// Uses localStorage to persist shift data

// Configuration
const STORAGE_KEYS = {
  CURRENT_SHIFT: "foodbank_current_shift",
  SHIFT_HISTORY: "foodbank_shift_history",
  STAFF_NAME: "foodbank_staff_name",
};

// Global Variables
let timerInterval = null;
let breakInterval = null;
let currentShift = null;
let isOnBreak = false;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener("DOMContentLoaded", function () {
  // Check which page we're on
  const clockInBtn = document.getElementById("clockInBtn");
  const clockOutBtn = document.getElementById("clockOutBtn");

  if (clockInBtn) {
    // We're on the clock-in page
    initClockInPage();
  } else if (clockOutBtn) {
    // We're on the clocked-in page
    initClockedInPage();
  }
});

// ============================================
// CLOCK IN PAGE FUNCTIONS
// ============================================

function initClockInPage() {
  // Update current time display
  updateCurrentTimeDisplay();
  setInterval(updateCurrentTimeDisplay, 1000);

  // Load and display shift history
  displayShiftHistory();

  // Set up clock in button
  const clockInBtn = document.getElementById("clockInBtn");
  const staffNameInput = document.getElementById("staffName");

  // Pre-fill name if stored
  const savedName = localStorage.getItem(STORAGE_KEYS.STAFF_NAME);
  if (savedName) {
    staffNameInput.value = savedName;
  }

  clockInBtn.addEventListener("click", handleClockIn);

  // Allow Enter key to clock in
  staffNameInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
      handleClockIn();
    }
  });
}

function updateCurrentTimeDisplay() {
  const now = new Date();
  const dateElement = document.getElementById("currentDate");
  const timeElement = document.getElementById("currentTime");

  if (dateElement) {
    dateElement.textContent = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (timeElement) {
    timeElement.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

function handleClockIn() {
  const staffNameInput = document.getElementById("staffName");
  const staffName = staffNameInput.value.trim();

  if (!staffName) {
    alert("Please enter your name before clocking in.");
    staffNameInput.focus();
    return;
  }

  // Save staff name
  localStorage.setItem(STORAGE_KEYS.STAFF_NAME, staffName);

  // Create new shift
  const shift = {
    id: Date.now(),
    staffName: staffName,
    clockInTime: new Date().toISOString(),
    clockOutTime: null,
    breakDuration: 0,
    breakStartTime: null,
  };

  // Save to localStorage
  localStorage.setItem(STORAGE_KEYS.CURRENT_SHIFT, JSON.stringify(shift));

  // Redirect to clocked-in page
  window.location.href = "clocked_in.html";
}

function displayShiftHistory() {
  const historyContainer = document.getElementById("shiftHistory");
  if (!historyContainer) return;

  const history = getShiftHistory();
  const today = new Date().toDateString();
  const todayShifts = history.filter((shift) => {
    const shiftDate = new Date(shift.clockInTime).toDateString();
    return shiftDate === today && shift.clockOutTime;
  });

  if (todayShifts.length === 0) {
    historyContainer.innerHTML = `
            <div class="text-center text-muted py-4">
                <i class="bi bi-inbox display-4 d-block mb-2"></i>
                <p>No completed shifts today</p>
            </div>
        `;
    return;
  }

  let html = '<div class="list-group">';
  todayShifts.reverse().forEach((shift) => {
    const duration = calculateShiftDuration(shift);
    const clockIn = new Date(shift.clockInTime).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });
    const clockOut = new Date(shift.clockOutTime).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    });

    html += `
            <div class="list-group-item">
                <div class="d-flex justify-content-between align-items-center">
                    <div>
                        <h6 class="mb-1">${shift.staffName}</h6>
                        <small class="text-muted">
                            ${clockIn} - ${clockOut}
                        </small>
                    </div>
                    <div class="text-end">
                        <span class="badge bg-success">${duration}</span>
                        ${shift.breakDuration > 0 ? `<br><small class="text-muted">Break: ${Math.round(shift.breakDuration / 60000)}m</small>` : ""}
                    </div>
                </div>
            </div>
        `;
  });
  html += "</div>";

  historyContainer.innerHTML = html;
}

// ============================================
// CLOCKED IN PAGE FUNCTIONS
// ============================================

function initClockedInPage() {
  // Load current shift
  currentShift = getCurrentShift();

  if (!currentShift) {
    // No active shift, redirect back
    alert("No active shift found. Please clock in first.");
    window.location.href = "clock_in.html";
    return;
  }

  // Display shift information
  displayShiftInfo();

  // Start the timer
  startTimer();

  // Update current time display
  updateClockedInTimeDisplay();
  setInterval(updateClockedInTimeDisplay, 1000);

  // Set up buttons
  document
    .getElementById("clockOutBtn")
    .addEventListener("click", handleClockOut);
  const breakBtn = document.getElementById("breakBtn");
  if (breakBtn) {
    breakBtn.addEventListener("click", handleBreak);
  }
}

function displayShiftInfo() {
  const displayNameEl = document.getElementById("displayName");
  const clockInTimeEl = document.getElementById("clockInTime");
  const shiftNameEl = document.getElementById("shiftName");
  const shiftDateEl = document.getElementById("shiftDate");
  const shiftStartTimeEl = document.getElementById("shiftStartTime");

  const clockInDate = new Date(currentShift.clockInTime);

  if (displayNameEl) displayNameEl.textContent = currentShift.staffName;
  if (shiftNameEl) shiftNameEl.textContent = currentShift.staffName;

  if (clockInTimeEl) {
    clockInTimeEl.textContent = clockInDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  if (shiftDateEl) {
    shiftDateEl.textContent = clockInDate.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  if (shiftStartTimeEl) {
    shiftStartTimeEl.textContent = clockInDate.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

function startTimer() {
  updateTimer();
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  const now = new Date();
  const clockInTime = new Date(currentShift.clockInTime);
  let totalElapsed = now - clockInTime;

  // Subtract break time
  let breakDuration = currentShift.breakDuration || 0;
  if (currentShift.breakStartTime) {
    // Currently on break, calculate current break duration
    const breakStart = new Date(currentShift.breakStartTime);
    breakDuration += now - breakStart;
  }

  const workingTime = totalElapsed - breakDuration;

  // Calculate hours, minutes, seconds
  const hours = Math.floor(workingTime / (1000 * 60 * 60));
  const minutes = Math.floor((workingTime % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((workingTime % (1000 * 60)) / 1000);

  // Update display
  document.getElementById("hours").textContent = padZero(hours);
  document.getElementById("minutes").textContent = padZero(minutes);
  document.getElementById("seconds").textContent = padZero(seconds);

  // Update break time display
  const breakMinutes = Math.floor(breakDuration / (1000 * 60));
  const breakTimeEl = document.getElementById("breakTime");
  if (breakTimeEl) {
    breakTimeEl.textContent = `${breakMinutes} minutes`;
  }

  // Update working time display
  const workingTimeEl = document.getElementById("workingTime");
  if (workingTimeEl) {
    const workHours = Math.floor(workingTime / (1000 * 60 * 60));
    const workMinutes = Math.floor(
      (workingTime % (1000 * 60 * 60)) / (1000 * 60),
    );
    workingTimeEl.textContent = `${workHours}h ${workMinutes}m`;
  }

  // Update stats
  updateStats();
}

function updateClockedInTimeDisplay() {
  const currentTimeEl = document.getElementById("currentTime");
  if (currentTimeEl) {
    const now = new Date();
    currentTimeEl.textContent = now.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
}

function handleBreak() {
  const breakBtn = document.getElementById("breakBtn");
  const breakBtnText = document.getElementById("breakBtnText");

  if (!currentShift.breakStartTime) {
    // Start break
    currentShift.breakStartTime = new Date().toISOString();
    isOnBreak = true;

    breakBtn.classList.remove("btn-outline-secondary");
    breakBtn.classList.add("btn-warning");
    breakBtnText.textContent = "End Break";

    // Update localStorage
    localStorage.setItem(
      STORAGE_KEYS.CURRENT_SHIFT,
      JSON.stringify(currentShift),
    );
  } else {
    // End break
    const breakStart = new Date(currentShift.breakStartTime);
    const breakEnd = new Date();
    const breakDuration = breakEnd - breakStart;

    currentShift.breakDuration =
      (currentShift.breakDuration || 0) + breakDuration;
    currentShift.breakStartTime = null;
    isOnBreak = false;

    breakBtn.classList.remove("btn-warning");
    breakBtn.classList.add("btn-outline-secondary");
    breakBtnText.textContent = "Take Break";

    // Update localStorage
    localStorage.setItem(
      STORAGE_KEYS.CURRENT_SHIFT,
      JSON.stringify(currentShift),
    );
  }
}

function handleClockOut() {
  if (!confirm("Are you sure you want to clock out?")) {
    return;
  }

  // Stop timer
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  // End break if currently on break
  if (currentShift.breakStartTime) {
    const breakStart = new Date(currentShift.breakStartTime);
    const breakEnd = new Date();
    currentShift.breakDuration =
      (currentShift.breakDuration || 0) + (breakEnd - breakStart);
    currentShift.breakStartTime = null;
  }

  // Set clock out time
  currentShift.clockOutTime = new Date().toISOString();

  // Save to history
  saveToHistory(currentShift);

  // Clear current shift
  localStorage.removeItem(STORAGE_KEYS.CURRENT_SHIFT);

  // Calculate final duration
  const duration = calculateShiftDuration(currentShift);
  const workingTime = calculateWorkingTime(currentShift);

  // Show summary
  alert(
    `Shift Complete!\n\nTotal Time: ${duration}\nWorking Time: ${workingTime}\n\nThank you for your service!`,
  );

  // Redirect to clock in page
  window.location.href = "clock_in.html";
}

function updateStats() {
  const weekHoursEl = document.getElementById("weekHours");
  const monthHoursEl = document.getElementById("monthHours");

  if (!weekHoursEl || !monthHoursEl) return;

  const history = getShiftHistory();
  const now = new Date();

  // Calculate week hours
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);

  let weekTotal = 0;
  history.forEach((shift) => {
    if (!shift.clockOutTime) return;
    const shiftDate = new Date(shift.clockInTime);
    if (shiftDate >= weekStart) {
      weekTotal += getShiftWorkingDuration(shift);
    }
  });

  // Calculate month hours
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  let monthTotal = 0;
  history.forEach((shift) => {
    if (!shift.clockOutTime) return;
    const shiftDate = new Date(shift.clockInTime);
    if (shiftDate >= monthStart) {
      monthTotal += getShiftWorkingDuration(shift);
    }
  });

  weekHoursEl.textContent = formatDuration(weekTotal);
  monthHoursEl.textContent = formatDuration(monthTotal);
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function getCurrentShift() {
  const shiftData = localStorage.getItem(STORAGE_KEYS.CURRENT_SHIFT);
  return shiftData ? JSON.parse(shiftData) : null;
}

function getShiftHistory() {
  const historyData = localStorage.getItem(STORAGE_KEYS.SHIFT_HISTORY);
  return historyData ? JSON.parse(historyData) : [];
}

function saveToHistory(shift) {
  const history = getShiftHistory();
  history.push(shift);

  // Keep only last 100 shifts
  if (history.length > 100) {
    history.shift();
  }

  localStorage.setItem(STORAGE_KEYS.SHIFT_HISTORY, JSON.stringify(history));
}

function calculateShiftDuration(shift) {
  if (!shift.clockOutTime) return "0h 0m";

  const clockIn = new Date(shift.clockInTime);
  const clockOut = new Date(shift.clockOutTime);
  const duration = clockOut - clockIn;

  return formatDuration(duration);
}

function calculateWorkingTime(shift) {
  if (!shift.clockOutTime) return "0h 0m";

  const workingDuration = getShiftWorkingDuration(shift);
  return formatDuration(workingDuration);
}

function getShiftWorkingDuration(shift) {
  if (!shift.clockOutTime) return 0;

  const clockIn = new Date(shift.clockInTime);
  const clockOut = new Date(shift.clockOutTime);
  const totalDuration = clockOut - clockIn;
  const breakDuration = shift.breakDuration || 0;

  return totalDuration - breakDuration;
}

function formatDuration(milliseconds) {
  const hours = Math.floor(milliseconds / (1000 * 60 * 60));
  const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

function padZero(num) {
  return num.toString().padStart(2, "0");
}
