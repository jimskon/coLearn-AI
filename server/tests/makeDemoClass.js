// server/tests/makeDemoClass.js
// Create (or reuse) a demo creator/instructor, one class, one course, and a bunch of students.
// If the user/class/course already exists, reuse it and keep going.
// All accounts share the same password so you can easily log in as them.
//
// Run with: node server/tests/makeDemoClass.js

const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BASE_URL = 'http://localhost:4000/api';
const PASSWORD = 'LearnKi';   // Shared demo password

function prompt(q) {
  return new Promise(resolve => rl.question(q, resolve));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function getRandomName() {
  const first = ["James","Mary","John","Patricia","Robert","Jennifer","Michael","Linda","William","Elizabeth",
    "David","Barbara","Richard","Susan","Joseph","Jessica","Thomas","Sarah","Charles","Karen",
    "Christopher","Nancy","Daniel","Lisa","Matthew","Betty","Anthony","Margaret","Donald","Sandra",
    "Mark","Ashley","Paul","Kimberly","Steven","Emily","Andrew","Donna","Kenneth","Michelle",
    "George","Dorothy","Joshua","Carol","Kevin","Amanda","Brian","Melissa","Edward","Deborah"
  ];
  const last = ["Smith","Johnson","Williams","Brown","Jones","Garcia","Miller","Davis","Rodriguez","Martinez",
    "Hernandez","Lopez","Gonzalez","Wilson","Anderson","Thomas","Taylor","Moore","Jackson","Martin",
    "Lee","Perez","Thompson","White","Harris","Sanchez","Clark","Ramirez","Lewis","Robinson",
    "Walker","Young","Allen","King","Wright","Scott","Torres","Nguyen","Hill","Flores",
    "Green","Adams","Nelson","Baker","Hall","Rivera","Campbell","Mitchell","Carter","Roberts"
  ];
  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}
function getRandomSwedishName() {
  const first = [
    "Lars","Karl","Erik","Anders","Per","Johan","Nils","Gunnar","Mikael","Jan",
    "Peter","Hans","Bo","Fredrik","Henrik","Magnus","Olof","Daniel","Stefan","Martin",
    "Anna","Maria","Eva","Karin","Lena","Kristina","Birgitta","Ingrid","Margareta","Elisabeth",
    "Ulla","Gunilla","Monica","Yvonne","Helena","Sofia","Emma","Sara","Linda","Malin",
    "Johanna","Camilla","Therese","Annika","Frida","Amanda","Ida","Elin","Maja","Ebba"
  ];

  const last = [
    "Andersson","Johansson","Karlsson","Nilsson","Eriksson","Larsson","Olsson","Persson","Svensson","Gustafsson",
    "Pettersson","Jonsson","Jansson","Hansson","Bengtsson","Jönsson","Lindberg","Jakobsson","Magnusson","Olofsson",
    "Lindström","Lindgren","Axelsson","Bergström","Berg","Sandberg","Holm","Lundberg","Lind","Berglund",
    "Nyström","Eklund","Lund","Wallin","Norberg","Sundberg","Ström","Blom","Dahlberg","Ekström",
    "Lundgren","Björk","Holmberg","Sjöberg","Engström","Bergman","Hedlund","Forsberg","Lindholm","Sjöström"
  ];

  return `${first[Math.floor(Math.random() * first.length)]} ${last[Math.floor(Math.random() * last.length)]}`;
}

// ----- helpers to hit admin/user endpoints -----

async function getUserByEmail(email) {
  // You already have this endpoint working.
  const res = await axios.get(`${BASE_URL}/users/admin/users`);
  return (res.data || []).find(u => u.email === email) || null;
}

async function pollForUser(email, { attempts = 10, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const u = await getUserByEmail(email);
    if (u) return u;
    await sleep(delayMs);
  }
  return null;
}

async function ensureRole(user, desiredRole) {
  if (!user || !user.id) return user;
  if (user.role !== desiredRole) {
    console.log(`→ Updating role for ${user.email} from ${user.role} to ${desiredRole}`);
    await axios.put(`${BASE_URL}/users/admin/users/${user.id}/role`, { role: desiredRole });
    return { ...user, role: desiredRole };
  }
  return user;
}

async function registerOrReuseUser(email, name, desiredRole) {
  try {
    console.log(`\n=== Registering ${desiredRole} ${email} (or reusing) ===`);
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      name, email, password: PASSWORD
    });

    const payload = res.data || {};
    if (payload && payload.id) {
      console.log(`✔ Registered user ${email} with id ${payload.id}`);
      return ensureRole(payload, desiredRole);
    }

    console.warn(`ℹ️ Register returned no user for ${email}. Polling admin list...`);
    let user = await pollForUser(email, { attempts: 12, delayMs: 500 });
    if (!user) throw new Error(`User with email ${email} not found after registration.`);
    console.log(`✔ Reused existing user ${email} (id ${user.id})`);
    return ensureRole(user, desiredRole);

  } catch (error) {
    if (error.response?.status === 409) {
      console.warn(`⚠️ Email already exists for ${email}. Reusing existing user.`);
      const existingUser = await pollForUser(email, { attempts: 12, delayMs: 200 });
      if (!existingUser) throw new Error(`Existing user ${email} not retrievable from admin list.`);
      console.log(`✔ Reused existing user ${email} (id ${existingUser.id})`);
      return ensureRole(existingUser, desiredRole);
    }
    throw error;
  }
}

// ----- class/course helpers (idempotent) -----

async function getAllClasses() {
  // Adjust this if your API differs.
  // Many apps have GET /api/classes returning an array.
  const res = await axios.get(`${BASE_URL}/classes`);
  return Array.isArray(res.data) ? res.data : (res.data?.classes || []);
}

async function findClassByName(name) {
  const classes = await getAllClasses();
  const target = String(name || '').trim().toLowerCase();
  return classes.find(c => String(c.name || '').trim().toLowerCase() === target) || null;
}

async function createOrReuseClass(name, description, createdBy) {
  const existing = await findClassByName(name);
  if (existing) {
    console.log(`\n=== Reusing existing class "${existing.name}" (id ${existing.id}) ===`);
    return existing;
  }

  console.log(`\n=== Creating class "${name}" ===`);
  try {
    const res = await axios.post(`${BASE_URL}/classes`, { name, description, createdBy });
    const id = res.data?.id ?? res.data?.classId ?? res.data?.insertId;
    console.log(`✔ Created class id ${id}`);
    return { ...res.data, id };
  } catch (err) {
    // If your backend uses 409 on duplicate, reuse.
    if (err.response?.status === 409) {
      const again = await findClassByName(name);
      if (again) {
        console.log(`✔ Reused existing class "${again.name}" (id ${again.id})`);
        return again;
      }
    }
    throw err;
  }
}

async function getAllCourses() {
  // Adjust this if your API differs.
  // Many apps have GET /api/courses returning an array or {courses:[...]}.
  const res = await axios.get(`${BASE_URL}/courses`);
  return Array.isArray(res.data) ? res.data : (res.data?.courses || []);
}

function normalize(s) {
  return String(s ?? '').trim().toLowerCase();
}

async function findCourse({ code, section, semester, year, classId }) {
  const courses = await getAllCourses();

  const target = {
    code: normalize(code),
    section: normalize(section),
    semester: normalize(semester),
    year: Number(year),
    classId: Number(classId),
  };

  return courses.find(c => {
    const cCode = normalize(c.code);
    const cSection = normalize(c.section);
    const cSemester = normalize(c.semester);
    const cYear = Number(c.year);
    const cClassId = Number(c.class_id ?? c.classId ?? c.classID);

    return (
      cCode === target.code &&
      cSection === target.section &&
      cSemester === target.semester &&
      cYear === target.year &&
      cClassId === target.classId
    );
  }) || null;
}

async function createOrReuseCourse({ name, code, section, semester, year, instructorId, classId }) {
  const existing = await findCourse({ code, section, semester, year, classId });
  if (existing) {
    console.log(
      `\n=== Reusing existing course "${existing.name}" (${existing.code}) (id ${existing.id}) ===`
    );
    return existing;
  }

  console.log(`\n=== Creating course "${name}" (${code}) ===`);
  try {
    const res = await axios.post(`${BASE_URL}/courses`, {
      name,
      code,
      section,
      semester,
      year,
      instructor_id: instructorId,
      class_id: classId,
    });

    const courseId = res.data?.id ?? res.data?.courseId ?? res.data?.insertId ?? 'unknown';
    console.log(`✔ Created course id ${courseId} with code ${code}`);
    return { ...res.data, id: courseId, code };
  } catch (err) {
    if (err.response?.status === 409) {
      const again = await findCourse({ code, section, semester, year, classId });
      if (again) {
        console.log(`✔ Reused existing course "${again.name}" (id ${again.id})`);
        return again;
      }
    }
    throw err;
  }
}

// ----- enrollment helper (idempotent) -----

async function enrollStudent(courseCode, studentId) {
  console.log(`  → Enrolling student ${studentId} into ${courseCode} (or reusing enrollment)`);
  try {
    await axios.post(`${BASE_URL}/courses/enroll-by-code`, { code: courseCode, userId: studentId });
  } catch (err) {
    // If your API returns 409/400 for already-enrolled, just ignore.
    const status = err.response?.status;
    const msg = JSON.stringify(err.response?.data || {});
    if (status === 409) return;
    if (status === 400 && /already/i.test(msg)) return;
    throw err;
  }
}

async function main() {
  try {
    console.log('=== Demo Class/Course/Student Generator (idempotent) ===');

    // 1) Creator/Instructor for the demo (no root)
    const creatorEmail = await prompt('\nCreator/Instructor email for demo (e.g., demo-instructor@example.com): ');
    const creatorName = await prompt('Display name for this creator/instructor [Demo Instructor]: ') || 'Demo Instructor';
    const creatorUser = await registerOrReuseUser(creatorEmail.trim(), creatorName.trim(), 'creator');
    console.log(`Creator/instructor: ${creatorUser.name} (ID: ${creatorUser.id}, role: ${creatorUser.role})`);

    // 2) Class + Course info
    const className = await prompt('\nClass name (e.g., COMP118-Demo): ');
    const classDesc = await prompt('Class description [Demo class for coLearnAI]: ') || 'Demo class for coLearnAI';

    const demoClass = await createOrReuseClass(className.trim(), classDesc.trim(), creatorUser.id);

    const courseName = await prompt('\nCourse name (e.g., Intro Programming Demo): ');
    const courseCodeRaw = await prompt('Course code (e.g., DEMO118): ');
    const section = await prompt('Section (e.g., 01): ');
    const semester = await prompt('Semester (e.g., spring): ');
    const yearStr = await prompt('Year (e.g., 2026): ');
    const year = parseInt(yearStr, 10) || new Date().getFullYear();

    const courseCode = courseCodeRaw.trim();

    const demoCourse = await createOrReuseCourse({
      name: courseName.trim(),
      code: courseCode,
      section: section.trim(),
      semester: semester.trim().toLowerCase(),
      year,
      instructorId: creatorUser.id,
      classId: demoClass.id,
    });

    console.log(`Course: ${demoCourse.name || courseName} (ID: ${demoCourse.id}, code: ${courseCode})`);

    // 3) Create demo students
    const studentTemplate = await prompt('\nStudent email template (e.g., demo-student@demo.local): ');
    const numStudentsStr = await prompt('Number of demo students to create (e.g., 6): ');
    const numStudents = parseInt(numStudentsStr, 10) || 4;

    const students = [];
    for (let i = 1; i <= numStudents; i++) {
      const email = studentTemplate.replace('@', `${i}@`); // demo-student1@..., demo-student2@...
      const student = await registerOrReuseUser(email, getRandomSwedishName(), 'student');
      if (student) students.push(student);
    }

    // 4) Enroll all students into the demo course (idempotent)
    console.log(`\n=== Enrolling ${students.length} students into ${courseCode} ===`);
    for (const s of students) {
      await enrollStudent(courseCode, s.id);
    }

    console.log('\n🎉 Demo setup complete!');
    console.log('You can now log in as:');
    console.log(`  Creator/Instructor: ${creatorUser.email}  (password: ${PASSWORD})`);
    console.log('  Students:');
    for (const s of students) {
      console.log(`    ${s.email}  (password: ${PASSWORD})`);
    }

  } catch (error) {
    if (error.response) {
      console.error('\n❌ API Error:');
      console.error(`  URL:     ${error.config?.url}`);
      console.error(`  Method:  ${error.config?.method?.toUpperCase()}`);
      console.error(`  Status:  ${error.response.status} ${error.response.statusText}`);
      console.error(`  Message: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('\n❌ No response received from server:');
      console.error(error.request);
    } else {
      console.error('\n❌ Request setup/error:', error.message);
    }
  } finally {
    rl.close();
    console.log("\nAll demo accounts use password:", PASSWORD);
  }
}

main();
