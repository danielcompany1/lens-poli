USE lens_polytechnic_sims;

INSERT INTO schools (name, code) VALUES
 ('School of Health Science','SHS'),
 ('School of Science and Engineering','SSE'),
 ('School of Management','SOM'),
 ('School of Applied Science','SAS'),
 ('School of Art and Information','SAI')
ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO departments (school_id,name,code)
SELECT id,'Health Science','SHS-HS' FROM schools WHERE code='SHS'
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO departments (school_id,name,code)
SELECT id,'Science and Engineering','SSE-SE' FROM schools WHERE code='SSE'
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO departments (school_id,name,code)
SELECT id,'Management','SOM-MG' FROM schools WHERE code='SOM'
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO departments (school_id,name,code)
SELECT id,'Applied Science','SAS-AS' FROM schools WHERE code='SAS'
ON DUPLICATE KEY UPDATE name=VALUES(name);
INSERT INTO departments (school_id,name,code)
SELECT id,'Art and Information','SAI-AI' FROM schools WHERE code='SAI'
ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO programmes (department_id,name,qualification)
SELECT d.id,p.name,p.qualification FROM (
 SELECT 'SHS-HS' dept,'Pharmaceutical Technology' name,'ND' qualification UNION ALL SELECT 'SHS-HS','Pharmaceutical Technology','HND' UNION ALL
 SELECT 'SHS-HS','Community Health Technology','ND' UNION ALL SELECT 'SHS-HS','Public Health Technology','ND' UNION ALL SELECT 'SHS-HS','Health Information Management','ND' UNION ALL
 SELECT 'SSE-SE','Computer Science','ND' UNION ALL SELECT 'SSE-SE','Computer Science','HND' UNION ALL SELECT 'SSE-SE','Computer Engineering Technology','ND' UNION ALL SELECT 'SSE-SE','Computer Engineering Technology','HND' UNION ALL
 SELECT 'SSE-SE','Electrical and Electronics Engineering','ND' UNION ALL SELECT 'SSE-SE','Software and Web Development','HND' UNION ALL SELECT 'SSE-SE','Power and Machine','HND' UNION ALL SELECT 'SSE-SE','Telecommunication','HND' UNION ALL
 SELECT 'SOM-MG','Business Administration Management','ND' UNION ALL SELECT 'SOM-MG','Business Administration Management','HND' UNION ALL SELECT 'SOM-MG','Accountancy','ND' UNION ALL SELECT 'SOM-MG','Accountancy','HND' UNION ALL
 SELECT 'SOM-MG','Public Administration','ND' UNION ALL SELECT 'SOM-MG','Public Administration','HND' UNION ALL SELECT 'SOM-MG','Crime Management','ND' UNION ALL
 SELECT 'SAS-AS','Science and Laboratory Technology','ND' UNION ALL SELECT 'SAS-AS','Statistics','ND' UNION ALL SELECT 'SAS-AS','Statistics','HND' UNION ALL
 SELECT 'SAS-AS','Hospitality Management','ND' UNION ALL SELECT 'SAS-AS','Hospitality Management','HND' UNION ALL SELECT 'SAS-AS','Food Science and Technology','ND' UNION ALL SELECT 'SAS-AS','Food Science and Technology','HND' UNION ALL
 SELECT 'SAS-AS','Biochemistry','HND' UNION ALL SELECT 'SAS-AS','Microbiology','HND' UNION ALL
 SELECT 'SAI-AI','Mass Communication','ND' UNION ALL SELECT 'SAI-AI','Mass Communication','HND' UNION ALL SELECT 'SAI-AI','Multimedia Technology','ND' UNION ALL SELECT 'SAI-AI','Advertising and Graphics Design','ND' UNION ALL
 SELECT 'SAI-AI','Library and Information Science','ND' UNION ALL SELECT 'SAI-AI','Library and Information Science','HND' UNION ALL SELECT 'SAI-AI','Journalism and Media Studies','HND' UNION ALL
 SELECT 'SAI-AI','Film and Media Studies','HND' UNION ALL SELECT 'SAI-AI','Strategic Communication and Media Studies','HND'
) p JOIN departments d ON d.code=p.dept
ON DUPLICATE KEY UPDATE name=VALUES(name);

INSERT INTO academic_sessions (name,starts_on,ends_on,is_current,registration_opens_at,registration_closes_at)
VALUES ('2026/2027','2026-09-01','2027-08-31',TRUE,'2026-09-01 00:00:00','2027-01-31 23:59:59')
ON DUPLICATE KEY UPDATE is_current=VALUES(is_current);

INSERT INTO semesters (academic_session_id,name,starts_on,ends_on,is_current,registration_opens_at,registration_closes_at)
SELECT id,'First Semester','2026-09-01','2027-01-31',TRUE,'2026-09-01 00:00:00','2027-01-31 23:59:59' FROM academic_sessions WHERE name='2026/2027'
ON DUPLICATE KEY UPDATE is_current=VALUES(is_current);
INSERT INTO semesters (academic_session_id,name,starts_on,ends_on,is_current,registration_opens_at,registration_closes_at)
SELECT id,'Second Semester','2027-02-01','2027-08-31',FALSE,'2027-02-01 00:00:00','2027-08-31 23:59:59' FROM academic_sessions WHERE name='2026/2027'
ON DUPLICATE KEY UPDATE is_current=VALUES(is_current);

INSERT INTO grading_rules (minimum_score,maximum_score,grade,grade_point,remark) VALUES
 (70,100,'A',5.00,'Excellent'),(60,69.99,'B',4.00,'Very Good'),(50,59.99,'C',3.00,'Good'),
 (45,49.99,'D',2.00,'Pass'),(40,44.99,'E',1.00,'Pass'),(0,39.99,'F',0.00,'Fail')
ON DUPLICATE KEY UPDATE grade=VALUES(grade),grade_point=VALUES(grade_point),remark=VALUES(remark);

INSERT INTO announcements (title,body,audience,priority,published,starts_at,ends_at)
VALUES ('Welcome to the 2026/2027 academic session','The student portal is open for the 2026/2027 session. Please check your registration status and academic calendar for current dates.','students','important',TRUE,NOW(),NULL)
ON DUPLICATE KEY UPDATE body=VALUES(body);

INSERT INTO academic_calendar (academic_session_id,title,description,starts_at,ends_at,audience)
SELECT id,'First semester registration period','Registration dates are managed by the Academic Office. Contact your department if you need assistance.','2026-09-01 00:00:00','2027-01-31 23:59:59','students' FROM academic_sessions WHERE name='2026/2027'
AND NOT EXISTS (SELECT 1 FROM academic_calendar WHERE title='First semester registration period');
