const footerContainer = document.getElementById("footer-container");

if (footerContainer) {
  footerContainer.style.width = "100%";
  footerContainer.style.marginTop = "auto";
}

const footerHTML = `
    <footer class="site-footer">
        <p>&copy; ${new Date().getFullYear()} Food Bank Tracker</p>
        
        <div class="footer-links">
            <a href="#">Privacy Policy</a>
            <a href="#">Terms of Service</a>
            <a href="#">Contact Support</a>
        </div>
    </footer>
`;

footerContainer.innerHTML = footerHTML;
