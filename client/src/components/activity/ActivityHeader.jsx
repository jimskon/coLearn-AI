import React from 'react';

export default function ActivityHeader({ title, name, section }) {
  return (
    <div className="mb-4">
      {title && <h2>{title}</h2>}
      {name && <h4>Activity ID: {name}</h4>}
      {section && <h3>{section}</h3>}
    </div>
  );
}
