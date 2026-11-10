# Lens Polytechnic Offa SIMS

A responsive Student Information Management System built with vanilla JavaScript, Bootstrap 5, Express and MySQL. Student, applicant and administrator experiences use the same REST API and relational database.

The portal reference pages use email/password login and let new students create an account to begin an application. The institutional site identifies five schools and publishes ND/HND programme offerings. This project uses those published school/programme names as an editable starting catalogue; confirm the internal department and course catalogue with the Academic Office before loading live records.

## Requirements

- Node.js 20 or newer and npm
- MySQL 8.0 or newer
- An SMTP account for real email verification and password reset delivery

## Local setup

1. Install JavaScript dependencies:

   ```sh
   npm install
   ```

2. Create a local environment file and set a unique session secret:

   ```sh
   cp .env.example .env
   ```

   Set `SESSION_SECRET` to at least 32 random characters. Fill in the MySQL host, port, database, username and password. Keep `.env` private; it is excluded from Git.

3. Create and seed the database. The schema creates `lens_polytechnic_sims` if it does not already exist:

   ```sh
   mysql -u root -p < database/schema.sql
   mysql -u root -p lens_polytechnic_sims < database/seed.sql
   ```

`seed.sql` adds the 2026/2027 session, its first and second semesters, a configurable starter grading scale, five schools and the published ND/HND programmes. Confirm the institution's approved grade bands before entering live results. It does not add a fixed administrator password or fabricated student login.

4. Create the first administrator from environment variables. Set `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_NAME` and `INITIAL_ADMIN_PASSWORD` in `.env`; the password must be at least 12 characters. Then run:

   ```sh
   npm run setup:admin
   ```

   Remove `INITIAL_ADMIN_PASSWORD` from `.env` after setup. The setup script refuses to create a second initial administrator.

5. Start the application:

   ```sh
   npm start
   ```

   Open `http://localhost:3000`. The MySQL session table is created by the session store on first server start.

### Optional demo account

To create a sample ND Computer Science student, set `DEMO_STUDENT_PASSWORD` in `.env` to a temporary password of at least 12 characters and run:

```sh
npm run seed:demo
```

The demo login is `student.demo@lenspolytechnic.edu.ng`. Use only development data, and remove the password from `.env` after seeding.

## Email configuration

Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` in `.env`. With SMTP configured, registration sends a verification link and password reset sends a time-limited token. Without SMTP, local development returns a one-time token in the API response and logs the mail content to the server console to make the flow testable. Production responses never expose these tokens; configure SMTP before accepting real applications.

## Main workflows

- **Applicants:** create an account with a passport photo, verify the email, complete their profile and programme/session choice, submit the application, upload credentials and track the Admissions Office decision.
- **Admissions:** review or reject applications. Approving/offering an applicant creates a student record and a unique matriculation number in the same database transaction.
- **Students:** update personal contact/profile details, upload private credentials, register available semester courses, view published results, see account notices and open support tickets.
- **Administrators:** manage student accounts and status, review documents, publish announcements, set up sessions/departments/programmes/courses, manage registration, enter/publish results, maintain fee accounts, answer support requests and export student reports.

### CSV formats

Student account import accepts a header row with:

```text
first_name,last_name,email,password,programme_id,current_level,matriculation_number,phone
```

The password column contains temporary passwords; store the import securely and remove it after the operation. Result import accepts:

```text
student_id,course_id,semester_id,ca_score,exam_score
```

Both imports validate their rows and use a database transaction, so a bad row cancels the batch rather than partially importing it.

## Security and storage

- Passwords use bcrypt (12 rounds); sessions are stored in MySQL and use HTTP-only, same-site cookies.
- Mutating requests require a session-bound CSRF token in `X-CSRF-Token`.
- Protected API routes check the user's current role and account status in MySQL. Blocking an account revokes access to the next protected request.
- Queries use `mysql2` parameter binding. Inputs are validated and dynamic page content is HTML-escaped.
- Helmet headers, a content security policy, authentication rate limits and upload limits/signature checks are enabled.
- Student documents and passport photos are held in `backend/uploads/private`, which is not served as a public static directory. Downloads require an authenticated owner or administrator.
- Production deployments should use HTTPS, a dedicated least-privilege MySQL user, managed SMTP credentials, regular database backups, a persistent private upload volume and an appropriate `TRUST_PROXY` setting behind a reverse proxy.

## Project layout

```text
backend/                 Express app, API routes, middleware, services and scripts
database/schema.sql      Relational MySQL schema
database/seed.sql        Academic reference catalogue and starter data
frontend/                HTML entry point, CSS and browser ES modules
backend/uploads/private  Private credential and passport storage (runtime-created)
```

## Current integration boundaries

- Fee accounts and payment receipts are recorded by an administrator after reconciliation. An online payment gateway is not configured; connect the institution's approved provider before accepting card/bank payments in this portal.
- The seed contains programme names published on the public institutional website. It does not invent course codes or a full official syllabus; administrators should load the approved course list and grading rules before opening registration/results for real cohorts.
- SMTP delivery and MySQL availability are environmental requirements. The application reports an API/database startup error rather than substituting hardcoded dashboard data.
- The generated student ID card and registration/result print views use the browser print dialog; there is no external PDF service.

## Reference sources

- [Lens Polytechnic student portal login](https://polytechnic.lens.edu.ng/login)
- [Lens Polytechnic student registration](https://polytechnic.lens.edu.ng/register)
- [Lens Polytechnic institutional website and programmes](https://lenspoly.com/)
