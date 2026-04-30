import React from 'react';

export default function ActivityLoadingOverlay({
  show = false,
  label = 'Generating AI feedback...',
}) {
  if (!show) return null;

  return (
    <>
      <style>
        {`
          @keyframes aiPulseRing {
            0% {
              transform: translate(-50%, -50%) scale(0.45);
              opacity: 0.85;
            }
            100% {
              transform: translate(-50%, -50%) scale(1.25);
              opacity: 0;
            }
          }
        `}
      </style>
      <div
        className="d-flex flex-column align-items-center justify-content-center"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2000,
          background: 'rgba(248, 249, 250, 0.72)',
          backdropFilter: 'blur(2px)',
        }}
        aria-live="polite"
        aria-busy="true"
      >
        <div
          style={{
            position: 'relative',
            width: 132,
            height: 132,
          }}
        >
          {[0, 0.55, 1.1].map((delay, idx) => (
            <span
              key={idx}
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                width: 92,
                height: 92,
                borderRadius: '50%',
                border: '4px solid rgba(25, 135, 84, 0.65)',
                animation: `aiPulseRing 1.8s ease-out ${delay}s infinite`,
              }}
            />
          ))}
          <span
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 18,
              height: 18,
              borderRadius: '50%',
              background: '#198754',
              transform: 'translate(-50%, -50%)',
              boxShadow: '0 0 0 8px rgba(25, 135, 84, 0.12)',
            }}
          />
        </div>

        <div className="mt-3 text-center">
          <div className="fw-semibold text-dark">{label}</div>
        </div>
      </div>
    </>
  );
}
