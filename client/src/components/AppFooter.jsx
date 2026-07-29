import React from 'react';
import { Container } from 'react-bootstrap';
import {
  APP_BUILD_TIME_UTC,
  APP_COPYRIGHT,
  APP_GIT_COMMIT_SHA,
  APP_VERSION,
} from '../version';

export default function AppFooter() {
  return (
    <footer
      style={{
        borderTop: '1px solid rgba(255, 255, 255, 0.12)',
        marginTop: '3rem',
        padding: '1rem 0 1.5rem',
        color: '#6c757d',
      }}
    >
      <Container className="d-flex flex-column flex-md-row justify-content-between align-items-center gap-2">
        <small>{APP_COPYRIGHT}</small>
        <small>Version {APP_VERSION} · built {APP_BUILD_TIME_UTC} · {APP_GIT_COMMIT_SHA}</small>
      </Container>
    </footer>
  );
}
