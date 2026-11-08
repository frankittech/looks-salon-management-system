
const bcrypt = require("bcrypt");
const pool = require("./db");

async function createAdmin() {
    try {
        const username = "admin";
        const password = "Admin@123";

        const hashedPassword = await bcrypt.hash(password, 12);

        const [existing] = await pool.query(
            "SELECT id FROM admin_users WHERE username = ?",
            [username]
        );

        if (existing.length > 0) {
            console.log("Admin account already exists.");
            return;
        }

        await pool.query(
            "INSERT INTO admin_users (username, password_hash) VALUES (?, ?)",
            [username, hashedPassword]
        );

        console.log("Admin account created successfully!");
        console.log("Username:", username);
        console.log("Password:", password);

    } catch (error) {
        console.error("Error creating admin:", error.message);
    } finally {
        await pool.end();
    }
}

createAdmin();
