// ManageClassActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useUser } from '../context/UserContext';

import { useNavigate } from 'react-router-dom'; // <-- add this at the top

export default function ManageClassActivitiesPage() {
  const { user } = useUser();
  const { classId } = useParams();
  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState({ name: '', title: '', sheet_url: '' });

  useEffect(() => {
    fetch(`/api/activities/by-class/${classId}`)
      .then(res => res.json())
      .then(data => setActivities(data));
  }, [classId]);

  const handleChange = (e) => {
    setNewActivity({ ...newActivity, [e.target.name]: e.target.value });
  };

  const handleAdd = async () => {
    console.log("🚀 handleAdd called with:", newActivity);

    const res = await fetch('/api/activities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newActivity, createdBy: user.id, class_id: classId })
    });

    const data = await res.json(); // ✅ FIXED: must be *before* using `data`
    console.log("🎯 Created activity:", data);

    if (!data.id) {
      console.error("❌ No ID returned from backend:", data);
      alert("Activity created, but missing ID. Cannot preview.");
      return;
    }

    setActivities([...activities, data]);
    setNewActivity({ name: '', title: '', sheet_url: '' });

    // ✅ Navigate to the preview page
    navigate(`/preview/${data.id}`);
  };

  const handleUpdate = async (activity) => {
    const res = await fetch(`/api/activities/${activity.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity)
    });
    const updated = await res.json();
    setActivities(activities.map(a => a.name === updated.name ? updated : a));
  };

  const handleDelete = async (name) => {
    await fetch(`/api/activities/${name}`, { method: 'DELETE' });
    setActivities(activities.filter(a => a.name !== name));
  };

  return (
    <div>
      <h2>Manage Activities for Class #{classId}</h2>

      <div>
        <h3>Add Activity</h3>
        <input name="name" placeholder="Name" value={newActivity.name} onChange={handleChange} />
        <input name="title" placeholder="Title" value={newActivity.title} onChange={handleChange} />
        <input name="sheet_url" placeholder="Google Sheet URL" value={newActivity.sheet_url} onChange={handleChange} />
        <button onClick={handleAdd}>Add</button>
      </div>

      <div>
        <h3>Current Activities</h3>
        {activities.map(activity => (
          <div key={activity.name} style={{ border: '1px solid #ccc', padding: '10px', marginTop: '10px' }}>
            <input value={activity.name} onChange={(e) => handleUpdate({ ...activity, name: e.target.value })} />
            <input value={activity.title} onChange={(e) => handleUpdate({ ...activity, title: e.target.value })} />
            <input value={activity.sheet_url} onChange={(e) => handleUpdate({ ...activity, sheet_url: e.target.value })} />
            <button onClick={() => handleUpdate(activity)}>Update</button>
            <button onClick={() => handleDelete(activity.name)}>Delete</button>
          </div>
        ))}
      </div>
    </div>
  );
}
