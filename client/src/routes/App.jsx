// src/routes/App.jsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import DashboardPage from '../pages/DashboardPage';
import NavBar from '../components/NavBar';
import { UserProvider, useUser } from '../context/UserContext';
import ManageActivitiesPage from '../pages/ManageActivitiesPage';
import ManageClassesPage from '../pages/ManageClassesPage';
import ActivityPreview from '../pages/ActivityPreview';
import AdminUsersPage from '../pages/AdminUsersPage';
import ManageCoursesPage from '../pages/ManageCoursesPage';
import CourseActivitiesPage from '../pages/CourseActivitiesPage';
import RunActivityPage from '../pages/RunActivityPage';
import GroupSetupPage from '../pages/GroupSetupPage';
import ViewGroupsPage from '../pages/ViewGroupsPage';
import ActivityEditor from '../pages/ActivityEditor';
import VerifyPage from '../pages/VerifyPage';
import ForgotPasswordPage from '../pages/ForgotPasswordPage';
import ResetPasswordPage from '../pages/ResetPasswordPage';
import ManageCourseStudentsPage from '../pages/ManageCourseStudentsPage';
import ManageCourseProgressPage from '../pages/ManageCourseProgressPage';
import ManageCourseTestsPage from '../pages/ManageCourseTestsPage'; // 👈 NEW
import { useLocation } from 'react-router-dom';
import ViewTestsPage from '../pages/ViewTestsPage';
import TestSetupPage from '../pages/TestSetupPage';



function AppRoutes() {
  const { user } = useUser();
  const location = useLocation();
  const isRunActivityPage = location.pathname.startsWith("/run/");

  const [roleLabel, setRoleLabel] = React.useState("");
  const [statusText, setStatusText] = React.useState("");
  const [groupMembers, setGroupMembers] = React.useState([]);
  const [activeStudentId, setActiveStudentId] = React.useState(null);

  return (
    <>
      <NavBar
        bgColor="dark"
        fixed={true}
        roleLabel={isRunActivityPage ? roleLabel : ""}
        statusText={isRunActivityPage ? statusText : ""}
        groupMembers={isRunActivityPage ? groupMembers : []}
        activeStudentId={isRunActivityPage ? activeStudentId : null}
      />

      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/dashboard" element={<DashboardPage user={user} />} />
        <Route path="/manage-classes" element={<ManageClassesPage />} />
        <Route path="/manage-courses" element={<ManageCoursesPage />} />
        <Route path="/class/:id" element={<ManageActivitiesPage />} />
        <Route path="/preview/:activityId" element={<ActivityPreview />} />
        <Route path="/admin/users" element={<AdminUsersPage />} />
        <Route path="/courses/:courseId/activities" element={<CourseActivitiesPage />} />
        <Route
          path="/run/:instanceId"
          element={
            <RunActivityPage
              setRoleLabel={setRoleLabel}
              setStatusText={setStatusText}
              groupMembers={groupMembers}
              setGroupMembers={setGroupMembers}
              activeStudentId={activeStudentId}
              setActiveStudentId={setActiveStudentId}
            />
          }
        />
        <Route path="/setup-groups/:courseId/:activityId" element={<GroupSetupPage />} />
        <Route path="/view-groups/:courseId/:activityId" element={<ViewGroupsPage />} />
        <Route path="/view-tests/:courseId/:activityId" element={<ViewTestsPage />} />
        <Route path="/test-setup/:courseId/:activityId" element={<TestSetupPage />} />

        <Route path="/editor/:activityId" element={<ActivityEditor />} />
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/courses/:courseId/students" element={<ManageCourseStudentsPage />} />
        <Route path="/courses/:courseId/progress" element={<ManageCourseProgressPage />} />
        <Route path="/courses/:courseId/tests" element={<ManageCourseTestsPage />} /> {/* 👈 NEW */}
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <Router>
      <UserProvider>
        <AppRoutes />
      </UserProvider>
    </Router>
  );
}
