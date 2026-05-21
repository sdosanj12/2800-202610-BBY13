const urlParams = new URLSearchParams(window.location.search);
const amount = parseFloat(urlParams.get("amount")) || 70;
const frequency = urlParams.get("frequency") || "once";

document.getElementById("amountDisplay").textContent = `$${amount.toFixed(2)}`;
document.getElementById("totalAmount").textContent = `$${amount}`;

const frequencyText = frequency === "monthly" ? "Monthly" : "One-time";
document.getElementById("frequencyDisplay").textContent = frequencyText;
document.getElementById("frequencyBadge").textContent = frequencyText;

function updateImpactText(amt) {
  let impactMsg = "";
  if (amt >= 1500) {
    impactMsg = `Your generous donation of $${amt} will stock our pantry for an entire month, helping hundreds of families.`;
  } else if (amt >= 700) {
    impactMsg = `Your donation of $${amt} will provide essential groceries for 10 families this week.`;
  } else if (amt >= 350) {
    impactMsg = `Your donation of $${amt} will support 5 families with nutritious meals for a week.`;
  } else if (amt >= 130) {
    impactMsg = `Your donation of $${amt} will feed 2 families for a week with essential groceries.`;
  } else if (amt >= 70) {
    impactMsg = `Your donation of $${amt} will feed a family of four for one week with nutritious meals.`;
  } else {
    impactMsg = `Your donation of $${amt} will provide essential food items to families in need.`;
  }

  if (frequency === "monthly") {
    impactMsg +=
      " Your monthly commitment ensures consistent support for our community.";
  }

  document.getElementById("impactText").textContent = impactMsg;
}

updateImpactText(amount);

document.querySelectorAll(".payment-method").forEach((method) => {
  method.addEventListener("click", function () {
    document
      .querySelectorAll(".payment-method")
      .forEach((m) => m.classList.remove("active"));
    this.classList.add("active");
  });
});

const cardInput = document.querySelector('input[placeholder*="1234"]');
if (cardInput) {
  cardInput.addEventListener("input", function (e) {
    let value = e.target.value.replace(/\s/g, "");
    let formattedValue = value.match(/.{1,4}/g)?.join(" ") || value;
    e.target.value = formattedValue;
  });
}

const expiryInput = document.querySelector('input[placeholder*="MM / YY"]');
if (expiryInput) {
  expiryInput.addEventListener("input", function (e) {
    let value = e.target.value.replace(/\D/g, "");
    if (value.length >= 2) {
      value = value.slice(0, 2) + " / " + value.slice(2, 4);
    }
    e.target.value = value;
  });
}

document
  .getElementById("checkoutForm")
  .addEventListener("submit", function (e) {
    e.preventDefault();

    alert(
      `Thank you for your ${frequencyText.toLowerCase()} donation of $${amount}! Your transaction is being processed.`,
    );
  });
