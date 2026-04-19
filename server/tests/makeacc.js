// Script to generate test data for the application
// server/tests/makeacc.js
const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

const BASE_URL = 'http://localhost:4000/api';
// Make sure this matches what you really want:
const PASSWORD = 'KenyonTest777';

function prompt(q) { return new Promise(resolve => rl.question(q, resolve)); }

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
  return `${first[Math.floor(Math.random()*first.length)]} ${last[Math.floor(Math.random()*last.length)]}`;
}

// Return null if not found (so callers can poll)
async function getUserByEmail(email) {
  const res = await axios.get(`${BASE_URL}/users/admin/users`);
  return res.data.find(u => u.email === email) || null;
}

async function pollForUser(email, { attempts = 10, delayMs = 500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const u = await getUserByEmail(email);
    if (u) return u;
    await new Promise(r => setTimeout(r, delayMs));
  }
  return null;
}

async function ensureRole(user, desiredRole) {
  if (!user || !user.id) return user;
  if (desiredRole !== 'student' && user.role !== desiredRole) {
    await axios.put(`${BASE_URL}/users/admin/users/${user.id}/role`, { role: desiredRole });
    return { ...user, role: desiredRole };
  }
  return user;
}

async function registerUser(email, name, role) {
  try {
    const res = await axios.post(`${BASE_URL}/auth/register`, {
      name, email, password: PASSWORD
    });

    // Two possible shapes:
    // 1) { id, ... }  -> immediate user
    // 2) { message: "Confirmation code sent..." } -> need to look it up
    const payload = res.data || {};

    if (payload && payload.id) {
      // Great—server returned a user
      return ensureRole(payload, role);
    }

    // No id? Try to find the user via admin list (poll briefly in case of async write)
    console.warn(`ℹ️ Register returned no user for ${email}. Polling admin list...`);
    let user = await pollForUser(email, { attempts: 12, delayMs: 500 }); // ~6s
    if (!user) {
      throw new Error(`User with email ${email} not found after registration (pending email verification?).`);
    }
    return ensureRole(user, role);

  } catch (error) {
    if (error.response?.status === 409) {
      // Already exists—fetch and ensure role
      console.warn(`⚠️ Duplicate email for ${email}. Fetching existing user.`);
      const existingUser = await pollForUser(email, { attempts: 1, delayMs: 0 });
      if (!existingUser) throw new Error(`Existing user ${email} not retrievable from admin list.`);
      return ensureRole(existingUser, role);
    }
    throw error;
  }
}

async function createClass(name, description, createdBy) {
  const res = await axios.post(`${BASE_URL}/classes`, { name, description, createdBy });
  return res.data;
}

async function createCourse(name, code, section, semester, year, instructorId, classId) {
  const res = await axios.post(`${BASE_URL}/courses`, {
    name, code, section, semester, year, instructor_id: instructorId, class_id: classId
  });
  return res.data;
}

async function enrollStudent(courseCode, studentId) {
  await axios.post(`${BASE_URL}/courses/enroll-by-code`, { code: courseCode, userId: studentId });
}

async function main() {
  try {
    const rootEmail = await prompt('Root user email: ');
    const rootUser = await registerUser(rootEmail, 'Root User', 'root');
    console.log(`Root user: ${rootUser?.name} (ID: ${rootUser?.id})`);

    const creatorTemplate = await prompt('Creator email template (e.g., c@c.c): ');
    const numCreators = parseInt(await prompt('Number of creators: '), 10);
    const creators = [];
    for (let i = 1; i <= numCreators; i++) {
      const email = creatorTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'creator');
      if (user) creators.push(user);
    }

    const instructorTemplate = await prompt('Instructor email template: ');
    const numInstructors = parseInt(await prompt('Number of instructors: '), 10);
    const instructors = [];
    for (let i = 1; i <= numInstructors; i++) {
      const email = instructorTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'instructor');
      if (user) instructors.push(user);
    }

    const studentTemplate = await prompt('Student email template: ');
    const numStudents = parseInt(await prompt('Number of students: '), 10);
    const students = [];
    for (let i = 1; i <= numStudents; i++) {
      const email = studentTemplate.replace('@', `${i}@`);
      const user = await registerUser(email, getRandomName(), 'student');
      if (user) students.push(user);
    }

    const classTemplate = await prompt('Class name template (e.g., cs): ');
    const numClasses = parseInt(await prompt('Number of classes: '), 10);
    const pogilClasses = [];
    for (let i = 1; i <= numClasses; i++) {
      const name = `${classTemplate}${i}`;
      const pogilClass = await createClass(name, `${name} Description`, creators[0].id);
      pogilClasses.push(pogilClass);
    }

    const coursesPerClass = parseInt(await prompt('Number of courses per class: '), 10);
    for (const pogilClass of pogilClasses) {
      for (let i = 1; i <= coursesPerClass; i++) {
        const courseCode = `C${pogilClass.name}${i}`;
        const course = await createCourse(`Course ${i}`, courseCode, `S${i}`, 'spring', 2025, instructors[0].id, pogilClass.id);
        console.log(`✅ Created course: Course ${i} (code: ${courseCode})`);

        for (const student of students) {
          console.log(`→ Enrolling student ${student.id} into ${courseCode}`);
          await enrollStudent(courseCode, student.id);
        }
      }
    }

    console.log('🎉 Test data generation complete.');
  } catch (error) {
    if (error.response) {
      console.error('❌ API Error:');
      console.error(`  URL:     ${error.config?.url}`);
      console.error(`  Method:  ${error.config?.method?.toUpperCase()}`);
      console.error(`  Status:  ${error.response.status} ${error.response.statusText}`);
      console.error(`  Message: ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error('❌ No response received from server:');
      console.error(error.request);
    } else {
      console.error('❌ Request setup/error:', error.message);
    }
  } finally {
    rl.close();
    console.log("The passwords are all set to:", PASSWORD);
  }
}

main();
