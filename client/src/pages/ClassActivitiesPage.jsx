// pages/ClassActivitiesPage.jsx
import React, { useEffect, useState } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useUser } from '../context/UserContext';
import { API_BASE_URL } from '../config';

export default function ClassActivitiesPage() {
  const { id: classId } = useParams();
  const { user } = useUser();
  const location = useLocation();
  const navigate = useNavigate();

  const [activities, setActivities] = useState([]);
  const [newActivity, setNewActivity] = useState({
    name: '',
    title: '',
    sheet_url: '',
    order_index: 1,
  });

  useEffect(() => {
    if (!user || (user.role !== 'root' && user.role !== 'creator')) {
      navigate('/dashboard');
    } else {
      fetch(`${API_BASE_URL}/api/classes/${classId}/activities`)
        .then(res => res.json())
        .then(setActivities);
    }
  }, [classId, user, navigate]);

  const handleChange = (e) => {
    setNewActivity({ ...newActivity, [e.target.name]: e.target.value });
  };

    const handleAdd = async () => {
console.log("Sending activity to backend:", {
  name: newActivity.name,
  title: newActivity.title,
  sheet_url: newActivity.sheet_url,
  order_index: parseInt(newActivity.order_index) || 0,
  createdBy: user.id
});
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...newActivity,
        order_index: parseInt(newActivity.order_index),
        createdBy: user.id
      })
    });
    const data = await res.json();
    setActivities([...activities, data]);
    setNewActivity({ name: '', title: '', sheet_url: '', order_index: 1 });
  };

  const handleUpdate = async (activity) => {
    const res = await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${activity.name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(activity)
    });
    const updated = await res.json();
    setActivities(activities.map(a => a.name === updated.name ? updated : a));
  };

  const handleDelete = async (name) => {
    await fetch(`${API_BASE_URL}/api/classes/${classId}/activities/${name}`, { method: 'DELETE' });
    setActivities(activities.filter(a => a.name !== name));
  };

  return (
    <div>
      <h2>Manage Activities for Class {classId}</h2>

      <div>
        <h3>Add New Activity</h3>
        <input name="name" value={newActivity.name} onChange={handleChange} placeholder="Unique Name" />
        <input name="title" value={newActivity.title} onChange={handleChange} placeholder="Title" />
        <input name="sheet_url" value={newActivity.sheet_url} onChange={handleChange} placeholder="Google Sheet URL" />
        <input name="order_index" type="number" value={newActivity.order_index} onChange={handleChange} placeholder="Order Index" />
        <button onClick={handleAdd}>Add Activity</button>
      </div>

      <div>
        <h3>Current Activities</h3>
        {activities
          .sort((a, b) => a.order_index - b.order_index)
          .map(activity => (
            <div key={activity.name} style={{ border: '1px solid #ccc', padding: '10px', marginTop: '10px' }}>
              <input value={activity.name} onChange={(e) => handleUpdate({ ...activity, name: e.target.value })} />
              <input value={activity.title} onChange={(e) => handleUpdate({ ...activity, title: e.target.value })} />
              <input value={activity.sheet_url} onChange={(e) => handleUpdate({ ...activity, sheet_url: e.target.value })} />
              <input type="number" value={activity.order_index} onChange={(e) => handleUpdate({ ...activity, order_index: parseInt(e.target.value) })} />
              <button onClick={() => handleDelete(activity.name)}>Delete</button>
            </div>
          ))}
      </div>
    </div>
  );
}
