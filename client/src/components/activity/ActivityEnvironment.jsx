import React from 'react';

export default function ActivityEnvironment({ type, content }) {
  return (
    <div className="mb-4">
      <h4>{type.toUpperCase()}</h4>
      {content.map((line, idx) => (
        <p key={idx} dangerouslySetInnerHTML={{ __html: line }} />
      ))}
    </div>
  );
}
