// DisplayActivity.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { API_BASE_URL } from '../config';

export default function DisplayActivity() {
  console.log("🚀 DisplayActivity loaded");

  const { courseId, activityName } = useParams();
  const [activity, setActivity] = useState(null);

  useEffect(() => {
    console.log('🚀 useEffect running');

    const fetchActivity = async () => {
      const encodedName = encodeURIComponent(activityName);
      const url = `${API_BASE_URL}/api/courses/${courseId}/activities/${encodedName}`; 
      console.log('🔍 Fetching from', url);

      try {
        const res = await fetch(url);
        if (!res.ok) {
          console.error('❌ Server returned error:', res.status);
          return;
        }
        const data = await res.json();
        console.log('✅ Activity data received:', data);
        setActivity(data);
      } catch (err) {
        console.error('❌ Fetch failed:', err);
      }
    };

    if (courseId && activityName) {
      fetchActivity();
    } else {
      console.warn('⚠️ Missing courseId or activityName');
    }
  }, [courseId, activityName]);

  if (!activity) return <div>Loading Display Activity...</div>;

  return (
    <div className="container mt-4">
      <h2>{activity.title}</h2>
      <p><strong>Activity ID:</strong> {activity.name}</p>
      <p><strong>Sheet URL:</strong> <a href={activity.sheet_url} target="_blank" rel="noopener noreferrer">{activity.sheet_url}</a></p>
      {/* 🚀 Later: Add questions and interactive workflow here */}
    </div>
  );
}
