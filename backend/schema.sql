CREATE DATABASE IF NOT EXISTS looks_salon
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE looks_salon;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(120) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(150) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_customer_phone (phone)
);

CREATE TABLE IF NOT EXISTS services (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  price DECIMAL(10,2) NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 60,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  service_id INT NOT NULL,
  appointment_at DATETIME NOT NULL,
  status ENUM('pending','confirmed','completed','cancelled') NOT NULL DEFAULT 'pending',
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_appointment_customer FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointment_service FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE RESTRICT,
  INDEX idx_appointment_date (appointment_at),
  INDEX idx_appointment_status (status)
);

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('M-Pesa','Cash','Card','Bank transfer') NOT NULL,
  payment_type ENUM('deposit','full','balance') NOT NULL DEFAULT 'deposit',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_payment_appointment FOREIGN KEY (appointment_id) REFERENCES appointments(id) ON DELETE RESTRICT
);

INSERT INTO services (name, description, price, duration_minutes)
SELECT 'Haircut', 'Basic haircut and styling', 500.00, 30
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Haircut');
INSERT INTO services (name, description, price, duration_minutes)
SELECT 'Braiding', 'Braiding service; price may vary by style', 2500.00, 180
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Braiding');
INSERT INTO services (name, description, price, duration_minutes)
SELECT 'Manicure', 'Nail shaping and polish', 800.00, 45
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Manicure');
INSERT INTO services (name, description, price, duration_minutes)
SELECT 'Makeup', 'Makeup application', 2000.00, 60
WHERE NOT EXISTS (SELECT 1 FROM services WHERE name = 'Makeup');
