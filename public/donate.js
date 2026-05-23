document.querySelectorAll(".frequency-btn").forEach((btn) => {
  btn.addEventListener("click", function () {
    document
      .querySelectorAll(".frequency-btn")
      .forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
  });
});

document.querySelectorAll(".amount-btn").forEach((btn) => {
  btn.addEventListener("click", function () {
    document
      .querySelectorAll(".amount-btn")
      .forEach((b) => b.classList.remove("active"));
    this.classList.add("active");
    document.getElementById("customAmount").value = "";
  });
});

document.getElementById("customAmount").addEventListener("input", function () {
  if (this.value) {
    document
      .querySelectorAll(".amount-btn")
      .forEach((b) => b.classList.remove("active"));
  }
});

document.getElementById("proceedBtn").addEventListener("click", function () {
  const activePreset = document.querySelector(".amount-btn.active");
  const customAmountValue = document
    .getElementById("customAmount")
    .value.trim();
  const activeFrequency = document.querySelector(".frequency-btn.active");

  const frequency = activeFrequency
    ? activeFrequency.dataset.frequency
    : "once";

  let amount = "70";

  if (customAmountValue !== "") {
    const parsedCustom = parseFloat(customAmountValue);
    if (isNaN(parsedCustom) || parsedCustom < 5) {
      alert("Please enter a valid donation amount of $5 or more.");
      return;
    }
    amount = parsedCustom.toString();
  } else if (activePreset) {
    amount = activePreset.dataset.amount;
  } else {
    alert("Please select or enter a donation amount before proceeding.");
    return;
  }

  window.location.href = `/checkout?amount=${encodeURIComponent(amount)}&frequency=${encodeURIComponent(frequency)}`;
});
