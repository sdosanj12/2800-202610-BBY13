const navbarContainer = document.getElementById("navbar-container");

// Ensure the container itself stretches full width across the top of the viewport
if (navbarContainer) {
  navbarContainer.style.width = "100%";
  navbarContainer.style.display = "block";
}

const navbarHTML = `
    <nav class="navbar">
        <a href="/" class="nav-brand">Food Bank Tracker</a>
        
        <ul class="nav-links">
            <li><a href="/inventory">Inventory</a></li>
            <li><a href="/requests">Requests</a></li>
            <li><a href="/volunteer/dashboard">Volunteers</a></li>
            <li><a href="/admin/dashboard">Reports</a></li>
            <li><a href="/login">Login</a></li>
        </ul>
    </nav>
`;

navbarContainer.innerHTML = navbarHTML;

// Dynamic active class selector
const currentUrl = window.location.href;
document.querySelectorAll(".nav-links a").forEach((link) => {
  if (link.href === currentUrl) {
    link.classList.add("nav-active");
  }
});
