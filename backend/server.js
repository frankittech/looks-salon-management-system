
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const session = require('express-session');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const MySQLStore = require('express-session-mysql2')(session);

// Ensure a session secret exists
if (!process.env.SESSION_SECRET) {
    throw new Error(
        'SESSION_SECRET is missing. Add a strong SESSION_SECRET to your backend .env file.'
    );
}


const app = express();
app.set('trust proxy', 1);

const sessionStore = new MySQLStore({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'looks_salon',

    // Secure connection for TiDB Cloud
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: true }
        : undefined,

    createDatabaseTable: true
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Maximum 5 attempts
    message: {
        success: false,
        message: 'Too many login attempts. Please try again after 15 minutes.'
    },
    standardHeaders: true,
    legacyHeaders: false
});
// ==========================================
// MIDDLEWARE
// ==========================================

app.use(cors({
    origin: [
        'http://127.0.0.1:5500',
        process.env.FRONTEND_URL
    ].filter(Boolean),
    credentials: true
}));

app.use(express.json({ limit: '100kb' }));

app.use(session({
    name: 'looksSalon.sid',
    secret: process.env.SESSION_SECRET,

    store: sessionStore,

    resave: false,
    saveUninitialized: false,

    cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 1000 * 60 * 60 * 2
}
}));

// ==========================================
// HELPER FUNCTIONS
// ==========================================

const asyncRoute = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

const validId = (value) =>
    Number.isInteger(Number(value)) && Number(value) > 0;

// Regenerate session ID after successful login
const regenerateSession = (req) => {
    return new Promise((resolve, reject) => {
        req.session.regenerate(error => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
};

const validAppointmentStatuses = [
    'pending',
    'confirmed',
    'completed',
    'cancelled'
];

const validPaymentMethods = [
    'cash',
    'mpesa',
    'card',
    'bank'
];

const validPaymentStatuses = [
    'pending',
    'completed',
    'failed',
    'refunded'
];

// ==========================================
// AUTHENTICATION MIDDLEWARE
// ==========================================

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.admin) {
        return res.status(401).json({
            message: 'Unauthorized. Please log in first.'
        });
    }

    next();
}

function requireCustomer(req, res, next) {
    if (!req.session || !req.session.customer) {
        return res.status(401).json({
            message: 'Please log in to access your customer account.'
        });
    }

    next();
}

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

// ADMIN LOGIN
app.post('/api/login', loginLimiter,  asyncRoute(async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({
            message: 'Username and password are required.'
        });
    }

    const [admins] = await pool.execute(
        `SELECT id, username, password_hash
         FROM admin_users
         WHERE username = ?`,
        [String(username).trim()]
    );

    if (!admins.length) {
        return res.status(401).json({
            message: 'Invalid username or password.'
        });
    }

    const admin = admins[0];

    const passwordMatches = await bcrypt.compare(
        password,
        admin.password_hash
    );

    if (!passwordMatches) {
        return res.status(401).json({
            message: 'Invalid username or password.'
        });
    }

    // Regenerate session ID after successful authentication
    await regenerateSession(req);

    req.session.admin = {
        id: admin.id,
        username: admin.username
    };

    res.json({
        message: 'Login successful.',
        admin: {
            id: admin.id,
            username: admin.username
        }
    });
}));

// CHECK ADMIN LOGIN STATUS
app.get('/api/auth/status', (req, res) => {
    if (!req.session.admin) {
        return res.status(401).json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        admin: req.session.admin
    });
});

// ADMIN LOGOUT
app.post('/api/logout', (req, res) => {
    delete req.session.admin;

    req.session.save((error) => {
        if (error) {
            return res.status(500).json({
                message: 'Could not log out.'
            });
        }

        res.json({
            message: 'Logged out successfully.'
        });
    });
});

// ==========================================
// 2. CUSTOMER AUTHENTICATION
// ==========================================

// CUSTOMER REGISTRATION
app.post('/api/customer/register', asyncRoute(async (req, res) => {
    const { name, phone, email, password } = req.body;

    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (
        !cleanName ||
        !cleanPhone ||
        !cleanEmail ||
        typeof password !== 'string' ||
        password.length < 8
    ) {
        return res.status(400).json({
            message: 'Enter your name, phone, valid email and a password of at least 8 characters.'
        });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(cleanEmail)) {
        return res.status(400).json({
            message: 'Please enter a valid email address.'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Check whether email already has an account
        const [accounts] = await connection.execute(
            `SELECT id
             FROM customer_accounts
             WHERE email = ?`,
            [cleanEmail]
        );

        if (accounts.length) {
            await connection.rollback();

            return res.status(409).json({
                message: 'An account with this email already exists. Please log in.'
            });
        }

        // Check for an existing customer using phone number
        const [customers] = await connection.execute(
            `SELECT id, name, phone, email
             FROM customers
             WHERE phone = ?`,
            [cleanPhone]
        );

        let customerId;

        if (customers.length) {
            const existingCustomer = customers[0];

            // Only link an existing record if its email matches
            if (
                !existingCustomer.email ||
                existingCustomer.email.toLowerCase() !== cleanEmail
            ) {
                await connection.rollback();

                return res.status(409).json({
                    message: 'This phone number is already registered. Please contact the salon to link your existing customer record.'
                });
            }

            customerId = existingCustomer.id;

        } else {
            // Create new customer
            const [customerResult] = await connection.execute(
                `INSERT INTO customers (name, phone, email)
                 VALUES (?, ?, ?)`,
                [cleanName, cleanPhone, cleanEmail]
            );

            customerId = customerResult.insertId;
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create customer account
        await connection.execute(
            `INSERT INTO customer_accounts
             (customer_id, email, password_hash)
             VALUES (?, ?, ?)`,
            [customerId, cleanEmail, passwordHash]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Your account has been created successfully. You can now log in.'
        });

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}));

// CUSTOMER LOGIN

// CUSTOMER LOGIN
app.post('/api/customer/login', loginLimiter, asyncRoute(async (req, res) => {
    console.log('CUSTOMER LOGIN: Request received');

    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;

    if (!email || typeof password !== 'string' || !password) {
        return res.status(400).json({
            message: 'Email and password are required.'
        });
    }

    console.log('CUSTOMER LOGIN: Checking database');

    const [rows] = await pool.execute(
        `SELECT
            ca.id AS account_id,
            ca.customer_id,
            ca.email,
            ca.password_hash,
            c.name,
            c.phone
         FROM customer_accounts ca
         JOIN customers c ON ca.customer_id = c.id
         WHERE ca.email = ?`,
        [email]
    );

    console.log('CUSTOMER LOGIN: Database query completed');

    if (!rows.length) {
        return res.status(401).json({
            message: 'Invalid email or password.'
        });
    }

    const customer = rows[0];

    const passwordMatches = await bcrypt.compare(
        password,
        customer.password_hash
    );

    if (!passwordMatches) {
        return res.status(401).json({
            message: 'Invalid email or password.'
        });
    }

    console.log('CUSTOMER LOGIN: Password verified');

    await regenerateSession(req);

    console.log('CUSTOMER LOGIN: Session regenerated');

    req.session.customer = {
        id: customer.customer_id,
        account_id: customer.account_id,
        name: customer.name,
        email: customer.email
    };

    // Explicitly save the session before responding
    await new Promise((resolve, reject) => {
        req.session.save(error => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });

    console.log('CUSTOMER LOGIN: Session saved successfully');

    res.json({
        message: 'Customer login successful.',
        customer: req.session.customer
    });
}));


// CHECK CUSTOMER LOGIN STATUS
app.get('/api/customer/auth/status', (req, res) => {
    if (!req.session.customer) {
        return res.status(401).json({
            authenticated: false
        });
    }

    res.json({
        authenticated: true,
        customer: req.session.customer
    });
});

// CUSTOMER LOGOUT
app.post('/api/customer/logout', (req, res) => {
    delete req.session.customer;

    req.session.save((error) => {
        if (error) {
            return res.status(500).json({
                message: 'Could not log out.'
            });
        }

        res.json({
            message: 'Customer logged out successfully.'
        });
    });
});

// VIEW CUSTOMER PROFILE
app.get('/api/customer/profile', requireCustomer, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT id, name, phone, email, created_at
         FROM customers
         WHERE id = ?`,
        [req.session.customer.id]
    );

    if (!rows.length) {
        return res.status(404).json({
            message: 'Customer profile not found.'
        });
    }

    res.json(rows[0]);
}));

// UPDATE CUSTOMER PROFILE
app.put('/api/customer/profile', requireCustomer, asyncRoute(async (req, res) => {
    const { name, phone, email } = req.body;

    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();

    if (!cleanName || !cleanPhone || !cleanEmail) {
        return res.status(400).json({
            message: 'Name, phone and email are required.'
        });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(cleanEmail)) {
        return res.status(400).json({
            message: 'Please enter a valid email address.'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Check whether another customer uses this phone
        const [phoneRows] = await connection.execute(
            `SELECT id
             FROM customers
             WHERE phone = ? AND id <> ?`,
            [cleanPhone, req.session.customer.id]
        );

        if (phoneRows.length) {
            await connection.rollback();

            return res.status(409).json({
                message: 'This phone number is already in use.'
            });
        }

        // Check whether another account uses this email
        const [emailRows] = await connection.execute(
            `SELECT id
             FROM customer_accounts
             WHERE email = ? AND customer_id <> ?`,
            [cleanEmail, req.session.customer.id]
        );

        if (emailRows.length) {
            await connection.rollback();

            return res.status(409).json({
                message: 'This email address is already in use.'
            });
        }

        // Update customer details
        const [result] = await connection.execute(
            `UPDATE customers
             SET name = ?, phone = ?, email = ?
             WHERE id = ?`,
            [
                cleanName,
                cleanPhone,
                cleanEmail,
                req.session.customer.id
            ]
        );

        if (!result.affectedRows) {
            await connection.rollback();

            return res.status(404).json({
                message: 'Customer not found.'
            });
        }

        // Synchronize account email
        await connection.execute(
            `UPDATE customer_accounts
             SET email = ?
             WHERE customer_id = ?`,
            [cleanEmail, req.session.customer.id]
        );

        await connection.commit();

        req.session.customer.name = cleanName;
        req.session.customer.email = cleanEmail;

        res.json({
            message: 'Profile updated successfully.'
        });

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}));

// CUSTOMER APPOINTMENT HISTORY
app.get('/api/customer/appointments', requireCustomer, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT
            a.id,
            a.appointment_date,
            a.status,
            a.notes,
            a.created_at,
            s.name AS service_name,
            s.price AS service_price,
            s.duration_minutes,
            st.name AS staff_name
         FROM appointments a
         JOIN services s ON a.service_id = s.id
         LEFT JOIN staff st ON a.staff_id = st.id
         WHERE a.customer_id = ?
         ORDER BY a.appointment_date DESC`,
        [req.session.customer.id]
    );

    res.json(rows);
}));

// CUSTOMER PAYMENT HISTORY
app.get('/api/customer/payments', requireCustomer, asyncRoute(async (req, res) => {
    const [rows] = await pool.execute(
        `SELECT
            p.id,
            p.appointment_id,
            p.amount,
            p.payment_method,
            p.transaction_reference,
            p.status,
            p.paid_at,
            p.created_at,
            s.name AS service_name,
            a.appointment_date
         FROM payments p
         JOIN appointments a ON p.appointment_id = a.id
         JOIN services s ON a.service_id = s.id
         WHERE a.customer_id = ?
         ORDER BY p.created_at DESC`,
        [req.session.customer.id]
    );

    res.json(rows);
}));

// ==========================================
// 3. HEALTH CHECK
// ==========================================

// Single health-check route
app.get('/api/health', asyncRoute(async (req, res) => {
    await pool.query('SELECT 1');

    res.json({
        success: true,
        status: 'success',
        app: 'Looks Salon API',
        message: 'Looks Salon API is running and the database connection is working.'
    });
}));

// ==========================================
// 4. PUBLIC CUSTOMER BOOKING APIs
// ==========================================

// GET ACTIVE SALON SERVICES
app.get('/api/public/services', asyncRoute(async (req, res) => {
    const [services] = await pool.execute(
        `SELECT id, name, description, price, duration_minutes
         FROM services
         WHERE is_active = 1
         ORDER BY name`
    );

    res.json(services);
}));

// PUBLIC BOOKING
// Logged-in customers use their authenticated customer record.
// Guests cannot use an existing customer's phone number
// to attach a booking to that customer's account.
app.post('/api/public/bookings', asyncRoute(async (req, res) => {
    const {
        name,
        phone,
        email = null,
        service_id,
        appointment_date,
        notes = null
    } = req.body;

    const cleanName = String(name || '').trim();
    const cleanPhone = String(phone || '').trim();
    const cleanEmail = email ? String(email).trim().toLowerCase() : null;
    const cleanNotes = notes ? String(notes).trim() : null;
    const serviceId = Number(service_id);

    if (
        !cleanName ||
        !cleanPhone ||
        !validId(serviceId) ||
        !appointment_date
    ) {
        return res.status(400).json({
            message: 'Please provide your name, phone, service and appointment date.'
        });
    }

    const dateText = String(appointment_date).replace('T', ' ');

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(dateText)) {
        return res.status(400).json({
            message: 'Please provide a valid appointment date and time.'
        });
    }

    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();

        // Confirm service is active
        const [services] = await connection.execute(
            `SELECT id
             FROM services
             WHERE id = ? AND is_active = 1`,
            [serviceId]
        );

        if (!services.length) {
            await connection.rollback();

            return res.status(400).json({
                message: 'The selected service is unavailable.'
            });
        }

        let customerId;

        // LOGGED-IN CUSTOMER
        if (req.session.customer) {
            customerId = req.session.customer.id;

            const [customers] = await connection.execute(
                `SELECT id
                 FROM customers
                 WHERE id = ?`,
                [customerId]
            );

            if (!customers.length) {
                await connection.rollback();

                return res.status(404).json({
                    message: 'Customer account not found.'
                });
            }

        } else {
            // GUEST BOOKING
            const [customers] = await connection.execute(
                `SELECT id
                 FROM customers
                 WHERE phone = ?`,
                [cleanPhone]
            );

            // Do not attach a guest booking to another customer's record
            if (customers.length) {
                await connection.rollback();

                return res.status(409).json({
                    message: 'This phone number is already registered. Please log in to your customer account before booking, or contact the salon for assistance.'
                });
            }

            // Create a new customer record for the guest
            const [customerResult] = await connection.execute(
                `INSERT INTO customers (name, phone, email)
                 VALUES (?, ?, ?)`,
                [cleanName, cleanPhone, cleanEmail]
            );

            customerId = customerResult.insertId;
        }

        // CREATE APPOINTMENT
        const [appointmentResult] = await connection.execute(
            `INSERT INTO appointments
             (customer_id, service_id, appointment_date, status, notes)
             VALUES (?, ?, ?, 'pending', ?)`,
            [
                customerId,
                serviceId,
                dateText.length === 16 ? dateText + ':00' : dateText,
                cleanNotes
            ]
        );

        await connection.commit();

        res.status(201).json({
            message: 'Your appointment request has been submitted successfully.',
            booking_id: appointmentResult.insertId,
            status: 'pending'
        });

    } catch (error) {
        await connection.rollback();
        throw error;

    } finally {
        connection.release();
    }
}));

// ==========================================
// ADMIN-ONLY ROUTES START HERE
// ==========================================

app.use('/api', requireAdmin);

// ==========================================
// 5. CUSTOMERS
// ==========================================

// GET ALL CUSTOMERS
app.get('/api/customers', asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT id, name, phone, email, created_at
        FROM customers
        ORDER BY created_at DESC
    `);

    res.json(rows);
}));

// ADD A CUSTOMER
app.post('/api/customers', asyncRoute(async (req, res) => {
    const { name, phone, email = null } = req.body;

    if (!String(name || '').trim() || !String(phone || '').trim()) {
        return res.status(400).json({
            message: 'Customer name and phone are required.'
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO customers (name, phone, email)
         VALUES (?, ?, ?)`,
        [
            String(name).trim(),
            String(phone).trim(),
            email ? String(email).trim() : null
        ]
    );

    const [rows] = await pool.execute(
        'SELECT * FROM customers WHERE id = ?',
        [result.insertId]
    );

    res.status(201).json(rows[0]);
}));

// DELETE A CUSTOMER
app.delete('/api/customers/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
        return res.status(400).json({
            message: 'Invalid customer ID.'
        });
    }

    const [result] = await pool.execute(
        'DELETE FROM customers WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!result.affectedRows) {
        return res.status(404).json({
            message: 'Customer not found.'
        });
    }

    res.json({
        message: 'Customer deleted successfully.'
    });
}));

// ==========================================
// 6. SERVICES
// ==========================================

// GET ALL SERVICES
app.get('/api/services', asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT *
        FROM services
        ORDER BY name
    `);

    res.json(rows);
}));

// ADD A SERVICE
app.post('/api/services', asyncRoute(async (req, res) => {
    const {
        name,
        description = null,
        price,
        duration_minutes = 60
    } = req.body;

    if (
        !String(name || '').trim() ||
        !Number.isFinite(Number(price)) ||
        Number(price) < 0 ||
        !Number.isInteger(Number(duration_minutes)) ||
        Number(duration_minutes) < 5 ||
        Number(duration_minutes) > 600
    ) {
        return res.status(400).json({
            message: 'Enter a service name, valid price and duration between 5 and 600 minutes.'
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO services
         (name, description, price, duration_minutes)
         VALUES (?, ?, ?, ?)`,
        [
            String(name).trim(),
            description ? String(description).trim() : null,
            Number(price),
            Number(duration_minutes)
        ]
    );

    const [rows] = await pool.execute(
        'SELECT * FROM services WHERE id = ?',
        [result.insertId]
    );

    res.status(201).json(rows[0]);
}));

// DELETE A SERVICE
app.delete('/api/services/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
        return res.status(400).json({
            message: 'Invalid service ID.'
        });
    }

    const [result] = await pool.execute(
        'DELETE FROM services WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!result.affectedRows) {
        return res.status(404).json({
            message: 'Service not found.'
        });
    }

    res.json({
        message: 'Service deleted successfully.'
    });
}));

// UPDATE AN EXISTING SERVICE
app.put('/api/services/:id', asyncRoute(async (req, res) => {
    const {
        name,
        description = null,
        price,
        duration_minutes
    } = req.body;

    if (
        !validId(req.params.id) ||
        !String(name || '').trim() ||
        !Number.isFinite(Number(price)) ||
        Number(price) < 0 ||
        !Number.isInteger(Number(duration_minutes)) ||
        Number(duration_minutes) < 5 ||
        Number(duration_minutes) > 600
    ) {
        return res.status(400).json({
            message: 'Enter a valid service name, price and duration.'
        });
    }

    const [existing] = await pool.execute(
        'SELECT id FROM services WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!existing.length) {
        return res.status(404).json({
            message: 'Service not found.'
        });
    }

    await pool.execute(
        `UPDATE services
         SET name = ?, description = ?, price = ?, duration_minutes = ?
         WHERE id = ?`,
        [
            String(name).trim(),
            description ? String(description).trim() : null,
            Number(price),
            Number(duration_minutes),
            Number(req.params.id)
        ]
    );

    res.json({
        message: 'Service updated successfully.'
    });
}));

// ACTIVATE OR DEACTIVATE A SERVICE
app.patch('/api/services/:id/status', asyncRoute(async (req, res) => {
    const { is_active } = req.body;

    if (
        !validId(req.params.id) ||
        ![0, 1, true, false].includes(is_active)
    ) {
        return res.status(400).json({
            message: 'Provide a valid service ID and status.'
        });
    }

    const [existing] = await pool.execute(
        'SELECT id FROM services WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!existing.length) {
        return res.status(404).json({
            message: 'Service not found.'
        });
    }

    await pool.execute(
        'UPDATE services SET is_active = ? WHERE id = ?',
        [
            Number(Boolean(is_active)),
            Number(req.params.id)
        ]
    );

    res.json({
        message: 'Service status updated successfully.'
    });
}));

// ==========================================
// 7. STAFF
// ==========================================

// GET ALL STAFF MEMBERS
app.get('/api/staff', asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT *
        FROM staff
        ORDER BY name
    `);

    res.json(rows);
}));

// ADD A STAFF MEMBER
app.post('/api/staff', asyncRoute(async (req, res) => {
    const {
        name,
        phone = null,
        email = null,
        role = null
    } = req.body;

    if (!String(name || '').trim()) {
        return res.status(400).json({
            message: 'Staff name is required.'
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO staff (name, phone, email, role)
         VALUES (?, ?, ?, ?)`,
        [
            String(name).trim(),
            phone ? String(phone).trim() : null,
            email ? String(email).trim() : null,
            role ? String(role).trim() : null
        ]
    );

    const [rows] = await pool.execute(
        'SELECT * FROM staff WHERE id = ?',
        [result.insertId]
    );

    res.status(201).json(rows[0]);
}));

// DELETE A STAFF MEMBER
app.delete('/api/staff/:id', asyncRoute(async (req, res) => {
    if (!validId(req.params.id)) {
        return res.status(400).json({
            message: 'Invalid staff ID.'
        });
    }

    const [result] = await pool.execute(
        'DELETE FROM staff WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!result.affectedRows) {
        return res.status(404).json({
            message: 'Staff member not found.'
        });
    }

    res.json({
        message: 'Staff member deleted successfully.'
    });
}));

// UPDATE STAFF DETAILS
app.put('/api/staff/:id', asyncRoute(async (req, res) => {
    const {
        name,
        phone = null,
        email = null,
        role = null
    } = req.body;

    if (
        !validId(req.params.id) ||
        !String(name || '').trim()
    ) {
        return res.status(400).json({
            message: 'A valid staff ID and staff name are required.'
        });
    }

    const [existing] = await pool.execute(
        'SELECT id FROM staff WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!existing.length) {
        return res.status(404).json({
            message: 'Staff member not found.'
        });
    }

    await pool.execute(
        `UPDATE staff
         SET name = ?, phone = ?, email = ?, role = ?
         WHERE id = ?`,
        [
            String(name).trim(),
            phone ? String(phone).trim() : null,
            email ? String(email).trim() : null,
            role ? String(role).trim() : null,
            Number(req.params.id)
        ]
    );

    res.json({
        message: 'Staff details updated successfully.'
    });
}));

// ACTIVATE OR DEACTIVATE STAFF
app.patch('/api/staff/:id/status', asyncRoute(async (req, res) => {
    const { is_active } = req.body;

    if (
        !validId(req.params.id) ||
        ![0, 1, true, false].includes(is_active)
    ) {
        return res.status(400).json({
            message: 'Provide a valid staff ID and status.'
        });
    }

    const [existing] = await pool.execute(
        'SELECT id FROM staff WHERE id = ?',
        [Number(req.params.id)]
    );

    if (!existing.length) {
        return res.status(404).json({
            message: 'Staff member not found.'
        });
    }

    await pool.execute(
        'UPDATE staff SET is_active = ? WHERE id = ?',
        [
            Number(Boolean(is_active)),
            Number(req.params.id)
        ]
    );

    res.json({
        message: 'Staff status updated successfully.'
    });
}));

// ==========================================
// 8. APPOINTMENTS
// ==========================================

// GET ALL APPOINTMENTS
app.get('/api/appointments', asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT
            a.id,
            a.customer_id,
            a.service_id,
            a.staff_id,
            a.appointment_date,
            a.status,
            a.notes,
            a.created_at,
            c.name AS customer_name,
            c.phone AS customer_phone,
            s.name AS service_name,
            s.price AS service_price,
            st.name AS staff_name
        FROM appointments a
        JOIN customers c ON a.customer_id = c.id
        JOIN services s ON a.service_id = s.id
        LEFT JOIN staff st ON a.staff_id = st.id
        ORDER BY a.appointment_date DESC
    `);

    res.json(rows);
}));

// CREATE AN APPOINTMENT
app.post('/api/appointments', asyncRoute(async (req, res) => {
    const {
        customer_id,
        service_id,
        staff_id = null,
        appointment_date,
        notes = null
    } = req.body;

    const date = new Date(appointment_date);

    if (
        !validId(customer_id) ||
        !validId(service_id) ||
        !appointment_date ||
        Number.isNaN(date.getTime()) ||
        (staff_id !== null && staff_id !== '' && !validId(staff_id))
    ) {
        return res.status(400).json({
            message: 'Provide valid customer, service and appointment details.'
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO appointments
         (customer_id, service_id, staff_id, appointment_date, notes)
         VALUES (?, ?, ?, ?, ?)`,
        [
            Number(customer_id),
            Number(service_id),
            staff_id === null || staff_id === '' ? null : Number(staff_id),
            date.toISOString().slice(0, 19).replace('T', ' '),
            notes ? String(notes).trim() : null
        ]
    );

    res.status(201).json({
        id: result.insertId,
        message: 'Appointment created successfully.'
    });
}));

// UPDATE APPOINTMENT STATUS
app.patch('/api/appointments/:id', asyncRoute(async (req, res) => {
    const { status } = req.body;

    if (
        !validId(req.params.id) ||
        !validAppointmentStatuses.includes(status)
    ) {
        return res.status(400).json({
            message: 'Invalid appointment ID or status.'
        });
    }

    const [result] = await pool.execute(
        'UPDATE appointments SET status = ? WHERE id = ?',
        [status, Number(req.params.id)]
    );

    if (!result.affectedRows) {
        return res.status(404).json({
            message: 'Appointment not found.'
        });
    }

    res.json({
        message: 'Appointment status updated successfully.'
    });
}));

// ==========================================
// 9. PAYMENTS
// ==========================================

// GET ALL PAYMENTS
app.get('/api/payments', asyncRoute(async (req, res) => {
    const [rows] = await pool.query(`
        SELECT
            p.id,
            p.appointment_id,
            p.amount,
            p.payment_method,
            p.transaction_reference,
            p.status,
            p.paid_at,
            p.created_at,
            c.name AS customer_name,
            s.name AS service_name
        FROM payments p
        JOIN appointments a ON p.appointment_id = a.id
        JOIN customers c ON a.customer_id = c.id
        JOIN services s ON a.service_id = s.id
        ORDER BY p.created_at DESC
    `);

    res.json(rows);
}));

// RECORD A PAYMENT
app.post('/api/payments', asyncRoute(async (req, res) => {
    const {
        appointment_id,
        amount,
        payment_method,
        transaction_reference = null,
        status = 'pending'
    } = req.body;

    if (
        !validId(appointment_id) ||
        !Number.isFinite(Number(amount)) ||
        Number(amount) <= 0 ||
        !validPaymentMethods.includes(payment_method) ||
        !validPaymentStatuses.includes(status)
    ) {
        return res.status(400).json({
            message: 'Enter a valid appointment, positive amount, payment method and payment status.'
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO payments
         (appointment_id, amount, payment_method, transaction_reference, status, paid_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            Number(appointment_id),
            Number(amount),
            payment_method,
            transaction_reference ? String(transaction_reference).trim() : null,
            status,
            status === 'completed' ? new Date() : null
        ]
    );

    res.status(201).json({
        id: result.insertId,
        message: 'Payment recorded successfully.'
    });
}));

// UPDATE AN EXISTING PAYMENT
app.patch('/api/payments/:id', asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    const {
        appointment_id,
        amount,
        payment_method,
        transaction_reference = null,
        status
    } = req.body;

    if (
        !validId(id) ||
        !validId(appointment_id) ||
        !Number.isFinite(Number(amount)) ||
        Number(amount) <= 0 ||
        !validPaymentMethods.includes(payment_method) ||
        !validPaymentStatuses.includes(status)
    ) {
        return res.status(400).json({
            message: 'Enter a valid appointment, positive amount, payment method and payment status.'
        });
    }

    const [existing] = await pool.execute(
        'SELECT id FROM payments WHERE id = ?',
        [id]
    );

    if (!existing.length) {
        return res.status(404).json({
            message: 'Payment not found.'
        });
    }

    await pool.execute(
        `UPDATE payments
         SET appointment_id = ?,
             amount = ?,
             payment_method = ?,
             transaction_reference = ?,
             status = ?,
             paid_at = CASE
                 WHEN ? = 'completed' THEN COALESCE(paid_at, NOW())
                 ELSE NULL
             END
         WHERE id = ?`,
        [
            Number(appointment_id),
            Number(amount),
            payment_method,
            transaction_reference ? String(transaction_reference).trim() : null,
            status,
            status,
            id
        ]
    );

    res.json({
        message: 'Payment updated successfully.'
    });
}));

// DELETE A PAYMENT
app.delete('/api/payments/:id', asyncRoute(async (req, res) => {
    const id = Number(req.params.id);

    if (!validId(id)) {
        return res.status(400).json({
            message: 'Invalid payment ID.'
        });
    }

    const [result] = await pool.execute(
        'DELETE FROM payments WHERE id = ?',
        [id]
    );

    if (!result.affectedRows) {
        return res.status(404).json({
            message: 'Payment not found.'
        });
    }

    res.json({
        message: 'Payment deleted successfully.'
    });
}));

// ==========================================
// 10. ERROR HANDLING
// ==========================================

// UNKNOWN ROUTES
app.use((req, res) => {
    res.status(404).json({
        message: 'API route not found.'
    });
});

// GENERAL ERROR HANDLER
app.use((err, req, res, next) => {
    console.error('Server error:', err);

    if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
            message: 'This record already exists. Check unique fields such as phone number or email.'
        });
    }

    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({
            message: 'This record is being used by another record and cannot be deleted.'
        });
    }

    if (err.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
            message: 'The selected customer, service, staff member or appointment does not exist.'
        });
    }

    res.status(500).json({
        message: 'Server error. Check the backend terminal for details.'
    });
});

// ==========================================
// 11. START SERVER
// ==========================================

const PORT = Number(process.env.PORT || 3000);

sessionStore.onReady()
    .then(() => {
        app.listen(PORT, () => {
            console.log(`Looks Salon API running at http://localhost:${PORT}`);
            console.log('MySQL session store is ready.');
        });
    })
    .catch(error => {
        console.error('Failed to initialize MySQL session store:', error);
        process.exit(1);
    });