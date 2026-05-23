# 2800-202610-BBY13

4-week COMP 2800 project

## Project Description

Food Bank Tracker is a unified portal app designed to streamline food bank operations — from client food requests and inventory management to volunteer scheduling and admin oversight. It helps community food banks reduce logistics overhead, eliminate manual spreadsheets, and ensure real-time stock clarity so that people in need receive timely support.

## Core Features

* Clients can submit food requests (manual or AI-assisted smart form).
* Admin staff can approve/deny requests with pickup scheduling.
* Real-time inventory tracking with low-stock and out-of-stock alerts.
* Volunteer clock-in/clock-out shift management.
* Role-based dashboards for clients, volunteers, and administrators.
* Notification system for request status updates.
* Audit logging for inventory changes.
* Rate limiting and security headers for production hardening.

## Technologies Used

**Frontend:** EJS, CSS, JavaScript
**Backend:** Node.js, Express.js
**Database:** MongoDB (Mongoose ODM)
**AI:** Google Gemini API
**Hosting:** Render

## Project Structure

```
.
├── config/
│
├── controllers/
│
├── docs/
│   ├── ai-prompt-iterations.md
│   ├── ai-test-cases.md
│   ├── cancel-test-cases.md
│   ├── css-suggestions.md
│   ├── inventory-decrement-test-cases.md
│   ├── notifications-test-cases.md
│   └── rate-limit-test-cases.md
│
├── images/
│   └── landing.svg
│
├── middleware/
│   └── auth.js
│
├── models/
│   ├── AuditLog.js
│   ├── Employee.js
│   ├── FoodRequest.js
│   ├── InventoryItem.js
│   ├── Notification.js
│   ├── Shift.js
│   └── User.js
│
├── public/
│   ├── admin-dashboard.css
│   ├── admin-employees.css
│   ├── admin-generate-codes.css
│   ├── admin-requests.css
│   ├── audit-log-admin.css
│   ├── checkout.css
│   ├── checkout.js
│   ├── client-dashboard.css
│   ├── clock.css
│   ├── clock.js
│   ├── donate.js
│   ├── donation.css
│   ├── inventory.css
│   ├── login.css
│   ├── low-stock-alerts-admin.css
│   ├── manage-inventory-admin.css
│   ├── profile.css
│   ├── report.css
│   ├── report.js
│   ├── request.css
│   ├── signup.css
│   ├── style.css
│   └── volunteer-dashboard.css
│
├── scripts/
│   ├── generateEmployee.js
│   ├── seedDatabase.js
│   ├── testAI.js
│   ├── testFoodRequest.js
│   ├── testInventoryItem.js
│   └── testUser.js
│
├── views/
│   ├── partials/
│   │   ├── footer.ejs
│   │   ├── inventoryRow.ejs
│   │   ├── lowStockRow.ejs
│   │   ├── navbar.ejs
│   │   └── outOfStockRow.ejs
│   │
│   ├── 404.ejs
│   ├── admin-dashboard.ejs
│   ├── admin-employees.ejs
│   ├── admin-generate-codes.ejs
│   ├── admin-login.ejs
│   ├── admin-requests.ejs
│   ├── ai-request.ejs
│   ├── audit-log-admin.ejs
│   ├── checkout.ejs
│   ├── client-dashboard.ejs
│   ├── clock-in.ejs
│   ├── clocked-in.ejs
│   ├── confirmation.ejs
│   ├── donate.ejs
│   ├── editInventory.ejs
│   ├── errorMessage.ejs
│   ├── home.ejs
│   ├── index.ejs
│   ├── inventory.ejs
│   ├── loggedout.ejs
│   ├── login.ejs
│   ├── low-stock-alerts-admin.ejs
│   ├── manage-inventory-admin.ejs
│   ├── onboarding.ejs
│   ├── profile.ejs
│   ├── report.ejs
│   ├── request.ejs
│   ├── signup.ejs
│   ├── submitUser.ejs
│   └── volunteer-dashboard.ejs
│
├── postman/
│   ├── collections/
│   │   └── BBY-13 Food Bank Tracker API/
│   ├── environments/
│   └── globals/
│
├── .gitignore
├── databaseConnection.js
├── package.json
├── README.md
├── server.js
└── utils.js
```

## How to Run This Project

### Prerequisites

Before you begin, make sure you have the following installed:

* Node.js (recommended LTS version)
* npm (comes with Node.js)
* A MongoDB Atlas account (or local MongoDB instance)
* A Google Gemini API key

### 1. Clone the Repository

```bash
git clone https://github.com/sdosanj12/2800-202610-BBY13.git
cd 2800-202610-BBY13
```

### 2. Install Required npm Modules

```bash
npm install
```

### 3. API Keys and Environment Variables

Create a `.env` file in the project root with the following variables:

```
MONGODB_HOST=<your MongoDB connection string>
MONGODB_DATABASE=<your database name>
NODE_SESSION_SECRET=<your JWT secret>
GEMINI_API_KEY=<your Google Gemini API key>
```

Make sure `.env` is listed in `.gitignore` to avoid committing secrets.

### 4. Seed the Database (Optional)

```bash
node scripts/seedDatabase.js
node scripts/generateEmployee.js
```

### 5. Run the Project

```bash
npm start
```

Or with nodemon for development:

```bash
npx nodemon server.js
```

## Authentication Notes

Usernames are **CASE-SENSITIVE**. e.g. `Brian` and `brian` are different accounts.
Make sure to use the exact casing when logging in.

(Email addresses are case-insensitive — `BRIAN@TEST.COM` and `brian@test.com` are treated as the same.)

## Members

* Brian Lau
* Yen Yi Huang
* Supreet Dosanj
* Evan Tang
* Shirin Sajeeb

## Acknowledgements

We used AI tools including Claude, ChatGPT, and Google Gemini to assist with brainstorming, debugging, code refinement, and project planning.

### AI-Assisted Features

* **Smart Request Assistant** — The AI-powered food request form (`/client/ai-request`) uses Google Gemini to parse natural language household descriptions into structured form data. Prompt engineering and response parsing were developed with assistance from Claude and ChatGPT.

* **Rate Limiting & Security** — Express rate-limit and Helmet configurations were refined with AI assistance.

### External Resources

* **Bootstrap 5** — Used for responsive layout and components on select pages.
* **Google Fonts (Inter, DM Sans)** — Typography across the application.
* **Google Material Symbols** — Icons on the landing page.

## Limitations and Future Work

### Current Limitations

* Limited to three hardcoded pickup locations in Vancouver.
* No real-time availability calendar for pickup slots.
* Single-language support (English only with basic translation scaffolding).

### Future Work

* Add real-time pickup slot availability with calendar integration.
* Expand location coverage with dynamic location management.
* Full multi-language support (French, Mandarin, Punjabi).
* Push notifications for mobile users.
* Analytics dashboard for admin reporting and trends.
