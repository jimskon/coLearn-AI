const express = require("express");
const router = express.Router();
const controller = require("./controller");

// 🔹 User-specific enrollments MUST come before generic "/:courseId/..." routes
router.get("/user/:userId/enrollments", controller.getUserEnrollments);

// Get all courses
router.get("/", controller.getAllCourses);

// Create a new course
router.post("/", controller.createCourse);

// Enroll in course by code
router.post("/enroll-by-code", controller.enrollByCode);

// Get all students enrolled in a course (used for role selection)
router.get("/:courseId/enrollments", controller.getCourseEnrollments);

// 🔹 NEW: Clone groups config from another activity in the SAME course
router.get(
  "/:courseId/activities/:sourceActivityId/groups-config",
  controller.getGroupsConfigForActivity
);

// Get activities for a course
router.get("/:courseId/activities", controller.getCourseActivities);

// 🔹 NEW: Get test results for a course
router.get("/:courseId/test-results", controller.getCourseTestResults);

// Get students for a course
router.get("/:courseId/students", controller.getStudentsForCourse);

// Get course info (used in ManageCourseStudentsPage)
router.get("/:courseId/info", controller.getCourseInfo);

// Get course progress (used in ManageCoursesPage) — regular activities only
router.get("/:courseId/progress", controller.getCourseProgress);

// Unenroll a student from a course
router.delete("/:courseId/unenroll/:studentId", controller.unenrollStudentFromCourse);

// Delete a course
router.delete("/:id", controller.deleteCourse);

router.put(
  "/:courseId/activities/:activityId/hidden",
  controller.setCourseActivityHidden
);

module.exports = router;
