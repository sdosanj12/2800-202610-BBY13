/**
 * Reports Chart Script
 * --------------------
 * Handles:
 *  - Processing monthly dataset vectors
 *  - Rendering line, bar, and visits charts
 *  - Mapping raw Express/Mongo data into Chart.js formats
 *  - Graceful fallback when datasets are empty
 * @author YenYi Huang
 * AI Assistant:
 * @author Gemini 3.5 Flash
 */

document.addEventListener("DOMContentLoaded", function () {
  const rawChartData = window.rawChartData || [];
  const rawItemData = window.rawItemData || [];

  if (rawChartData.length === 0 && rawItemData.length === 0) {
    console.warn(
      "Express database context returned empty datasets. Chart rendering paused.",
    );
    return;
  }

  const chartDataVectors = processChartData(rawChartData);

  createLineChart(chartDataVectors);
  createRequestedItemsChart(rawItemData);
  createMonthlyVisitsChart(chartDataVectors);
});

function processChartData(rawData) {
  const vectors = {
    months: [],
    familiesServed: [],
    itemsDistributed: [],
    visits: [],
  };

  rawData.forEach((record) => {
    vectors.months.push(record.month || "Unknown");
    vectors.familiesServed.push(
      Number(record.familiesServed ?? record.families_served) || 0,
    );
    vectors.itemsDistributed.push(
      Number(record.itemsDistributed ?? record.items_distributed) || 0,
    );
    vectors.visits.push(Number(record.visits ?? record.total_visits) || 0);
  });

  return vectors;
}

function createLineChart(data) {
  const canvasEl = document.getElementById("lineChart");
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: data.months,
      datasets: [
        {
          label: "Total Items Distributed",
          data: data.itemsDistributed,
          borderColor: "#212529",
          backgroundColor: "rgba(33, 37, 41, 0.05)",
          borderWidth: 3,
          tension: 0.3,
          fill: true,
          pointRadius: 5,
          pointBackgroundColor: "#212529",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
        },
        {
          label: "Families Served",
          data: data.familiesServed,
          borderColor: "#2e7d32",
          backgroundColor: "rgba(46, 125, 50, 0.05)",
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.3,
          fill: false,
          pointRadius: 4,
          pointBackgroundColor: "#2e7d32",
          pointBorderColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: "top" },
        tooltip: { mode: "index", intersect: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => val.toLocaleString() },
          grid: { color: "rgba(0, 0, 0, 0.05)" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function createRequestedItemsChart(itemData) {
  const canvasEl = document.getElementById("requestedItemsChart");
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");

  const labels = itemData.map(
    (item) => item.item_name || item.name || "Unknown Item",
  );
  const values = itemData.map((item) =>
    Number(item.request_count || item.total_requests || 0),
  );

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Requests",
          data: values,
          backgroundColor: [
            "rgba(54, 162, 235, 0.8)",
            "rgba(255, 99, 132, 0.8)",
            "rgba(255, 206, 86, 0.8)",
            "rgba(75, 192, 192, 0.8)",
            "rgba(153, 102, 255, 0.8)",
            "rgba(255, 159, 64, 0.8)",
          ],
          borderColor: [
            "rgba(54, 162, 235, 1)",
            "rgba(255, 99, 132, 1)",
            "rgba(255, 206, 86, 1)",
            "rgba(75, 192, 192, 1)",
            "rgba(153, 102, 255, 1)",
            "rgba(255, 159, 64, 1)",
          ],
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => val.toLocaleString() },
          grid: { color: "rgba(0, 0, 0, 0.05)" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}

function createMonthlyVisitsChart(data) {
  const canvasEl = document.getElementById("monthlyVisitsChart");
  if (!canvasEl) return;
  const ctx = canvasEl.getContext("2d");

  new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.months,
      datasets: [
        {
          label: "Total Visits",
          data: data.visits,
          backgroundColor: "rgba(156, 39, 176, 0.8)",
          borderColor: "rgba(156, 39, 176, 1)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true, position: "top" } },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (val) => val.toLocaleString() },
          grid: { color: "rgba(0, 0, 0, 0.05)" },
        },
        x: { grid: { display: false } },
      },
    },
  });
}
