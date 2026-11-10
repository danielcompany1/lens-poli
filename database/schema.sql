CREATE DATABASE IF NOT EXISTS lens_polytechnic_sims CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE lens_polytechnic_sims;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  middle_name VARCHAR(80) NULL,
  last_name VARCHAR(80) NOT NULL,
  phone VARCHAR(30) NULL,
  photo_document_id BIGINT UNSIGNED NULL,
  role ENUM('applicant','student','admin') NOT NULL DEFAULT 'applicant',
  status ENUM('active','blocked','archived') NOT NULL DEFAULT 'active',
  email_verified_at DATETIME NULL,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_status (role, status),
  INDEX idx_users_name (last_name, first_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS email_verifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_verification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS schools (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL UNIQUE,
  code VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS departments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  school_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(150) NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_department_school (school_id, name),
  CONSTRAINT fk_department_school FOREIGN KEY (school_id) REFERENCES schools(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS programmes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  department_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(180) NOT NULL,
  qualification ENUM('ND','HND') NOT NULL,
  duration_years TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_programme (department_id, name, qualification),
  CONSTRAINT fk_programme_department FOREIGN KEY (department_id) REFERENCES departments(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(20) NOT NULL UNIQUE,
  starts_on DATE NULL,
  ends_on DATE NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  registration_opens_at DATETIME NULL,
  registration_closes_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS semesters (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  academic_session_id BIGINT UNSIGNED NOT NULL,
  name ENUM('First Semester','Second Semester') NOT NULL,
  starts_on DATE NULL,
  ends_on DATE NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  registration_opens_at DATETIME NULL,
  registration_closes_at DATETIME NULL,
  UNIQUE KEY uq_semester (academic_session_id, name),
  CONSTRAINT fk_semester_session FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS admission_applications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  application_number VARCHAR(30) NOT NULL UNIQUE,
  programme_id BIGINT UNSIGNED NULL,
  academic_session_id BIGINT UNSIGNED NULL,
  date_of_birth DATE NULL,
  gender ENUM('Female','Male','Other','Prefer not to say') NULL,
  state_of_origin VARCHAR(100) NULL,
  local_government VARCHAR(120) NULL,
  address TEXT NULL,
  status ENUM('draft','submitted','under_review','approved','rejected','offered') NOT NULL DEFAULT 'draft',
  review_notes TEXT NULL,
  reviewed_by BIGINT UNSIGNED NULL,
  reviewed_at DATETIME NULL,
  submitted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_application_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_application_programme FOREIGN KEY (programme_id) REFERENCES programmes(id) ON DELETE SET NULL,
  CONSTRAINT fk_application_session FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id) ON DELETE SET NULL,
  CONSTRAINT fk_application_reviewer FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_application_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL UNIQUE,
  application_id BIGINT UNSIGNED NULL UNIQUE,
  matriculation_number VARCHAR(30) NOT NULL UNIQUE,
  programme_id BIGINT UNSIGNED NOT NULL,
  admission_session_id BIGINT UNSIGNED NULL,
  current_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  admission_year YEAR NULL,
  expected_graduation_year YEAR NULL,
  marital_status VARCHAR(30) NULL,
  nationality VARCHAR(80) NOT NULL DEFAULT 'Nigerian',
  guardian_name VARCHAR(160) NULL,
  guardian_phone VARCHAR(30) NULL,
  emergency_contact VARCHAR(30) NULL,
  previous_institution VARCHAR(180) NULL,
  status ENUM('active','suspended','graduated','withdrawn','deferred','archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_student_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_student_application FOREIGN KEY (application_id) REFERENCES admission_applications(id) ON DELETE SET NULL,
  CONSTRAINT fk_student_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
  CONSTRAINT fk_student_session FOREIGN KEY (admission_session_id) REFERENCES academic_sessions(id),
  INDEX idx_student_status_programme (status, programme_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  category ENUM('passport','waec','neco','nabteb','jamb','nd_certificate','hnd_certificate','statement_of_result','transcript','birth_certificate','local_government_id','admission_letter','other') NOT NULL DEFAULT 'other',
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  stored_name VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  status ENUM('pending','under_review','approved','rejected','resubmission_required') NOT NULL DEFAULT 'pending',
  verification_comment TEXT NULL,
  verified_by BIGINT UNSIGNED NULL,
  verified_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_document_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_document_verifier FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_document_owner (owner_user_id, category),
  INDEX idx_document_status (status, created_at)
) ENGINE=InnoDB;
ALTER TABLE users ADD CONSTRAINT fk_user_photo FOREIGN KEY (photo_document_id) REFERENCES documents(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS courses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  programme_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(20) NOT NULL UNIQUE,
  title VARCHAR(180) NOT NULL,
  credit_units TINYINT UNSIGNED NOT NULL,
  level TINYINT UNSIGNED NOT NULL,
  semester ENUM('First Semester','Second Semester') NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_course_programme FOREIGN KEY (programme_id) REFERENCES programmes(id),
  INDEX idx_course_programme_level (programme_id, level, semester)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS course_registrations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  semester_id BIGINT UNSIGNED NOT NULL,
  status ENUM('draft','submitted','approved','reopened') NOT NULL DEFAULT 'draft',
  registered_at DATETIME NULL,
  approved_by BIGINT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_student_course_semester (student_id, course_id, semester_id),
  CONSTRAINT fk_registration_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_registration_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_registration_semester FOREIGN KEY (semester_id) REFERENCES semesters(id),
  CONSTRAINT fk_registration_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grading_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  minimum_score DECIMAL(5,2) NOT NULL,
  maximum_score DECIMAL(5,2) NOT NULL,
  grade VARCHAR(3) NOT NULL,
  grade_point DECIMAL(3,2) NOT NULL,
  remark VARCHAR(30) NOT NULL,
  UNIQUE KEY uq_grade_range (minimum_score, maximum_score)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS results (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  semester_id BIGINT UNSIGNED NOT NULL,
  ca_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  exam_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  total_score DECIMAL(5,2) NOT NULL,
  grade VARCHAR(3) NULL,
  grade_point DECIMAL(3,2) NULL,
  published BOOLEAN NOT NULL DEFAULT FALSE,
  entered_by BIGINT UNSIGNED NULL,
  entered_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_result (student_id, course_id, semester_id),
  CONSTRAINT fk_result_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_result_course FOREIGN KEY (course_id) REFERENCES courses(id),
  CONSTRAINT fk_result_semester FOREIGN KEY (semester_id) REFERENCES semesters(id),
  CONSTRAINT fk_result_entered_by FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_results_published (student_id, published, semester_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS announcements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  audience ENUM('all','students','applicants','staff') NOT NULL DEFAULT 'students',
  priority ENUM('normal','important','urgent') NOT NULL DEFAULT 'normal',
  published BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  author_user_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_announcement_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_announcement_live (published, starts_at, ends_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  recipient_user_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  parent_message_id BIGINT UNSIGNED NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_message_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_message_parent FOREIGN KEY (parent_message_id) REFERENCES messages(id) ON DELETE SET NULL,
  INDEX idx_message_recipient (recipient_user_id, read_at, created_at),
  INDEX idx_message_thread (parent_message_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  body VARCHAR(500) NOT NULL,
  type VARCHAR(40) NOT NULL DEFAULT 'info',
  link VARCHAR(255) NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_notification_user (user_id, read_at, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_number VARCHAR(30) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  subject VARCHAR(200) NOT NULL,
  category VARCHAR(50) NOT NULL DEFAULT 'General',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status ENUM('open','in_progress','resolved','closed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_ticket_status (status, created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ticket_replies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ticket_id BIGINT UNSIGNED NOT NULL,
  sender_user_id BIGINT UNSIGNED NOT NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_reply_ticket FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_reply_sender FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS fee_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id BIGINT UNSIGNED NOT NULL,
  academic_session_id BIGINT UNSIGNED NOT NULL,
  description VARCHAR(180) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  amount_paid DECIMAL(12,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  status ENUM('unpaid','part_paid','paid','waived') NOT NULL DEFAULT 'unpaid',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fee_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
  CONSTRAINT fk_fee_session FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_calendar (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  academic_session_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT NULL,
  starts_at DATETIME NOT NULL,
  ends_at DATETIME NULL,
  audience ENUM('all','students','applicants','staff') NOT NULL DEFAULT 'students',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_calendar_session FOREIGN KEY (academic_session_id) REFERENCES academic_sessions(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audit_entity (entity_type, entity_id, created_at)
) ENGINE=InnoDB;
