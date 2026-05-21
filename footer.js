const footerContainer = document.getElementById("footer-container");

const footerHTML = `
    <footer class="footer">
        <div class="footer-content">
            <div class="footer-info">
                <p>&copy; ${new Date().getFullYear()} Food Bank Tracker</p>
            </div>
            
            <div class="footer-links-group">
                <ul class="footer-links">
                    <li><a href="#">Privacy Policy</a></li>
                    <li><a href="#">Terms of Service</a></li>
                    <li><a href="#">Contact Support</a></li>
                </ul>
            </div>
        </div>
    </footer>
`;

footerContainer.innerHTML = footerHTML;
