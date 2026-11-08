# Looks Salon Management System

## 1. Project Overview

Looks Salon Management System is a web-based application designed to simplify salon operations and improve customer experience.

The system allows customers to create accounts, book appointments, track appointment progress, and view their payment history. It also provides administrators with a dashboard for managing customers, services, staff, appointments, and payments.

The application is developed using HTML, CSS, JavaScript, Node.js, Express.js, and MySQL.

## 2. Project Objectives

- Simplify salon appointment booking.
- Allow customers to register and log in securely.
- Enable customers to track their appointments.
- Allow customers to view their payment records.
- Help administrators manage salon services and staff.
- Improve the management of customer information.
- Provide an organized system for monitoring salon activities.

## 3. Main Features

### Customer Features

- Customer registration and login.
- Secure customer authentication.
- Online appointment booking.
- Personal customer dashboard.
- View appointment history.
- Track appointment status.
- View payment history.
- View and update customer profile.
- Secure logout.

### Administrator Features

- Secure administrator login.
- Dashboard with salon statistics.
- Customer management.
- Add, edit, activate, and deactivate salon services.
- Staff management.
- Appointment management.
- Confirm or cancel appointments.
- Payment management.
- Record customer payments.
- Monitor appointment and payment statuses.

### Public Website Features

- Salon homepage.
- Services section.
- About Us section.
- Beauty inspiration gallery.
- Customer testimonials.
- Online appointment booking.
- Contact information.
- Google Maps location.
- WhatsApp contact link.

## 4. Technologies Used

| Technology | Purpose |
|---|---|
| HTML5 | Website structure |
| CSS3 | Website styling and responsive design |
| JavaScript | Frontend functionality |
| Node.js | Backend runtime environment |
| Express.js | Backend API and routing |
| MySQL | Database management |
| MySQL2 | Database connectivity |
| bcrypt | Password hashing |
| express-session | Session-based authentication |
| express-mysql-session | Persistent MySQL session storage |
| express-rate-limit | Login attempt protection |

## 5. Project Structure

```text
looks_salon_project/
│
├── index.html
├── booking.html
│
├── admin/
│   ├── login.html
│   ├── admin.html
│   ├── customers.html
│   ├── services.html
│   ├── staff.html
│   ├── appointments.html
│   └── payments.html
│
├── customer/
│   ├── register.html
│   ├── login.html
│   ├── dashboard.html
│   ├── appointments.html
│   ├── payments.html
│   └── profile.html
│
└── backend/
    ├── server.js
    ├── db.js
    ├── schema.sql
    ├── createAdmin.js
    ├── package.json
    ├── package-lock.json
    └── .env
```

## 6. Database Structure

The application uses a MySQL database named:

`looks_salon`

The database contains the following main tables:

- **customers** – Stores customer information.
- **customer_accounts** – Stores customer login credentials.
- **admin_users** – Stores administrator login credentials.
- **services** – Stores salon services, prices, and durations.
- **staff** – Stores salon employee information.
- **appointments** – Stores customer appointment details.
- **payments** – Stores payment transactions and payment statuses.
- **sessions** – Stores persistent login sessions.

## 7. Installation and Setup

### Requirements

Before running the project, install:

1. Node.js and npm.
2. MySQL Server.
3. MySQL Workbench.
4. Visual Studio Code.
5. Live Server extension for Visual Studio Code.

### Step 1: Clone or Download the Project

Download the project files or clone the repository:

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
```

Navigate into the project folder:

```bash
cd looks_salon_project
```

### Step 2: Configure the Database

1. Open MySQL Workbench.
2. Create a database named `looks_salon`.
3. On a fresh installation, execute the SQL statements in `backend/schema.sql`.
4. Confirm that the required database tables have been created.

**Important:** Do not rerun the initial database setup on an existing installation without checking the SQL statements first.

### Step 3: Configure the Backend

Open the backend directory:

```bash
cd backend
```

Install the required dependencies:

```bash
npm install
```

Create a `.env` file inside the backend folder.

Add your local database configuration:

```env
PORT=3000

DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=YOUR_MYSQL_PASSWORD
DB_NAME=looks_salon

SESSION_SECRET=YOUR_LONG_RANDOM_SECRET
```

Replace the placeholder values with your actual local configuration.

Never upload your `.env` file or database passwords to GitHub.

### Step 4: Start the Backend Server

From the backend directory, run:

```bash
node server.js
```

The backend should start at:

```text
http://localhost:3000
```

Check whether the API is running by visiting:

```text
http://localhost:3000/api/health
```

### Step 5: Run the Frontend

1. Open the main project folder in Visual Studio Code.
2. Locate `index.html`.
3. Right-click the file.
4. Select **Open with Live Server**.

The website should open in your browser.

## 8. Authentication and Security

The system includes several security measures:

- Password hashing using bcrypt.
- Session-based authentication.
- MySQL-backed persistent sessions.
- HTTP-only session cookies.
- Session regeneration after successful login.
- Login rate limiting.
- Protected administrator routes.
- Customer-specific appointment and payment access.
- Input validation on important API operations.

The local development cookie configuration uses HTTP. Production deployment requires HTTPS and secure-cookie configuration.

## 9. API Overview

The backend provides API endpoints for:

- Administrator authentication.
- Customer registration and authentication.
- Customer profile management.
- Public service listing.
- Appointment booking.
- Customer appointment history.
- Customer payment history.
- Administrator customer management.
- Administrator service management.
- Staff management.
- Appointment management.
- Payment management.

The API runs locally on:

```text
http://localhost:3000
```

## 10. Running the Application

For local development:

1. Ensure MySQL Server is running.
2. Start the backend using `node server.js`.
3. Open the frontend using Live Server.
4. Visit the homepage.
5. Register a customer account or log in.
6. Book an appointment and test the customer dashboard.
7. Log in as an administrator to manage salon operations.

## 11. Future Improvements

Possible future improvements include:

- Online payment integration with M-Pesa.
- Email and SMS appointment notifications.
- Automated appointment reminders.
- Exact salon location and directions.
- Deployment to a public hosting platform.
- Custom domain integration.
- Improved reporting and analytics.

## 12. Project Status

The application currently supports local development and testing.

Customer registration, authentication, appointment booking, appointment tracking, payment history, and administrator management features have been implemented and tested.

Online deployment is planned as a future improvement.

## 13. Contact Information

**Looks Salon**

Location: Embakasi District, Nairobi, Kenya

Phone: 0115482233

Email: lookssalon@gmail.com

Website: Looks Salon Management System

---

**Developed as a web-based salon management project.**

© Looks Salon. All Rights Reserved.
