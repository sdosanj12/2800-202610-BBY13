const navbarContainer = document.getElementById('navbar-container');

const navbarHTML = `
    <nav class="navbar">
        <a href="index.html" class="logo">Food Bank Tracker</a>
        
        <ul class="nav-links">
            <li><a href="inventory.html" class="nav-item">Inventory</a></li>
            <li><a href="requests.html" class="nav-item">Requests</a></li>
            <li><a href="volunteers.html" class="nav-item">Volunteers</a></li>
            <li><a href="reports.html" class="nav-item">Reports</a></li>
            <li><a href="login.html" class="nav-item">Login</a></li>
        </ul>
    </nav>
`;

navbarContainer.innerHTML = navbarHTML;

// Keep this part ONLY for the "Active" page (the page the user is currently on)
document.querySelectorAll('.nav-links a').forEach(link => {
    if (link.href === window.location.href) {
        link.style.borderBottomColor = "var(--brand-blue)";
    }
});